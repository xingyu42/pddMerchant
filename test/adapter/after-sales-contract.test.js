import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { PDD_HOME } from '../../src/adapter/auth-state.js';
import * as endpoints from '../../src/adapter/endpoints/after-sales.js';
import { isSuccessfulResponse } from '../../src/adapter/response-interpreter.js';
import { isNetworkError } from '../helpers/error-matchers.js';

const { AFTER_SALES_LIST, AFTER_SALES_PARAMS, AFTER_SALES_STATUS_FILTERS, AFTER_SALES_TYPE_FILTERS } = endpoints;

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

  it('sends the supported search and status filters without time bounds for all history', () => {
    for (const [scope, expected] of Object.entries({
      open: [1, 2, 3, 4, 7, 9, 10, 11, 14, 15, 18, 21, 22, 27, 31, 32],
      refunded: [5], closed: [6, 12, 17, 24],
    })) {
      const statuses = AFTER_SALES_STATUS_FILTERS[scope];
      const payload = AFTER_SALES_LIST.buildPayload({ searchText: 'SYN-1', afterSalesStatusList: statuses });
      assert.deepEqual(payload, {
        pageNumber: 1, pageSize: 100, orderByCreatedAtDesc: true,
        searchText: 'SYN-1', afterSalesStatusList: expected,
      });
      assert.notStrictEqual(payload.afterSalesStatusList, statuses);
    }
  });

  it('sends each type as an integer and omits unsupported filter values and keys', () => {
    const base = { pageNumber: 1, pageSize: 100, orderByCreatedAtDesc: true };
    for (const [kind, expected] of Object.entries({ refund: 1, return_refund: 2, exchange: 3, resend: 4, repair: 5 })) {
      assert.deepEqual(AFTER_SALES_LIST.buildPayload({ afterSalesType: AFTER_SALES_TYPE_FILTERS[kind] }), {
        ...base, afterSalesType: expected,
      });
    }
    for (const afterSalesType of [AFTER_SALES_TYPE_FILTERS.all, [2], '2', 2.5]) {
      assert.deepEqual(AFTER_SALES_LIST.buildPayload({
        afterSalesType, afterSalesTypeList: [2], searchText: '', afterSalesStatusList: [],
      }), base);
    }
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
