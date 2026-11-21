import { it } from 'vitest';
import assert from 'node:assert/strict';
import { CS_OVERVIEW, CS_MONTH_TREND, CS_SALES_OVERVIEW,
  CS_MONTH_SALES_TREND, CS_TODAY_REALTIME, CS_TODAY_UNREPLY,
  CS_TODAY_HOUR_CONSULT } from '../../src/adapter/endpoints/customer-service.js';
import { resolveEndpointStrategy } from '../../src/adapter/endpoint-strategy-resolver.js';

it('uses page-api for the interval and passive legacy capture for the month', () => {
  assert.equal(CS_OVERVIEW.strategy, 'page-api');
  assert.equal(CS_OVERVIEW.apiUrl, '/desert/stat/mallServiceOverviewData');
  assert.deepEqual(CS_OVERVIEW.buildPayload({ startDate: '2026-10-01', endDate: '2026-10-30', noise: 1 }),
    { startDate: '2026-10-01', endDate: '2026-10-30' });
  assert.equal(resolveEndpointStrategy(CS_MONTH_TREND).strategy, 'legacy');
  assert.ok(CS_MONTH_TREND.urlPattern.test('/desert/stat/mallMonthServiceData'));
  for (const spec of [CS_OVERVIEW, CS_MONTH_TREND]) {
    assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/mms-chat/overview/service');
  }
});

it('projects confirmed metrics and nulls without account names or comparison fields', () => {
  const result = { consultUserCnt: 3, manuReplyRate3Min: null, statDate: '2026-10-30',
    avgReplyTimeTop10: 5.55, cs_name: 'PRIVATE', consultUserCntCompare: 9 };
  assert.deepEqual(CS_OVERVIEW.normalize({ result }), { consultUserCnt: 3, manuReplyRate3Min: null });
  assert.deepEqual(CS_MONTH_TREND.normalize({ result: [result] }), [{ statDate: '2026-10-30',
    consultUserCnt: 3, manuReplyRate3Min: null, avgReplyTimeTop10: 5.55 }]);
  for (const spec of [CS_OVERVIEW, CS_MONTH_TREND]) {
    assert.throws(() => spec.normalize({}), { code: 'E_NETWORK' });
  }
  assert.throws(() => CS_MONTH_TREND.normalize({ result: [null] }), { code: 'E_NETWORK' });
});

it('uses page-api for the sales interval and a tab click before capturing the month sales', async () => {
  assert.equal(CS_SALES_OVERVIEW.strategy, 'page-api');
  assert.equal(CS_SALES_OVERVIEW.apiUrl, '/desert/stat/mallSalesOverviewData');
  assert.deepEqual(CS_SALES_OVERVIEW.buildPayload({ startDate: '2026-11-10', endDate: '2026-11-16', noise: 1 }),
    { startDate: '2026-11-10', endDate: '2026-11-16' });
  assert.equal(resolveEndpointStrategy(CS_MONTH_SALES_TREND).strategy, 'legacy');
  assert.ok(CS_MONTH_SALES_TREND.urlPattern.test('/desert/stat/mallMonthSalesData'));
  assert.equal(CS_MONTH_SALES_TREND.urlPattern.test('/desert/stat/mallMonthServiceData'), false);
  assert.equal(CS_MONTH_TREND.urlPattern.test('/desert/stat/mallMonthSalesData'), false);
  assert.equal(CS_MONTH_SALES_TREND.requiredTrigger, true);
  for (const spec of [CS_SALES_OVERVIEW, CS_MONTH_SALES_TREND]) {
    assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/mms-chat/overview/service');
    assert.equal(spec.errorMap, 'upstream');
  }
  const clicks = [];
  const page = { getByText: (text, options) => ({ first: () => ({
    click: async (clickOptions) => { clicks.push({ text, options, clickOptions }); } }) }) };
  await CS_MONTH_SALES_TREND.trigger(page);
  assert.equal(clicks.length, 1);
  assert.equal(clicks[0].text, '销售数据');
  assert.deepEqual(clicks[0].options, { exact: true });
});

it('projects confirmed sales metrics and drops the improvable amount and comparison fields', () => {
  const result = { inquiryOrderUserCnt: 12, groupUserCnt: 6, inquiryOrderTransformRate: 0.5, csSalesAmount: null,
    csCanImproveSalesAmount: 23.14, inquiryOrderUserCntCompare: 0.2, statDate: '2026-11-16',
    inquiryConfirmRateTop10Avg: 0.82, inquiryConfirmRateTotalAvg: null };
  assert.deepEqual(CS_SALES_OVERVIEW.normalize({ result }), { inquiryOrderUserCnt: 12, groupUserCnt: 6,
    inquiryOrderTransformRate: 0.5, csSalesAmount: null });
  assert.deepEqual(CS_MONTH_SALES_TREND.normalize({ result: [result] }), [{ statDate: '2026-11-16',
    inquiryOrderUserCnt: 12, groupUserCnt: 6, inquiryOrderTransformRate: 0.5, csSalesAmount: null,
    inquiryConfirmRateTop10Avg: 0.82, inquiryConfirmRateTotalAvg: null }]);
  for (const spec of [CS_SALES_OVERVIEW, CS_MONTH_SALES_TREND]) {
    assert.throws(() => spec.normalize({}), { code: 'E_NETWORK' });
  }
  assert.throws(() => CS_SALES_OVERVIEW.normalize({ result: {} }), { code: 'E_NETWORK' });
  assert.throws(() => CS_MONTH_SALES_TREND.normalize({ result: [null] }), { code: 'E_NETWORK' });
  assert.throws(() => CS_MONTH_SALES_TREND.normalize({ result: [{}] }), { code: 'E_NETWORK' });
  assert.throws(() => CS_MONTH_SALES_TREND.normalize({ result: [{ ...result, statDate: 'invalid' }] }), { code: 'E_NETWORK' });
  for (const field of ['inquiryOrderUserCnt', 'groupUserCnt', 'inquiryOrderTransformRate', 'csSalesAmount']) {
    const missingOverview = { ...result };
    delete missingOverview[field];
    assert.throws(() => CS_SALES_OVERVIEW.normalize({ result: missingOverview }), { code: 'E_NETWORK' });
    assert.throws(() => CS_MONTH_SALES_TREND.normalize({ result: [missingOverview] }), { code: 'E_NETWORK' });
  }
  const explicitNullSales = { inquiryOrderUserCnt: null, groupUserCnt: null,
    inquiryOrderTransformRate: null, csSalesAmount: null };
  assert.deepEqual(CS_SALES_OVERVIEW.normalize({ result: explicitNullSales }), explicitNullSales);
  assert.deepEqual(CS_MONTH_SALES_TREND.normalize({ result: [{ statDate: '2026-11-16', ...explicitNullSales }] }),
    [{ statDate: '2026-11-16', ...explicitNullSales }]);
});

it('uses page-api GET/POST for cs today realtime, unreply count and hourly consultations', () => {
  assert.equal(CS_TODAY_REALTIME.strategy, 'page-api');
  assert.equal(CS_TODAY_REALTIME.method, 'GET');
  assert.equal(CS_TODAY_REALTIME.apiUrl, '/desert/stat/mallServiceRealTimeData');
  assert.deepEqual(CS_TODAY_REALTIME.buildPayload({}), {});

  assert.equal(CS_TODAY_UNREPLY.strategy, 'page-api');
  assert.equal(CS_TODAY_UNREPLY.method, 'GET');
  assert.equal(CS_TODAY_UNREPLY.apiUrl, '/chats/cs/unreplyUser/count');
  assert.deepEqual(CS_TODAY_UNREPLY.buildPayload({}), {});

  assert.equal(CS_TODAY_HOUR_CONSULT.strategy, 'page-api');
  assert.equal(CS_TODAY_HOUR_CONSULT.method, undefined);
  assert.equal(CS_TODAY_HOUR_CONSULT.apiUrl, '/desert/stat/getMallHourConsultData');
  assert.deepEqual(CS_TODAY_HOUR_CONSULT.buildPayload({ startDate: '2026-11-22', endDate: '2026-11-22', extra: 1 }),
    { startDate: '2026-11-22', endDate: '2026-11-22' });

  for (const spec of [CS_TODAY_REALTIME, CS_TODAY_UNREPLY, CS_TODAY_HOUR_CONSULT]) {
    assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/mms-chat/overview/service');
    assert.equal(spec.errorMap, 'upstream');
  }

  assert.deepEqual(CS_TODAY_REALTIME.normalize({ result: { consultUserCnt: null, needReplyUserCnt: 0,
    manuReceiveUserCnt: null, replyRate3Min: null, replyRate3MinThreshold: 0.5, cs_name: 'PRIVATE' } }),
  { consultUserCnt: null, needReplyUserCnt: 0, manuReceiveUserCnt: null,
    replyRate3Min: null, replyRate3MinThreshold: 0.5 });
  assert.deepEqual(CS_TODAY_UNREPLY.normalize({ result: { unreply_num: 2, extra: 'PRIVATE' } }), { unreply_num: 2 });
  assert.deepEqual(CS_TODAY_HOUR_CONSULT.normalize({ result: { total: 1,
    list: [{ hour: 8, replyUser3Min: 3, unReplyUser3Min: 0, extra: 'PRIVATE' }] } }),
  [{ hour: 8, replyUser3Min: 3, unReplyUser3Min: 0 }]);

  assert.throws(() => CS_TODAY_REALTIME.normalize({ result: { consultUserCnt: 1 } }), { code: 'E_NETWORK' });
  assert.throws(() => CS_TODAY_UNREPLY.normalize({ result: {} }), { code: 'E_NETWORK' });
  assert.throws(() => CS_TODAY_HOUR_CONSULT.normalize({ result: { list: null } }), { code: 'E_NETWORK' });
  assert.throws(() => CS_TODAY_HOUR_CONSULT.normalize({ result: { list: [{ hour: 24, replyUser3Min: 0, unReplyUser3Min: 0 }] } }),
    { code: 'E_NETWORK' });
  assert.throws(() => CS_TODAY_HOUR_CONSULT.normalize({ result: { list: [{ hour: '08', replyUser3Min: 0, unReplyUser3Min: 0 }] } }),
    { code: 'E_NETWORK' });
  assert.throws(() => CS_TODAY_HOUR_CONSULT.normalize({ result: { list: [{ hour: 8, replyUser3Min: 0 }] } }),
    { code: 'E_NETWORK' });
});
