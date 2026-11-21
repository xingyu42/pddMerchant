import { it } from 'vitest';
import assert from 'node:assert/strict';
import { CS_OVERVIEW, CS_MONTH_TREND, CS_SALES_OVERVIEW,
  CS_MONTH_SALES_TREND } from '../../src/adapter/endpoints/customer-service.js';
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
