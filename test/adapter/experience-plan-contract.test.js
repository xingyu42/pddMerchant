import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PLAN_ORDER_INSURANCE_LIST } from '../../src/adapter/endpoints/experience-plan.js';
import { interpretResponse } from '../../src/adapter/response-interpreter.js';

const ok = (result) => ({ success: true, errorCode: 1000, errorMsg: null, result });

describe('experience plan charge list page-api contract', () => {
  it('uses the signed page client on the return freight page', () => {
    assert.equal(PLAN_ORDER_INSURANCE_LIST.strategy, 'page-api');
    assert.equal(PLAN_ORDER_INSURANCE_LIST.nav.url, 'https://mms.pinduoduo.com/freight/return_freight');
    assert.equal(PLAN_ORDER_INSURANCE_LIST.apiUrl, '/mms-gateway/rfreight/postpaid/order_insurance_list');
  });

  it('builds the page default request body with a 100-row page', () => {
    // 页面默认：收费状态 1 待收费 + 2 收费成功，按创建时间筛选（毫秒）；pageSize 100 经真实账号实测可用
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.buildPayload({
      page: 3, createBeginTime: 1762444800000, createEndTime: 1763049599999, noise: 1,
    }), { pageSize: 100, pageNumber: 2, queryFeeStatusList: [1, 2], clientType: 1,
      createBeginTime: 1762444800000, createEndTime: 1763049599999 });
  });

  it('accepts success true with errorCode 1000 or 0 and rejects other codes', () => {
    const context = (raw) => ({ raw, response: null, status: 200, params: {} });
    const result = { total: 0, orderInsurances: [] };
    assert.deepEqual(interpretResponse(PLAN_ORDER_INSURANCE_LIST, context(ok(result))), { total: 0, items: [] });
    // 真实账号经 page-api 返回 errorCode 0（浏览器抓包为 1000），两者都是成功
    assert.deepEqual(interpretResponse(PLAN_ORDER_INSURANCE_LIST, context({ success: true, errorCode: 0, result })),
      { total: 0, items: [] });
    assert.throws(() => interpretResponse(PLAN_ORDER_INSURANCE_LIST,
      context({ success: true, errorCode: 1000000, result })), { code: 'E_BUSINESS' });
    assert.throws(() => interpretResponse(PLAN_ORDER_INSURANCE_LIST,
      context({ success: false, errorCode: 4000, errorMsg: '合成上游错误' })),
    (error) => error.code === 'E_BUSINESS' && error.message === '合成上游错误' && error.exitCode === 6);
  });

  it('projects only the fields goods profit reads', () => {
    const price = { unit: 'YUAN', value: '1.11', unitCode: 1 };
    const row = { orderSn: 'SYN-ORDER-1', sn: 'SYN-ORDER-1-MI', batchSn: 'SYN-BATCH', mallId: 1, uid: 2,
      serviceAmountVO: price, costVO: price, status: 2, feeStatusDesc: '收费成功', displayStatus: 1,
      effectiveTime: 1762500000000, ineffectiveTime: 0, shippingTime: 1762490000000, isFree: false,
      hasDiscount: false, discount: null, insuranceMode: 1 };
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 203, orderInsurances: [row] })), {
      total: 203, items: [{ orderSn: 'SYN-ORDER-1', serviceAmountVO: price, feeStatusDesc: '收费成功' }],
    });
  });

  it('rejects missing shapes instead of fabricating data', () => {
    assert.throws(() => PLAN_ORDER_INSURANCE_LIST.normalize(ok(null)), { code: 'E_NETWORK' });
    assert.throws(() => PLAN_ORDER_INSURANCE_LIST.normalize(ok({ orderInsurances: [] })), { code: 'E_NETWORK' });
    assert.throws(() => PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 1, orderInsurances: [null] })),
      { code: 'E_NETWORK' });
    assert.deepEqual(PLAN_ORDER_INSURANCE_LIST.normalize(ok({ total: 0, orderInsurances: null })),
      { total: 0, items: [] });
  });
});
