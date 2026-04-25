// E2E · goods domain
// 覆盖：list / stock（低库存筛选）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: goods list returns normalized goods with total and mall', () => {
  const { status, envelope, stderr } = runPdd(['goods', 'list', '--json', '--size', '3']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'goods.list');
  assert.ok(Array.isArray(envelope.data));
  assert.equal(envelope.data.length, 3);
  assert.equal(envelope.meta.total, 3);
  // 首条商品断言具体值（fixture: goods_id=1001, quantity=50）
  const first = envelope.data[0];
  assert.equal(first.goods_id, 1001);
  assert.equal(first.goods_name, '测试商品 A（库存充足）');
  assert.equal(first.quantity, 50);
  assert.equal(typeof first.sku_price, 'number');
});

test('e2e: goods stock flags low_stock entries below threshold', () => {
  const { status, envelope } = runPdd(['goods', 'stock', '--json', '--threshold', '10']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.stock');
  // 2 条低库存（quantity=3 和 quantity=0）
  assert.equal(envelope.meta.low_stock_count, 2);
  assert.equal(envelope.meta.threshold, 10);
  for (const g of envelope.data) {
    assert.equal(g.is_low_stock, true, '返回的数据必须全部是低库存');
  }
});

test('e2e: goods stock with high threshold includes all goods', () => {
  const { status, envelope } = runPdd(['goods', 'stock', '--json', '--threshold', '100']);
  assert.equal(status, 0);
  assert.equal(envelope.meta.low_stock_count, 3, '阈值 100 时所有商品低库存');
});
