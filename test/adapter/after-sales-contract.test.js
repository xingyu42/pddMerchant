import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { PDD_HOME } from '../../src/adapter/auth-state.js';
import * as endpoints from '../../src/adapter/endpoints/after-sales.js';
import { isSuccessfulResponse } from '../../src/adapter/response-interpreter.js';
import { isNetworkError } from '../helpers/error-matchers.js';

const { AFTER_SALES_LIST, AFTER_SALES_PARAMS } = endpoints;

describe('after-sales endpoint contracts', () => {
  it('builds a descending case-page request with only supported time keys', () => {
    assert.equal(AFTER_SALES_LIST.name, 'after_sales.list');
    assert.equal(AFTER_SALES_LIST.fixtureListKey, 'result.list');
    assert.equal(AFTER_SALES_LIST.strategy, 'page-api');
    assert.equal(AFTER_SALES_LIST.nav.url, PDD_HOME);
    assert.equal(AFTER_SALES_LIST.apiUrl, '/mercury/mms/afterSales/queryList');
    assert.deepEqual(AFTER_SALES_LIST.buildPayload(), {
      pageNumber: 1, pageSize: 100, orderByCreatedAtDesc: true,
    });
    assert.deepEqual(AFTER_SALES_LIST.buildPayload({
      page: 2, pageSize: 50, startCreatedTime: 0, endCreatedTime: 1700000000,
      beginTime: 1, endTime: 2, orderSn: 'SYN-1', goodsId: 1, statusList: [5],
    }), {
      pageNumber: 2, pageSize: 50, orderByCreatedAtDesc: true, startCreatedTime: 0, endCreatedTime: 1700000000,
    });
    assert.deepEqual(AFTER_SALES_LIST.buildPayload({ startCreatedTime: '0', endCreatedTime: Infinity }), {
      pageNumber: 1, pageSize: 100, orderByCreatedAtDesc: true,
    });
  });

  it('preserves the platform total and rejects malformed list responses', () => {
    const list = [{ id: 1 }];
    assert.deepEqual(AFTER_SALES_LIST.normalize({ result: { total: 101, list } }), { total: 101, items: list });
    assert.deepEqual(AFTER_SALES_LIST.normalize({ result: { total: 0, list: [] } }), { total: 0, items: [] });
    for (const result of [undefined, [], { list }, { total: 0 }, { total: 0, list: {} },
      ...[-1, 0.5, '0', Infinity, NaN].map((total) => ({ total, list }))]) {
      assert.throws(() => AFTER_SALES_LIST.normalize({ result }), isNetworkError);
    }
  });

  it('reads an optional reason dictionary through the merchant runtime', () => {
    assert.equal(AFTER_SALES_PARAMS.name, 'after_sales.params');
    assert.equal(AFTER_SALES_PARAMS.strategy, 'page-api');
    assert.equal(AFTER_SALES_PARAMS.nav.url, PDD_HOME);
    assert.equal(AFTER_SALES_PARAMS.apiUrl, '/mercury/mms/afterSales/queryParams');
    assert.deepEqual(AFTER_SALES_PARAMS.buildPayload({ noise: true }), {});
    const raw = { success: true, errorCode: 0, result: { reasonCodeParams: { 七天无理由退货: [88, '66'], 质量问题: [81] } } };
    for (const spec of [AFTER_SALES_LIST, AFTER_SALES_PARAMS]) {
      assert.equal(isSuccessfulResponse(raw, spec.successRule), true);
    }
    assert.deepEqual(AFTER_SALES_PARAMS.normalize(raw), {
      reasonCategoryMap: { 88: '七天无理由退货', 66: '七天无理由退货', 81: '质量问题' },
    });
    assert.deepEqual(AFTER_SALES_PARAMS.normalize({ result: { reasonCodeParams: {} } }), { reasonCategoryMap: {} });
    for (const result of [null, [], {}, { reasonCodeParams: null }, { reasonCodeParams: [] },
      { reasonCodeParams: new Date() }, { reasonCodeParams: { 质量问题: 81 } }]) {
      assert.throws(() => AFTER_SALES_PARAMS.normalize({ result }), isNetworkError);
    }
  });
});
