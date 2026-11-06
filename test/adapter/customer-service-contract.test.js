import { it } from 'vitest';
import assert from 'node:assert/strict';
import { CS_OVERVIEW, CS_MONTH_TREND } from '../../src/adapter/endpoints/customer-service.js';
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
    assert.equal(spec.isSuccess({ success: true, errorCode: 1000000 }), true);
    assert.equal(spec.isSuccess({ success: true, errorCode: 0 }), true);
    assert.equal(spec.isSuccess({ success: true }), false);
    assert.equal(spec.isSuccess({ success: false, errorCode: 1000000 }), false);
    assert.equal(spec.errorMapper({ errorCode: 40002, errorMsg: '失败' }).code, 'E_BUSINESS');
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
