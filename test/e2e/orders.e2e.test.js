// E2E · orders domain
// 覆盖：list / detail / stats（含本地 P50/P95 聚合）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runPdd, assertOkEnvelope, assertFailEnvelope, PROJECT_ROOT } from './_helpers.js';

const ERROR_NOT_FOUND_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'error-not-found');
const ERROR_RATE_LIMIT_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'error-rate-limit');

test('e2e: orders list returns normalized orders with total', () => {
  const { status, envelope, stderr } = runPdd(['orders', 'list', '--json', '--size', '3']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'orders.list');
  assert.equal(envelope.data.total, 3);
  assert.equal(envelope.data.orders.length, 3);
  assert.equal(envelope.data.orders[0].order_sn, '240101MOCK001');
});

test('e2e: orders detail returns normalized order from dedicated fixture', () => {
  const { status, envelope } = runPdd(['orders', 'detail', '--sn', '240101MOCK001', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'orders.detail');
  assert.equal(envelope.data.order.order_sn, '240101MOCK001');
  assert.equal(envelope.data.order.goods_id, 732191698596);
  assert.ok(envelope.data.order.shipping, 'detail 应携带 shipping 字段');
  assert.ok(envelope.data.order.buyer_address, 'detail 应携带 buyer_address 字段');
  const warnings = envelope.meta.warnings ?? [];
  assert.ok(
    !warnings.some((w) => typeof w === 'string' && w.includes('V0: ORDER_DETAIL')),
    'V0 ORDER_DETAIL 占位 warning 不应再出现'
  );
});

test('e2e: orders detail unknown sn maps to E_NOT_FOUND exit 6', () => {
  const { status, envelope } = runPdd(
    ['orders', 'detail', '--sn', 'NONEXISTENT', '--json'],
    { PDD_TEST_FIXTURE_DIR: ERROR_NOT_FOUND_DIR }
  );
  assert.equal(status, 6, `expected BUSINESS exit 6, got ${status}`);
  assertFailEnvelope(envelope, 'orders.detail', 'E_NOT_FOUND');
});

test('e2e: orders detail rate-limited maps to E_RATE_LIMIT exit 4', () => {
  const { status, envelope } = runPdd(
    ['orders', 'detail', '--sn', 'ANY', '--json'],
    { PDD_TEST_FIXTURE_DIR: ERROR_RATE_LIMIT_DIR }
  );
  assert.equal(status, 4, `expected RATE_LIMIT exit 4, got ${status}`);
  assertFailEnvelope(envelope, 'orders.detail', 'E_RATE_LIMIT');
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
