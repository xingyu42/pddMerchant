import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';

const fixtures = vi.hoisted(() => ({ calls: [], responses: {}, errors: {} }));
vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({ ...(await importOriginal()),
  async runEndpoint(_page, spec, params) {
    fixtures.calls.push({ name: spec.name, params });
    if (fixtures.errors[spec.name]) throw fixtures.errors[spec.name];
    return fixtures.responses[spec.name];
  },
}));
const { getCustomerServiceView } = await import('../../src/services/customer-service.js');
const ctx = { page: {}, mallCtx: { activeId: '900001' } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T16:30:00Z'));
  fixtures.calls = [];
  fixtures.errors = {};
  fixtures.responses = { 'cs.overview': { consultUserCnt: 3 }, 'cs.monthTrend': [
    { statDate: '2026-09-30' }, { statDate: '2026-10-01', consultUserCnt: null },
    { statDate: '2026-10-30', consultUserCnt: 3 }, { statDate: '2026-10-31' }] };
});

it('defaults to thirty Shanghai dates ending yesterday and filters the fixed month trend', async () => {
  const view = await getCustomerServiceView(ctx);
  assert.deepEqual(view.window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.deepEqual(fixtures.calls, [{ name: 'cs.overview', params: { startDate: '2026-10-01', endDate: '2026-10-30' } },
    { name: 'cs.monthTrend', params: {} }]);
  assert.deepEqual(view.trend.items.map((item) => item.date), ['2026-10-01', '2026-10-30']);
  assert.equal(view.mall_id, '900001');
});

it.each([[1, '2026-10-30'], [63, '2026-08-29']])('accepts %s days', async (days, start) => {
  assert.equal((await getCustomerServiceView(ctx, { days })).window.start_date, start);
});

it.each([0, 64, 1.5, '30', null, NaN])('rejects invalid days %s before requests', async (days) => {
  await assert.rejects(getCustomerServiceView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(fixtures.calls, []);
});

it('uses calendar arithmetic over leap day', async () => {
  vi.setSystemTime(new Date('2024-03-01T16:00:00Z'));
  assert.deepEqual((await getCustomerServiceView(ctx, { days: 3 })).window,
    { start_date: '2024-02-28', end_date: '2024-03-01', days: 3 });
});

it('degrades only a typed trend failure and fails for the primary overview', async () => {
  const error = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: 5 });
  fixtures.errors['cs.monthTrend'] = error;
  const view = await getCustomerServiceView(ctx);
  assert.equal(view.trend, null);
  assert.deepEqual(view.hints, ['客服逐日趋势拉取失败']);
  fixtures.errors['cs.overview'] = error;
  await assert.rejects(getCustomerServiceView(ctx), (actual) => actual === error);
});
