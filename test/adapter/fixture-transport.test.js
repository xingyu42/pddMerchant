import assert from 'node:assert/strict';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { PlaywrightEndpointClient } from '../../src/adapter/endpoint-client.js';
import { runEndpoint, _resetRateLimitState } from '../../src/adapter/run-endpoint.js';
import { clearFixtureCache } from '../../src/adapter/mock-dispatcher.js';
import { executePageApiRequest } from '../../src/adapter/page-api-client.js';
import { TRAFFIC_READY_TIME } from '../../src/adapter/endpoints/traffic.js';
import { ORDER_LIST } from '../../src/adapter/endpoints/orders.js';
import { PROMO_ENTITY_REPORT } from '../../src/adapter/endpoints/promo.js';
import { GOODS_UPDATE_PRICE } from '../../src/adapter/endpoints/goods.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { createCliSandbox, runtimeConfig } from '../helpers/isolated-cli.js';
import { createFactFixtures } from '../fixtures/test-data.js';

vi.mock('../../src/adapter/page-api-client.js', () => ({ executePageApiRequest: vi.fn() }));

let sandbox;
beforeEach(() => {
  executePageApiRequest.mockReset();
  clearFixtureCache();
  _resetRateLimitState();
});
afterEach(() => {
  clearFixtureCache();
  _resetRateLimitState();
  sandbox?.dispose();
  sandbox = null;
});

function useFixtures(fixtures) {
  sandbox = createCliSandbox(fixtures);
  vi.stubEnv('PDD_TEST_ADAPTER', 'fixture');
  vi.stubEnv('PDD_TEST_FIXTURE_DIR', sandbox.fixtureDir);
}

const ctx = { runtimeConfig, log: { debug() {} } };

it.each([40002, 54001])('preserves live error mapping and classification for raw business code %s', async (errorCode) => {
  const raw = { success: false, errorCode, errorMsg: 'Synthetic rejection' };
  useFixtures({ 'endpoints/traffic.readyTime.json': raw });
  let fixtureError;
  await assert.rejects(runEndpoint(null, TRAFFIC_READY_TIME, {}, ctx), (error) => {
    assert.ok(error instanceof PddCliError);
    fixtureError = error;
    return true;
  });
  assert.equal(executePageApiRequest.mock.calls.length, 0);
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  executePageApiRequest.mockResolvedValue({ status: 200, raw });
  const client = new PlaywrightEndpointClient({ cooldownState: {
    map: new Map(), threshold: runtimeConfig.cooldownThreshold, ms: runtimeConfig.cooldownMs,
  } });
  await assert.rejects(client.execute(TRAFFIC_READY_TIME, {}, {
    page: { url: () => TRAFFIC_READY_TIME.nav.url }, log: ctx.log,
  }), (error) => {
    assert.equal(error.message, fixtureError.message);
    assert.deepEqual({ ...error }, { ...fixtureError });
    return true;
  });
  assert.equal(fixtureError.code, errorCode === 40002 ? 'E_BUSINESS' : 'E_RATE_LIMIT');
  assert.equal(fixtureError.exitCode, errorCode === 40002 ? ExitCodes.BUSINESS : ExitCodes.RATE_LIMIT);
  assert.equal(fixtureError.detail.classification,
    errorCode === 40002 ? 'high-frequency-or-risk-control' : 'business-54001');
});

it('normalizes a successful raw fixture exactly once with page null', async () => {
  const raw = { success: true, errorCode: 0, result: '2026-10-30' };
  useFixtures({ 'endpoints/traffic.readyTime.json': raw });
  const normalize = vi.fn(TRAFFIC_READY_TIME.normalize);
  assert.equal(await runEndpoint(null, { ...TRAFFIC_READY_TIME, normalize }, {}, ctx), '2026-10-30');
  assert.deepEqual(normalize.mock.calls, [[raw]]);
  assert.equal(executePageApiRequest.mock.calls.length, 0);
});

it('shares the raw wrapper with live when a spec has no normalizer', async () => {
  const raw = { success: true, errorCode: 0, result: '2026-10-30' };
  const spec = { ...TRAFFIC_READY_TIME, normalize: undefined };
  useFixtures({ 'endpoints/traffic.readyTime.json': raw });
  const fixture = await runEndpoint(null, spec, {}, ctx);
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  executePageApiRequest.mockResolvedValue({ status: 200, raw });
  const live = await new PlaywrightEndpointClient().execute(spec, {}, {
    page: { url: () => spec.nav.url }, log: ctx.log,
  });
  assert.deepEqual(fixture, { raw });
  assert.deepEqual(fixture, live.data);
});

it('applies endpoint-specific success rules and business error mappers', async () => {
  useFixtures({ 'endpoints/goods.update.price.json': { success: false, error_code: 1000, error_msg: 'Synthetic invalid price' } });
  await assert.rejects(runEndpoint(null, GOODS_UPDATE_PRICE, {}, ctx), {
    code: 'E_USAGE', message: 'Synthetic invalid price', exitCode: ExitCodes.USAGE,
  });
});

it('runs the success rule before normalize and rejects malformed successful bodies', async () => {
  useFixtures({ 'endpoints/traffic.readyTime.json': { success: true, result: '2026-10-30' },
    'endpoints/orders.list.json': { success: true, result: {} } });
  const normalize = vi.fn();
  await assert.rejects(runEndpoint(null, { ...TRAFFIC_READY_TIME, normalize }, {}, ctx), { code: 'E_BUSINESS' });
  assert.equal(normalize.mock.calls.length, 0);
  await assert.rejects(runEndpoint(null, ORDER_LIST, {}, ctx), { code: 'E_NETWORK' });
});

it('selects explicit pages and synthesizes empty raw pages without mutating cached fixtures', async () => {
  const fixtures = createFactFixtures();
  const second = structuredClone(fixtures['endpoints/orders.list.json']);
  second.result.pageItems[0].order_sn = 'SYN-PAGE-2';
  useFixtures({ ...fixtures, 'endpoints/orders.list.page2.json': second });
  const first = await runEndpoint(null, ORDER_LIST, {}, ctx);
  first.orders[0].order_sn = 'mutated';
  const repeated = await runEndpoint(null, ORDER_LIST, {}, ctx);
  assert.equal(repeated.orders[0].order_sn, 'SYN-1');
  assert.equal((await runEndpoint(null, ORDER_LIST, { page: 2 }, ctx)).orders[0].order_sn, 'SYN-PAGE-2');
  const empty = await runEndpoint(null, ORDER_LIST, { page: 3 }, ctx);
  assert.deepEqual(empty.orders, []);
  assert.equal(empty.total, first.total);
  assert.equal(empty.raw.success, true);
  const report = await runEndpoint(null, PROMO_ENTITY_REPORT, { page: 2 }, ctx);
  assert.deepEqual(report.entities, []);
  assert.equal(report.totals.spend, 100);
});

it('retains __throws for transport failures and reports missing fixtures deterministically', async () => {
  useFixtures({ 'endpoints/traffic.readyTime.json': { __throws: true,
    __error: { code: 'E_NETWORK', message: 'Synthetic transport failure', exitCode: 5 } } });
  await assert.rejects(runEndpoint(null, TRAFFIC_READY_TIME, {}, ctx), {
    code: 'E_NETWORK', message: 'Synthetic transport failure', exitCode: 5,
  });
  await assert.rejects(runEndpoint(null, ORDER_LIST, {}, ctx), { code: 'E_FIXTURE_MISSING' });
  assert.equal(executePageApiRequest.mock.calls.length, 0);
});

it('skips token waiting while accounting business rate limits and clearing them on success', async () => {
  useFixtures({ 'endpoints/traffic.readyTime.json': { success: false, errorCode: 54001 },
    'endpoints/traffic.readyTime.page2.json': { success: true, errorCode: 0, result: '2026-10-30' },
    ...createFactFixtures() });
  const limiter = { acquire: vi.fn() };
  const cooldownState = { map: new Map(), threshold: 2, ms: 300_000 };
  const client = new PlaywrightEndpointClient({ limiter, cooldownState });
  await assert.rejects(client.execute(TRAFFIC_READY_TIME), { code: 'E_RATE_LIMIT' });
  assert.equal(cooldownState.map.get(TRAFFIC_READY_TIME.name).consecutiveFailures, 1);
  const { data, meta } = await client.execute(ORDER_LIST, {}, { correlation_id: 'synthetic' });
  assert.equal(data.total, 1);
  assert.equal(meta.attempt, 1);
  assert.equal(meta.limiter_wait_ms, 0);
  assert.equal(meta.correlation_id, 'synthetic');
  await client.execute(TRAFFIC_READY_TIME, { page: 2 });
  assert.equal(cooldownState.map.has(TRAFFIC_READY_TIME.name), false);
  await assert.rejects(client.execute(TRAFFIC_READY_TIME), { code: 'E_RATE_LIMIT' });
  await assert.rejects(client.execute(TRAFFIC_READY_TIME), { code: 'E_RATE_LIMIT' });
  await assert.rejects(client.execute(TRAFFIC_READY_TIME), (error) => error.detail.cooldown_triggered === true);
  assert.equal(limiter.acquire.mock.calls.length, 0);
});
