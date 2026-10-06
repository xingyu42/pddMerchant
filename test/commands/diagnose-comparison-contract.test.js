import assert from 'node:assert/strict';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { run } from '../../src/commands/diagnose/shop.js';
import { clearFixtureCache } from '../../src/adapter/mock-dispatcher.js';
import { createFactResponses } from '../fixtures/test-data.js';
import { createCliSandbox, runtimeConfig } from '../helpers/isolated-cli.js';

const { dispatch, emitSpy } = vi.hoisted(() => ({ dispatch: vi.fn(), emitSpy: vi.fn() }));
vi.mock('../../src/adapter/mock-dispatcher.js', async (importOriginal) => ({
  ...await importOriginal(), mockRunEndpoint: dispatch,
}));
vi.mock('../../src/infra/output.js', async (importOriginal) => ({
  ...await importOriginal(), emit: emitSpy,
}));

let sandbox;
beforeEach(() => {
  sandbox = createCliSandbox();
  for (const [key, value] of Object.entries(sandbox.env)) {
    if (key.startsWith('PDD_')) vi.stubEnv(key, value);
  }
  clearFixtureCache();
  dispatch.mockReset();
  emitSpy.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
});
afterEach(() => {
  clearFixtureCache();
  sandbox.dispose();
});

it('requests distinct comparison windows and computes their nonzero differences', async () => {
  const requests = [];
  dispatch.mockImplementation((spec, params) => {
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
    return spec.normalize(raw);
  });

  const envelope = await run({
    json: true, compare: true, days: 7, timeoutMs: 5000, authStatePath: sandbox.env.PDD_AUTH_STATE_PATH,
  }, { runtimeConfig });
  assert.equal(envelope.ok, true);
  assert.equal(emitSpy.mock.calls.length, 1);
  const comparison = envelope.data.compare;
  assert.equal(comparison.status, 'full');
  assert.deepEqual(comparison.current_window, { since: 1699395200, until: 1700000000, days: 7 });
  assert.deepEqual(comparison.previous_window, { since: 1698790400, until: 1699395200, days: 7 });
  assert.deepEqual(requests.filter(({ name }) => name === 'promo.entityReport')
    .map(({ payload }) => [payload.startDate, payload.endDate]).sort(), [
    ['2023-10-31', '2023-11-07'], ['2023-11-07', '2023-11-14'],
  ]);
  assert.deepEqual(requests.filter(({ name, payload }) => name === 'orders.list'
    && payload.groupEndTime - payload.groupStartTime === 7 * 86400)
    .map(({ payload }) => [payload.groupStartTime, payload.groupEndTime]).sort(), [
    [1698790400, 1699395200], [1699395200, 1700000000],
  ]);
  assert.deepEqual(comparison.dimensions.promo.metrics.spend, { current: 100, previous: 50, delta: 50, delta_pct: 100 });
  assert.deepEqual(comparison.dimensions.funnel.metrics.total_orders, { current: 1, previous: 2, delta: -1, delta_pct: -50 });
  assert.deepEqual(comparison.dimensions.orders.metrics.unship, {
    current: 1, previous: null, delta: null, delta_pct: null, note: 'current_snapshot_only',
  });
  assert.deepEqual(comparison.dimensions.inventory.metrics.total, {
    current: 1, previous: null, delta: null, delta_pct: null, note: 'current_snapshot_only',
  });
});
