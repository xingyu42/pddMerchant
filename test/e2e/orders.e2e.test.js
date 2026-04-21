// E2E · orders domain
// 覆盖：list / detail / stats（含本地 P50/P95 聚合）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope, assertFailEnvelope } from './_helpers.js';

test('e2e: orders list returns normalized orders with total', () => {
  const { status, envelope, stderr } = runPdd(['orders', 'list', '--json', '--size', '3']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'orders.list');
  assert.equal(envelope.data.total, 3);
  assert.equal(envelope.data.orders.length, 3);
  assert.equal(envelope.data.orders[0].order_sn, '240101MOCK001');
});

test('e2e: orders detail filters fixture list by sn', () => {
  const { status, envelope } = runPdd(['orders', 'detail', '--sn', '240101MOCK002', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'orders.detail');
  assert.equal(envelope.data.order.order_sn, '240101MOCK002');
  // V0 warning 标记一定存在
  assert.ok(
    envelope.meta.warnings.some((w) => w.includes('ORDER_DETAIL')),
    'V0 ORDER_DETAIL warning 必须存在'
  );
});

test('e2e: orders detail unknown sn exits BUSINESS=6', () => {
  const { status, envelope } = runPdd(['orders', 'detail', '--sn', 'NONEXISTENT', '--json']);
  assert.equal(status, 6, `BUSINESS exit code expected, got ${status}`);
  assertFailEnvelope(envelope, 'orders.detail', 'E_BUSINESS');
});

test('e2e: orders stats merges remote + local aggregation', () => {
  const { status, envelope } = runPdd(['orders', 'stats', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'orders.stats');
  assert.equal(envelope.data.remote.unship, 2);
  assert.equal(envelope.data.remote.unship12h, 1);
  assert.equal(envelope.data.local.total, 3);
  assert.equal(envelope.data.local.refund_count, 1);
  assert.ok(envelope.data.local.shipping_seconds.p50 > 0, 'P50 必须 > 0');
  assert.ok(envelope.data.local.shipping_seconds.p95 > 0, 'P95 必须 > 0');
});
