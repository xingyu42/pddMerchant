import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ORDER_DETAIL } from '../src/adapter/endpoints/orders.js';

test('ORDER_DETAIL.isSuccess: accepts success:true / error_code:0 / errorCode:1000000', () => {
  assert.equal(ORDER_DETAIL.isSuccess({ success: true }), true);
  assert.equal(ORDER_DETAIL.isSuccess({ error_code: 0 }), true);
  assert.equal(ORDER_DETAIL.isSuccess({ errorCode: 1000000 }), true);
  assert.equal(ORDER_DETAIL.isSuccess({ success: false, error_code: 1000 }), false);
  assert.equal(ORDER_DETAIL.isSuccess(null), false);
});

test('ORDER_DETAIL.normalize: returns { order, raw } with result as order', () => {
  const raw = { success: true, result: { order_sn: 'X1', goods_id: 9 } };
  const norm = ORDER_DETAIL.normalize(raw);
  assert.equal(norm.order.order_sn, 'X1');
  assert.equal(norm.order.goods_id, 9);
  assert.equal(norm.raw, raw);
});

test('ORDER_DETAIL.normalize: null result yields order=null', () => {
  const norm = ORDER_DETAIL.normalize({ success: false });
  assert.equal(norm.order, null);
});

test('ORDER_DETAIL.errorMapper: error_code 1000 → E_USAGE exit 2', () => {
  const mapped = ORDER_DETAIL.errorMapper({ error_code: 1000, error_msg: '订单号不能为空' });
  assert.equal(mapped.code, 'E_USAGE');
  assert.equal(mapped.exitCode, 2);
  assert.equal(mapped.message, '订单号不能为空');
});

test('ORDER_DETAIL.errorMapper: error_code 54001 → E_RATE_LIMIT exit 4', () => {
  const mapped = ORDER_DETAIL.errorMapper({ error_code: 54001, error_msg: '操作太过频繁' });
  assert.equal(mapped.code, 'E_RATE_LIMIT');
  assert.equal(mapped.exitCode, 4);
});

test('ORDER_DETAIL.errorMapper: camelCase errorCode 54001 maps equivalently', () => {
  const mapped = ORDER_DETAIL.errorMapper({ errorCode: 54001, errorMsg: '操作太过频繁' });
  assert.equal(mapped.code, 'E_RATE_LIMIT');
  assert.equal(mapped.exitCode, 4);
});

test('ORDER_DETAIL.errorMapper: not-found message keyword → E_NOT_FOUND exit 6', () => {
  const mapped = ORDER_DETAIL.errorMapper({ error_code: 2001, error_msg: '订单不存在' });
  assert.equal(mapped.code, 'E_NOT_FOUND');
  assert.equal(mapped.exitCode, 6);
});

test('ORDER_DETAIL.errorMapper: English "not found" message also matches', () => {
  const mapped = ORDER_DETAIL.errorMapper({ errorCode: 3002, errorMsg: 'order not found' });
  assert.equal(mapped.code, 'E_NOT_FOUND');
});

test('ORDER_DETAIL.errorMapper: unrecognized business code returns null (falls to E_BUSINESS default)', () => {
  const mapped = ORDER_DETAIL.errorMapper({ error_code: 9999, error_msg: 'unknown business error' });
  assert.equal(mapped, null);
});

test('ORDER_DETAIL.errorMapper: success sentinels return null', () => {
  assert.equal(ORDER_DETAIL.errorMapper({ error_code: 0 }), null);
  assert.equal(ORDER_DETAIL.errorMapper({ errorCode: 1000000 }), null);
});

test('ORDER_DETAIL.errorMapper: non-object raw returns null', () => {
  assert.equal(ORDER_DETAIL.errorMapper(null), null);
  assert.equal(ORDER_DETAIL.errorMapper('text body'), null);
});
