import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { beforeEach, it, vi } from 'vitest';
import { run } from '../../src/commands/diagnose/shop.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createFactResponses } from '../fixtures/test-data.js';
import { runtimeConfig } from '../helpers/isolated-cli.js';
import {
  createInMemoryAuthPort,
  createInMemoryBrowserRuntime,
  createInMemoryMallPort,
} from '../helpers/in-memory-ports.js';
import { createMemoryEndpointTransport } from '../helpers/test-ctx.js';

const FIXED_NOW_MS = 1700000000000;

function makeMemoryStreams() {
  const stdoutChunks = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    streams: { stdout, stderr },
    readStdout: () => stdoutChunks.join(''),
  };
}

beforeEach(() => {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic Shop' }, { setDefault: true });
  saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] }, account.id);
  vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
});

it('requests distinct comparison windows and computes their nonzero differences', async () => {
  const requests = [];
  const transport = createMemoryEndpointTransport((spec, params) => {
    const raw = createFactResponses()[`endpoints/${spec.name}.json`];
    const payload = spec.buildPayload(params, { mallId: '900001' });
    requests.push({ name: spec.name, payload });
    if (spec.name === 'promo.entityReport') {
      assert.ok(['2023-11-07', '2023-10-31'].includes(payload.startDate));
      if (payload.startDate === '2023-10-31') {
        raw.result.totalSumReport.cost.value = '50';
        raw.result.totalSumReport.gmv.value = '100';
        raw.result.entityReportList[0].reportInfo.cost.value = '50';
        raw.result.entityReportList[0].reportInfo.gmv.value = '100';
      }
    }
    if (spec.name === 'orders.list' && payload.groupStartTime === 1698790400) {
      raw.result.pageItems.push({ ...raw.result.pageItems[0], order_sn: 'SYN-PREVIOUS-2' });
      raw.result.totalItemNum = 2;
    }
    return raw;
  });

  const { streams, readStdout } = makeMemoryStreams();
  const runtime = await composeCommandRuntime({
    mode: 'live',
    runtimeConfigPolicy: 'maintenance',
    env: {},
    streams,
    clock: { now: () => FIXED_NOW_MS, sleep: async () => {} },
    overrides: {
      browser: createInMemoryBrowserRuntime(),
      mall: createInMemoryMallPort({ currentMall: { id: '900001', name: 'Synthetic Shop' } }),
      auth: createInMemoryAuthPort({
        merchantIdentity: { mallId: '900001', displayName: 'Synthetic Shop' },
        now: () => FIXED_NOW_MS,
      }),
      endpointTransport: transport,
      runtimeConfig: { ...runtimeConfig, rateLimitQps: 0 },
    },
  });

  let envelope;
  try {
    envelope = await run({
      json: true, compare: true, days: 7, timeoutMs: 5000,
    }, { runtime });
    assert.equal(runtime.outputSink.hasEmitted(), true);
  } finally {
    await runtime.closeAll();
  }

  assert.equal(envelope.ok, true);
  const lines = readStdout().trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), envelope);
  const comparison = envelope.data.compare;
  assert.equal(comparison.status, '数据完整');
  // 1699395200 = 2023-11-08 06:13:20 +08:00；1700000000 = 2023-11-15 06:13:20 +08:00
  assert.deepEqual(comparison.current_window, { start_date: '2023-11-08', end_date: '2023-11-15', days: 7 });
  assert.deepEqual(comparison.previous_window, { start_date: '2023-11-01', end_date: '2023-11-08', days: 7 });
  assert.deepEqual(requests.filter(({ name }) => name === 'promo.entityReport')
    .map(({ payload }) => [payload.startDate, payload.endDate]).sort(), [
    ['2023-10-31', '2023-11-07'], ['2023-11-07', '2023-11-14'],
  ]);
  assert.deepEqual(requests.filter(({ name, payload }) => name === 'orders.list'
    && payload.groupEndTime - payload.groupStartTime === 7 * 86400)
    .map(({ payload }) => [payload.groupStartTime, payload.groupEndTime]).sort(), [
    [1698790400, 1699395200], [1699395200, 1700000000],
  ]);
  assert.deepEqual(comparison.dimensions.promo.metrics.spend_yuan, { current: 100, previous: 50, delta: 50, delta_pct: 100 });
  assert.deepEqual(comparison.dimensions.after_sales.metrics.total_orders, { current: 1, previous: 2, delta: -1, delta_pct: -50 });
  assert.deepEqual(comparison.dimensions.after_sales.metrics.after_sales_count, { current: 0, previous: 0, delta: 0, delta_pct: null });
  assert.equal(Object.hasOwn(comparison.dimensions.after_sales.metrics, 'fulfillment_rate_pct'), false);
  assert.deepEqual(comparison.dimensions.orders.metrics.pending_ship_count, {
    current: 1, previous: null, delta: null, delta_pct: null, note: '仅有当前快照，无上期数据',
  });
  assert.deepEqual(comparison.dimensions.inventory.metrics.total, {
    current: 1, previous: null, delta: null, delta_pct: null, note: '仅有当前快照，无上期数据',
  });
});
