import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createGoodsReceiptFixtures, receiptGoods, receiptScene, receiptSku } from '../fixtures/test-data.js';

it('reports platform estimated receipt per sku in yuan with single and multi scenes', () => {
  const result = runCli(['goods', 'receipt'], { fixtures: createGoodsReceiptFixtures() });
  assert.equal(result.status, 0, result.stderr);
  const view = result.envelope.data;
  assert.equal(view.caliber, '商家出资常规优惠');
  assert.equal(view.total, 2);
  assert.equal(view.page, 1);
  assert.equal(view.size, 10);
  const [first] = view.items;
  assert.equal(first.goods_id, '101');
  assert.equal(first.goods_name, '合成商品');
  assert.equal(first.sku_count, 2);
  assert.deepEqual(first.skus[0], {
    sku_id: '1001', spec: '黑色-90', group_price_yuan: 21.3, pre_coupon_price_yuan: 21.3,
    pre_coupon_price_source: '拼单价',
    single: { merchant_discount_yuan: 1.7, receipt_yuan: 19.6,
      discounts: [{ name: '全店满减活动', desc: '满50减4', discount_yuan: 1.7 }] },
    multi: { quantity: 5, avg_merchant_discount_yuan: 3, receipt_yuan: 18.3, discounts: [
      { name: '全店满减活动', desc: '满100减11', discount_yuan: 11 },
      { name: '多件优惠', desc: '2件9.5折', discount_yuan: 4 }] },
  });
});

it('keeps explicit no-discount at zero, missing scenes null, and warns on missing single or foreign scenes', () => {
  const result = runCli(['goods', 'receipt'], { fixtures: createGoodsReceiptFixtures() });
  assert.equal(result.status, 0, result.stderr);
  const [first, second] = result.envelope.data.items;
  const activitySku = first.skus[1];
  assert.equal(activitySku.group_price_yuan, 21.3);
  assert.equal(activitySku.pre_coupon_price_yuan, 17.9);
  assert.equal(activitySku.pre_coupon_price_source, '限量折扣');
  assert.deepEqual(activitySku.single, { merchant_discount_yuan: 0, receipt_yuan: 17.9, discounts: [] });
  assert.equal(activitySku.multi, null);
  const [onlyMulti] = second.skus;
  assert.equal(onlyMulti.single, null);
  assert.deepEqual(onlyMulti.multi, { quantity: 2, avg_merchant_discount_yuan: 0.5, receipt_yuan: 9.4,
    discounts: [{ name: '多件优惠', desc: '2件减1元', discount_yuan: 1 }] });
  const codes = result.envelope.meta.warnings.map((warning) => [warning.code, warning.goods_id, warning.sku_id]);
  assert.deepEqual(codes.sort(), [['receipt_scene_ignored', '102', '2001'], ['receipt_single_missing', '102', '2001']]);
  assert.deepEqual(result.envelope.meta.warnings.find((warning) => warning.code === 'receipt_scene_ignored').scenes, [10]);
  assert.deepEqual(result.envelope.data.headline, ['商家出资常规优惠口径：共 2 个商品，本页 2 个商品、3 个 SKU']);
  const text = JSON.stringify(result.envelope.data);
  for (const forbidden of ['http', 'SYN-PRIVATE', 'thumb', 'sold_quantity', 'effect_promotion', 'red_line',
    'promotion_sn', 'remain_sku_num', '非公开优惠']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

it('accepts repeated and comma-separated goods ids', () => {
  const result = runCli(['goods', 'receipt', '--goods-id', '101,102', '--goods-id', '103'],
    { fixtures: createGoodsReceiptFixtures() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.envelope.data.headline[1], '按 3 个商品 ID 筛选');
});

it('reads the requested page and size', () => {
  const fixtures = createGoodsReceiptFixtures({ total: 12, pages: { 2: [receiptGoods(111, [
    receiptSku(11101, { scenes: [receiptScene(7, { avg: 0, receipt: 2130 })] })])] } });
  const result = runCli(['goods', 'receipt', '--page', '2', '--size', '5'], { fixtures });
  assert.equal(result.status, 0, result.stderr);
  const view = result.envelope.data;
  assert.deepEqual([view.total, view.page, view.size, view.items.length], [12, 2, 5, 1]);
  assert.equal(view.items[0].goods_id, '111');
});

for (const args of [['--size', '11'], ['--size', '0'], ['--goods-id', '10a'], ['--goods-id', '101,,102']]) {
  it(`rejects ${args.join(' ')} as a usage error`, () => {
    const result = runCli(['goods', 'receipt', ...args], { fixtures: createGoodsReceiptFixtures() });
    assert.equal(result.status, 2);
    assert.equal(result.envelope.error.code, 'E_USAGE');
  });
}

it('maps upstream business errors to exit six with the upstream message', () => {
  const fixtures = { 'endpoints/goodsPrice.list.json': { success: false, error_code: 40001,
    error_msg: '当前店铺暂未开放商品价格管理' } };
  const result = runCli(['goods', 'receipt'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.error.code, 'E_BUSINESS');
  assert.equal(result.envelope.error.message, '当前店铺暂未开放商品价格管理');
});
