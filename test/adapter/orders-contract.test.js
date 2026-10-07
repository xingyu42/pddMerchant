import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import {
  ORDER_LIST, ORDER_DETAIL, ORDER_STATS, ORDER_LIST_CLI_SCOPES, ORDER_LIST_DEFAULT_SCOPE, ORDER_LIST_SCOPES,
} from '../../src/adapter/endpoints/orders.js';
import { isNetworkError } from '../helpers/error-matchers.js';

describe('order response contracts', () => {
  it('initializes the merchant runtime before page-api list/stats calls (diagnose uses fresh pages)', () => {
    for (const spec of [ORDER_LIST, ORDER_STATS]) {
      assert.equal(spec.strategy, 'page-api');
      assert.match(spec.nav?.url ?? '', /^https:\/\/mms\.pinduoduo\.com/);
    }
  });

  it('preserves real zero counts and a genuinely empty list', () => {
    const raw = { success: true, result: { totalItemNum: 0, pageItems: [] } };
    assert.deepEqual(ORDER_LIST.normalize(raw), { total: 0, orders: [], raw });
    assert.equal(ORDER_LIST.isSuccess(raw), true);
    assert.equal(ORDER_LIST.isSuccess({ success: 'true' }), false);
  });

  it.each([
    ['missing result', {}],
    ['missing total', { result: { pageItems: [] } }],
    ['missing orders', { result: { totalItemNum: 0 } }],
    ['non-array orders', { result: { totalItemNum: 0, pageItems: {} } }],
    ['string total', { result: { totalItemNum: '0', pageItems: [] } }],
    ['non-finite total', { result: { totalItemNum: Infinity, pageItems: [] } }],
  ])('rejects %s instead of inventing empty data', (_label, raw) => {
    assert.throws(() => ORDER_LIST.normalize(raw), isNetworkError);
  });

  it('preserves a populated list and the reported total independently of page length', () => {
    const orders = [{ orderSn: 'SYN-1' }, { order_sn: 'SYN-2' }];
    const result = ORDER_LIST.normalize({ result: { totalItemNum: 25, pageItems: orders } });
    assert.equal(result.total, 25);
    assert.deepEqual(result.orders, orders);
  });

  it.each(['orderSn', 'order_sn'])('accepts detail identity %s', (key) => {
    const order = { [key]: 'SYN-DETAIL', order_status: 1 };
    assert.deepEqual(ORDER_DETAIL.normalize({ result: order }).order, order);
  });

  it.each([undefined, null, [], 'invalid', {}])('rejects malformed detail %#', (result) => {
    assert.throws(() => ORDER_DETAIL.normalize({ result }), isNetworkError);
  });

  it('preserves explicit zero values for every remote counter', () => {
    const result = { unship: 0, unship12h: 0, delay: 0, unreceive: 0 };
    const normalized = ORDER_STATS.normalize({ result });
    for (const field of Object.keys(result)) assert.equal(normalized[field], 0);
  });

  it.each([
    ['unship', undefined], ['unship', null], ['unship', '0'], ['unship', NaN], ['unship', Infinity],
    ['unship12h', undefined], ['unship12h', null], ['unship12h', '0'], ['unship12h', NaN], ['unship12h', Infinity],
    ['delay', undefined], ['delay', null], ['delay', '0'], ['delay', NaN], ['delay', Infinity],
    ['unreceive', undefined], ['unreceive', null], ['unreceive', '0'], ['unreceive', NaN], ['unreceive', Infinity],
  ])('requires numeric counter %s with value %s', (field, value) => {
    const result = { unship: 0, unship12h: 0, delay: 0, unreceive: 0, [field]: value };
    assert.throws(() => ORDER_STATS.normalize({ result }), isNetworkError);
  });
});

describe('order request and business errors', () => {
  it('uses a stable seven-day default and preserves explicit page, size and epoch values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    const defaults = ORDER_LIST.buildPayload();
    assert.equal(defaults.groupStartTime, 1699395200);
    assert.equal(defaults.groupEndTime, 1700000000);
    assert.equal(defaults.pageNumber, 1);
    assert.equal(defaults.pageSize, 20);
    const supplied = ORDER_LIST.buildPayload({ page: 3, size: 50, since: 0, until: 200 });
    assert.equal(supplied.pageNumber, 3);
    assert.equal(supplied.pageSize, 50);
    assert.equal(supplied.groupStartTime, 0);
    assert.equal(supplied.groupEndTime, 200);
    assert.deepEqual(ORDER_DETAIL.buildPayload({ order_sn: 'SYN-1' }), { orderSn: 'SYN-1', source: 'MMS' });
    vi.useRealTimers();
  });

  it('defaults to every order including after-sales, refunded and cancelled ones', () => {
    const defaults = ORDER_LIST.buildPayload({});
    assert.equal(defaults.orderType, 0);
    assert.equal(defaults.afterSaleType, 0);
    assert.equal(ORDER_LIST_DEFAULT_SCOPE, 'all');
  });

  it.each([
    ['all', 0, 0],
    ['valid', 0, 1],
    ['pending_ship', 1, 1],
    ['shipped', 2, 1],
    ['received', 3, 1],
    ['after_sales', 0, 2],
  ])('maps scope %s to orderType %i / afterSaleType %i', (scope, orderType, afterSaleType) => {
    const payload = ORDER_LIST.buildPayload({ scope });
    assert.equal(payload.orderType, orderType);
    assert.equal(payload.afterSaleType, afterSaleType);
    assert.deepEqual(ORDER_LIST_SCOPES[scope], { orderType, afterSaleType });
  });

  it('ignores a raw orderType passthrough and rejects unknown scopes as usage errors', () => {
    assert.equal(ORDER_LIST.buildPayload({ orderType: 7 }).orderType, 0);
    for (const scope of ['bogus', 'toString', '']) {
      assert.throws(() => ORDER_LIST.buildPayload({ scope }), (err) => err.code === 'E_USAGE' && err.exitCode === 2);
    }
  });

  it('exposes only verified user-facing scopes to the CLI (internal valid excluded)', () => {
    assert.deepEqual([...ORDER_LIST_CLI_SCOPES], ['all', 'pending_ship', 'shipped', 'received', 'after_sales']);
    for (const scope of ORDER_LIST_CLI_SCOPES) assert.ok(Object.hasOwn(ORDER_LIST_SCOPES, scope));
  });

  it.each([
    ['snake usage', { error_code: 1000, error_msg: 'invalid order' }, 'E_USAGE', 2],
    ['camel usage', { errorCode: 1000, errorMsg: 'invalid order' }, 'E_USAGE', 2],
    ['snake rate limit', { error_code: 54001, error_msg: 'slow down' }, 'E_RATE_LIMIT', 4],
    ['camel rate limit', { errorCode: 54001, errorMsg: 'slow down' }, 'E_RATE_LIMIT', 4],
    ['missing order', { error_code: 4001, error_msg: 'Order NOT FOUND' }, 'E_NOT_FOUND', 6],
  ])('maps %s without collapsing distinct failures', (_label, raw, code, exitCode) => {
    const mapped = ORDER_DETAIL.errorMapper(raw);
    assert.equal(mapped.code, code);
    assert.equal(mapped.exitCode, exitCode);
  });

  it('accepts documented success forms and leaves unknown failures to the shared mapper', () => {
    for (const raw of [{ success: true }, { error_code: 0 }, { errorCode: 1000000 }]) {
      assert.equal(ORDER_DETAIL.isSuccess(raw), true);
    }
    assert.equal(ORDER_DETAIL.isSuccess({ success: false, errorCode: 4001 }), false);
    assert.equal(ORDER_DETAIL.errorMapper({ errorCode: 9876, errorMsg: 'unknown failure' }), null);
  });
});
