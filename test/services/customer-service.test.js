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
    { statDate: '2026-10-30', consultUserCnt: 3 }, { statDate: '2026-10-31' }],
  'cs.salesOverview': { inquiryOrderUserCnt: 12, groupUserCnt: 6, inquiryOrderTransformRate: 0.5, csSalesAmount: 153.67 },
  'cs.monthSalesTrend': [{ statDate: '2026-09-28', inquiryOrderUserCnt: 9 },
    { statDate: '2026-10-28' }, { statDate: '2026-09-29', inquiryOrderUserCnt: 1 },
    { statDate: '2026-10-29', inquiryOrderUserCnt: 9 }],
  'cs.todayRealtime': { consultUserCnt: 18, needReplyUserCnt: 2, manuReceiveUserCnt: 16,
    replyRate3Min: 0.875, replyRate3MinThreshold: 0.5 },
  'cs.todayUnreply': { unreply_num: 1 },
  'cs.todayHourConsult': [{ hour: 10, replyUser3Min: 4, unReplyUser3Min: 1 }, { hour: 0, replyUser3Min: 0, unReplyUser3Min: 0 }] };
});

it('defaults to thirty Shanghai dates ending yesterday and filters the fixed month trend', async () => {
  const view = await getCustomerServiceView(ctx);
  assert.deepEqual(view.window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.deepEqual(fixtures.calls, [{ name: 'cs.overview', params: { startDate: '2026-10-01', endDate: '2026-10-30' } },
    { name: 'cs.monthTrend', params: {} },
    { name: 'cs.salesOverview', params: { startDate: '2026-09-29', endDate: '2026-10-28' } },
    { name: 'cs.monthSalesTrend', params: {} },
    { name: 'cs.todayRealtime', params: {} },
    { name: 'cs.todayUnreply', params: {} },
    { name: 'cs.todayHourConsult', params: { startDate: '2026-10-31', endDate: '2026-10-31' } }]);
  assert.deepEqual(view.trend.items.map((item) => item.date), ['2026-10-01', '2026-10-30']);
  assert.equal(view.today.snapshot_at, '2026-10-31 00:30:00');
  assert.equal(view.today.unreply_user_count, 1);
  assert.deepEqual(view.today.hourly.map((entry) => entry.hour), ['00', '10']);
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

it('ends the sales window three Shanghai dates back and filters the fixed month sales trend', async () => {
  const { sales, window } = await getCustomerServiceView(ctx);
  assert.deepEqual(sales.window, { start_date: '2026-09-29', end_date: '2026-10-28', days: 30 });
  assert.deepEqual(window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.deepEqual(sales.trend.items.map((item) => item.date), ['2026-09-29', '2026-10-28']);
  assert.equal(sales.trend.items[1].inquiry_user_count, null);
  assert.deepEqual(sales.summary, { inquiry_user_count: 12, group_user_count: 6,
    inquiry_conversion_rate_pct: 50, cs_sales_amount_yuan: 153.67 });
});

it.each([[1, '2026-10-28', 1], [62, '2026-08-28', 62]])('moves the sales window start with %s days', async (days, start, salesDays) => {
  const { sales } = await getCustomerServiceView(ctx, { days });
  assert.deepEqual(sales.window, { start_date: start, end_date: '2026-10-28', days: salesDays });
});

it('caps the sales window at the 62 days the platform lets a merchant select', async () => {
  const view = await getCustomerServiceView(ctx, { days: 63 });
  assert.deepEqual(view.window, { start_date: '2026-08-29', end_date: '2026-10-30', days: 63 });
  assert.deepEqual(view.sales.window, { start_date: '2026-08-28', end_date: '2026-10-28', days: 62 });
  assert.deepEqual(fixtures.calls.find((call) => call.name === 'cs.salesOverview').params,
    { startDate: '2026-08-28', endDate: '2026-10-28' });
});

it('uses calendar arithmetic for the sales window across leap day and month end', async () => {
  vi.setSystemTime(new Date('2024-03-02T16:00:00Z'));
  assert.deepEqual((await getCustomerServiceView(ctx, { days: 3 })).sales.window,
    { start_date: '2024-02-27', end_date: '2024-02-29', days: 3 });
});

it('drops the whole sales block when the interval summary fails and skips the daily request', async () => {
  fixtures.errors['cs.salesOverview'] = new PddCliError({ code: 'E_BUSINESS', message: 'fixture failure', exitCode: 6 });
  const view = await getCustomerServiceView(ctx);
  assert.equal(view.sales, null);
  assert.deepEqual(view.hints, ['客服销售数据拉取失败']);
  assert.equal(view.headline.length, 2);
  assert.equal(view.summary.consult_user_count, 3);
  assert.equal(view.trend.items.length, 2);
  assert.equal(fixtures.calls.some((call) => call.name === 'cs.monthSalesTrend'), false);
});

it('keeps the sales summary when only the daily sales trend fails', async () => {
  fixtures.errors['cs.monthSalesTrend'] = new PddCliError({ code: 'E_GENERAL', message: 'fixture failure', exitCode: 1 });
  const view = await getCustomerServiceView(ctx);
  assert.equal(view.sales.trend, null);
  assert.equal(view.sales.summary.inquiry_user_count, 12);
  assert.deepEqual(view.hints, ['客服销售逐日趋势拉取失败']);
  assert.equal(view.headline.length, 3);
});

it('degrades today failures to null while retaining summary, trend and sales', async () => {
  fixtures.errors['cs.todayUnreply'] = new PddCliError({ code: 'E_NETWORK', message: 'today failed', exitCode: 5 });
  const view = await getCustomerServiceView(ctx);
  assert.equal(view.today, null);
  assert.deepEqual(view.hints, ['今日实时客服数据拉取失败，today 为 null，历史数据不受影响']);
  assert.equal(view.headline.length, 2);
  assert.equal(view.summary.consult_user_count, 3);
  assert.equal(view.sales.summary.inquiry_user_count, 12);
});

it('rethrows timeouts and program errors raised while collecting sales or today', async () => {
  const timeout = new PddCliError({ code: 'E_TIMEOUT', message: 'fixture timeout', exitCode: 5 });
  fixtures.errors['cs.salesOverview'] = timeout;
  await assert.rejects(getCustomerServiceView(ctx), (actual) => actual === timeout);
  delete fixtures.errors['cs.salesOverview'];
  fixtures.errors['cs.todayHourConsult'] = timeout;
  await assert.rejects(getCustomerServiceView(ctx), (actual) => actual === timeout);
  delete fixtures.errors['cs.todayHourConsult'];
  const bug = new TypeError('fixture bug');
  fixtures.errors['cs.monthSalesTrend'] = bug;
  await assert.rejects(getCustomerServiceView(ctx), (actual) => actual === bug);
  delete fixtures.errors['cs.monthSalesTrend'];
  fixtures.errors['cs.todayRealtime'] = bug;
  await assert.rejects(getCustomerServiceView(ctx), (actual) => actual === bug);
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
