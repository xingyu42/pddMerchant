import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import * as runEndpointModule from '../../src/adapter/run-endpoint.js';
import { EndpointClient } from '../../src/adapter/endpoint-client.js';
import { withCommand } from '../../src/commands/_runner.js';
import { openDatabase, closeDatabase } from '../../src/infra/db.js';
import { TRAFFIC_READY_TIME } from '../../src/adapter/endpoints/traffic.js';
import { createCliSandbox, runtimeConfig } from '../helpers/isolated-cli.js';
import { seedDb } from '../helpers/seed-db.js';

const { runEndpoint } = runEndpointModule;

describe('runEndpoint stateless EndpointPort wrapper', () => {
  it('does not expose _resetRateLimitState', () => {
    assert.equal(Object.hasOwn(runEndpointModule, '_resetRateLimitState'), false);
  });

  it('throws E_CONFIG_INVALID when ctx.client is missing or invalid without global fallback', async () => {
    await assert.rejects(runEndpoint(null, TRAFFIC_READY_TIME, {}, {}), { code: 'E_CONFIG_INVALID' });
    await assert.rejects(runEndpoint({}, TRAFFIC_READY_TIME, {}, { client: {} }), { code: 'E_CONFIG_INVALID' });
  });

  it('throws E_USAGE when endpoint spec is missing', async () => {
    await assert.rejects(runEndpoint(null, null, {}, { client: { call: async () => 'ok' } }), { code: 'E_USAGE' });
  });

  it('forwards opaque page tokens and ctx to EndpointPort.call', async () => {
    const call = vi.fn(async () => '2026-10-30');
    const execute = vi.fn();
    const opaquePage = { opaque: true };
    const result = await runEndpoint(opaquePage, TRAFFIC_READY_TIME, { day: 1 }, {
      client: { call, execute },
      mallId: '900001',
    });

    assert.equal(result, '2026-10-30');
    assert.equal(execute.mock.calls.length, 0);
    assert.equal(call.mock.calls.length, 1);
    assert.equal(call.mock.calls[0][0], TRAFFIC_READY_TIME);
    assert.deepEqual(call.mock.calls[0][1], { day: 1 });
    assert.equal(call.mock.calls[0][2].page, opaquePage);
    assert.equal(call.mock.calls[0][2].mallId, '900001');
  });

  it('keeps compatibility with legacy { execute } test stubs and null/undefined page', async () => {
    const execute = vi.fn(async () => ({ data: { total: 0 } }));
    for (const pageToken of [null, undefined]) {
      const data = await runEndpoint(pageToken, TRAFFIC_READY_TIME, {}, { client: { execute } });
      assert.deepEqual(data, { total: 0 });
      assert.equal(execute.mock.calls.at(-1)[2].page, pageToken);
    }
  });

  it('forwards through real EndpointClient.call when mounted on ctx.client', async () => {
    const send = vi.fn(async () => ({
      status: 200,
      raw: { success: true, errorCode: 0, result: '2026-10-30' },
      response: { status: () => 200 },
    }));
    const client = new EndpointClient({ transport: { send } });
    const data = await runEndpoint(null, TRAFFIC_READY_TIME, {}, { client, log: { debug() {} } });
    assert.equal(data, '2026-10-30');
    assert.equal(send.mock.calls[0][2].page, null);
  });
});

describe('runner endpoint isolation and batch cooldown inheritance', () => {
  it('shares cooldown within a single --all-accounts batch while isolating separate runs', async () => {
    const firstSandbox = createCliSandbox({
      'endpoints/traffic.readyTime.json': { success: false, errorCode: 54001, errorMsg: 'rate limited' },
    });
    const secondSandbox = createCliSandbox({
      'endpoints/traffic.readyTime.json': { success: true, errorCode: 0, result: '2026-10-30' },
    });

    try {
      const accounts = [
        { slug: 'shop-a', identity: '900001', displayName: 'Shop A', isDefault: true },
        { slug: 'shop-b', identity: '900002', displayName: 'Shop B' },
      ];
      closeDatabase();
      seedDb(firstSandbox.env.PDD_DB_PATH, { accounts });
      openDatabase(firstSandbox.env.PDD_DB_PATH);
      vi.stubEnv('PDD_TEST_FIXTURE_DIR', firstSandbox.fixtureDir);
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.useFakeTimers();

      const cmd = withCommand({
        name: 'test.batch',
        needsAuth: true,
        needsMall: 'none',
        run: async (ctx) => runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx),
      });

      const batchRuntimeConfig = { ...runtimeConfig, cooldownThreshold: 1, cooldownMs: 60_000 };
      const pendingBatch = cmd({ allAccounts: true, json: true }, { runtimeConfig: batchRuntimeConfig });
      await vi.runAllTimersAsync();
      const batch = await pendingBatch;

      assert.equal(batch.ok, false);
      assert.equal(batch.data.accounts['shop-a'].error.code, 'E_RATE_LIMIT');
      assert.equal(batch.data.accounts['shop-b'].error.code, 'E_RATE_LIMIT');
      assert.equal(batch.data.accounts['shop-b'].error.detail.cooldown_triggered, true);
      assert.ok(batch.meta.warnings.includes('cooldown_inherited_from:shop-a'));

      vi.stubEnv('PDD_TEST_FIXTURE_DIR', secondSandbox.fixtureDir);
      const nextSingle = await cmd({ account: 'shop-b', json: true }, { runtimeConfig: batchRuntimeConfig });
      assert.equal(nextSingle.ok, true);
      assert.equal(nextSingle.data, '2026-10-30');
    } finally {
      closeDatabase();
      firstSandbox.dispose();
      secondSandbox.dispose();
    }
  });
});
