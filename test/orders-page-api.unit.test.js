import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ORDER_DETAIL, ORDER_LIST, ORDER_STATS } from '../src/adapter/endpoints/orders.js';
import { resolveEndpointStrategy } from '../src/adapter/endpoint-strategy-resolver.js';

for (const spec of [ORDER_LIST, ORDER_DETAIL, ORDER_STATS]) {
  test(`${spec.name} uses the single page-api route without navigation or triggers`, () => {
    assert.equal(resolveEndpointStrategy(spec).strategy, 'page-api');
    assert.equal(spec.strategy, 'page-api');
    assert.equal(spec.nav, undefined);
    assert.equal(spec.urlPattern, undefined);
    assert.equal(spec.trigger, undefined);
  });
}

test('orders.detail sends the live camelCase orderSn request field', () => {
  assert.deepEqual(
    ORDER_DETAIL.buildPayload({ order_sn: 'ORDER-1', source: 'MMS' }),
    { orderSn: 'ORDER-1', source: 'MMS' },
  );
});

test('orders.list preserves a legitimate zero only when the required shape is present', () => {
  assert.deepEqual(
    ORDER_LIST.normalize({ success: true, result: { totalItemNum: 0, pageItems: [] } }),
    {
      total: 0,
      orders: [],
      raw: { success: true, result: { totalItemNum: 0, pageItems: [] } },
    },
  );
});

test('orders.list rejects a malformed success response instead of fabricating zero orders', () => {
  assert.throws(
    () => ORDER_LIST.normalize({ success: true, result: {} }),
    (error) => error.code === 'E_NETWORK' && /response shape/i.test(error.message),
  );
});

test('orders.stats distinguishes legitimate zeros from missing fields', () => {
  const raw = {
    success: true,
    result: { unship: 0, unship12h: 0, delay: 0, unreceive: 0 },
  };
  assert.equal(ORDER_STATS.normalize(raw).unreceive, 0);
  assert.throws(
    () => ORDER_STATS.normalize({ success: true, result: {} }),
    (error) => error.code === 'E_NETWORK',
  );
});

test('orders.detail rejects a missing order object instead of returning null success', () => {
  assert.throws(
    () => ORDER_DETAIL.normalize({ success: true, result: null }),
    (error) => error.code === 'E_NETWORK',
  );
});
