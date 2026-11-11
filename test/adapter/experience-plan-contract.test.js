import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  PLAN_STATUS, PLAN_AVAILABLE_INFO, PLAN_PROFITS, PLAN_ORDER_INSURANCE_LIST,
} from '../../src/adapter/endpoints/experience-plan.js';
import { interpretResponse } from '../../src/adapter/response-interpreter.js';

const specs = [PLAN_STATUS, PLAN_AVAILABLE_INFO, PLAN_PROFITS, PLAN_ORDER_INSURANCE_LIST];
const ok = (result) => ({ success: true, errorCode: 1000, errorMsg: null, result });

describe('experience plan fee page-api contracts', () => {
  it('uses the signed page client on the return freight page with exact read-only endpoints', () => {
    const paths = {
      'experiencePlan.status': '/mms-gateway/rfreight/mall_insurance_status',
      'experiencePlan.availableInfo': '/mms-gateway/rfreight/mallInsurance/queryAvailableInfo',
      'experiencePlan.profits': '/mms-gateway/rfreight/postpaid/profits',
      'experiencePlan.orderInsuranceList': '/mms-gateway/rfreight/postpaid/order_insurance_list',
    };
    for (const spec of specs) {
      assert.equal(spec.strategy, 'page-api');
      assert.equal(spec.nav.url, 'https://mms.pinduoduo.com/freight/return_freight');
      assert.equal(spec.apiUrl, paths[spec.name]);
    }
  });

  it('builds the request bodies observed on the page', () => {
    assert.deepEqual(PLAN_STATUS.buildPayload({ noise: 1 }), {});
    assert.deepEqual(PLAN_AVAILABLE_INFO.buildPayload({ noise: 1 }), {});
    assert.deepEqual(PLAN_PROFITS.buildPayload({ days: 7 }), { farDate: 6, closerDate: 0 });
    assert.deepEqual(PLAN_PROFITS.buildPayload({ days: 1 }), { farDate: 0, closerDate: 0 });
    // 页面默认：收费状态 1 待收费 + 2 收费成功，按创建时间筛选（毫秒）
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.buildPayload({
      page: 3, createBeginTime: 1762444800000, createEndTime: 1763049599999, noise: 1,
    }), { pageSize: 10, pageNumber: 2, queryFeeStatusList: [1, 2], clientType: 1,
      createBeginTime: 1762444800000, createEndTime: 1763049599999 });
  });

  it('accepts success true with errorCode 1000 and rejects the 1000000 report code', () => {
    const context = (raw) => ({ raw, response: null, status: 200, params: {} });
    assert.deepEqual(interpretResponse(PLAN_STATUS, context(ok({ configStatus: 1 }))), { configStatus: 1 });
    assert.throws(() => interpretResponse(PLAN_STATUS, context({ success: true, errorCode: 1000000, result: {} })),
      { code: 'E_BUSINESS' });
    assert.throws(() => interpretResponse(PLAN_PROFITS, context({ success: false, errorCode: 4000, errorMsg: '合成上游错误' })),
      (error) => error.code === 'E_BUSINESS' && error.message === '合成上游错误' && error.exitCode === 6);
  });

  it('projects only the fields the report reads', () => {
    assert.deepEqual(PLAN_STATUS.normalize(ok({ configStatus: 1, restartTime: 0, pauseRestartMode: 2, mallId: 1 })),
      { configStatus: 1 });
    const price = { unit: 'YUAN', value: '1.11', unitCode: 1 };
    assert.deepEqual(PLAN_AVAILABLE_INFO.normalize(ok({ normalService: { algoDailyStrategy: {
      priceType: 1, price, smallPrice: price, largePrice: price } } })), { price });
    assert.deepEqual(PLAN_AVAILABLE_INFO.normalize(ok({})), { price: null });
    assert.deepEqual(PLAN_PROFITS.normalize(ok({ orderCount: 209, compensationCount: 3, mallId: 1 })),
      { orderCount: 209, compensationCount: 3 });
    const row = { orderSn: 'SYN-ORDER-1', sn: 'SYN-ORDER-1-MI', batchSn: 'SYN-BATCH', mallId: 1, uid: 2,
      serviceAmountVO: price, costVO: price, status: 2, feeStatusDesc: '收费成功', displayStatus: 1,
      effectiveTime: 1762500000000, ineffectiveTime: 0, shippingTime: 1762490000000, isFree: false,
      hasDiscount: false, discount: null, insuranceMode: 1 };
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 203, orderInsurances: [row] })), {
      total: 203, items: [{ orderSn: 'SYN-ORDER-1', serviceAmountVO: price, feeStatusDesc: '收费成功',
        displayStatus: 1, effectiveTime: 1762500000000, shippingTime: 1762490000000, isFree: false }],
    });
  });

  it('rejects missing shapes instead of fabricating data', () => {
    for (const spec of [PLAN_STATUS, PLAN_PROFITS, PLAN_ORDER_INSURANCE_LIST]) {
      assert.throws(() => spec.normalize(ok(null)), { code: 'E_NETWORK' });
    }
    assert.throws(() => PLAN_ORDER_INSURANCE_LIST.normalize(ok({ orderInsurances: [] })), { code: 'E_NETWORK' });
    assert.throws(() => PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 1, orderInsurances: [null] })),
      { code: 'E_NETWORK' });
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 0, orderInsurances: null })),
      { total: 0, items: [] });
  });
});
