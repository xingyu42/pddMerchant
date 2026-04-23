// E2E · diagnose domain
// 覆盖：shop（4 维加权）/ orders / inventory / promo / funnel
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: diagnose shop aggregates 4 dimensions with weighted score', () => {
  const { status, envelope, stderr } = runPdd(['diagnose', 'shop', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'diagnose.shop');
  const d = envelope.data;
  assert.ok(typeof d.score === 'number', 'shop score 必须是 number');
  assert.ok(['green', 'yellow', 'red', 'partial'].includes(d.status), `未知 status=${d.status}`);
  assert.ok(d.dimensions, '必须有 dimensions 字段');
  for (const key of ['orders', 'inventory', 'promo', 'funnel']) {
    assert.ok(key in d.dimensions, `dimensions.${key} missing`);
  }
  assert.ok(Array.isArray(d.issues));
  assert.ok(Array.isArray(d.hints));
});

test('e2e: diagnose orders dimension: fixture triggers red status', () => {
  const { status, envelope } = runPdd(['diagnose', 'orders', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'diagnose.orders');
  // fixture 中 P95≈175h，退款率≈33%，必 red
  assert.equal(envelope.data.status, 'red');
  assert.ok(envelope.data.issues.length >= 1, '至少 1 个 issue');
});

test('e2e: diagnose inventory dimension: fixture triggers red status', () => {
  const { status, envelope } = runPdd(['diagnose', 'inventory', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'diagnose.inventory');
  assert.equal(envelope.data.status, 'red');
  assert.equal(envelope.data.detail.total, 3);
  assert.equal(envelope.data.detail.out_of_stock, 1);
  // V0.1 stale detection wired (fixture orders 与 goods 名称不一致 → 2 件 stale，matched_by=mixed)
  assert.equal(envelope.data.detail.stale_count, 2);
  assert.equal(envelope.data.detail.matched_by, 'mixed');
  assert.ok(Array.isArray(envelope.data.detail.stale_sample));
  assert.equal(envelope.data.detail.stale_sample.length, 2);
});

test('e2e: diagnose promo dimension: fixture triggers green status', () => {
  const { status, envelope } = runPdd(['diagnose', 'promo', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'diagnose.promo');
  // fixture GMV/Spend = 35000/1300 ≈ ROI 26.9，必 green
  assert.equal(envelope.data.status, 'green');
  assert.equal(envelope.data.score, 100);
});

test('e2e: diagnose funnel dimension: order fulfillment funnel from listOrders', () => {
  const { status, envelope } = runPdd(['diagnose', 'funnel', '--json']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'diagnose.funnel');
  // fixture 3 单 1 退款 → refund_rate≈0.333 (>15%) + conversion≈0.667 (<85%) → red
  assert.equal(envelope.data.status, 'red');
  assert.equal(envelope.data.detail.total_orders, 3);
  assert.equal(envelope.data.detail.refund_count, 1);
  assert.ok(envelope.data.detail.refund_rate > 0.3);
  assert.ok(envelope.data.issues.length >= 1);
});
