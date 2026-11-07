import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { allCaliberReceiptGoods, createGoodsReceiptFixtures, receiptDiscount, receiptGoods, receiptScene,
  receiptSku }
  from '../fixtures/test-data.js';

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
  assert.equal(first.sku_count, 5);
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
  assert.deepEqual(result.envelope.data.headline, ['商家出资常规优惠口径：共 2 个商品，本页 2 个商品、6 个 SKU']);
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

it('requests and adopts the all-discounts scenes 10 and 11 under --caliber all, ignoring regular scenes', () => {
  // 所有优惠口径样本只在请求场景值为 [10,11] 时被读取；请求错口径会落到常规口径的基础 fixture。
  const fixtures = createGoodsReceiptFixtures({ allCaliberGoods: allCaliberReceiptGoods() });
  const result = runCli(['goods', 'receipt', '--caliber', 'all'], { fixtures });
  assert.equal(result.status, 0, result.stderr);
  const view = result.envelope.data;
  assert.equal(view.caliber, '商家出资所有优惠');
  assert.deepEqual(view.headline, ['商家出资所有优惠口径：共 1 个商品，本页 1 个商品、1 个 SKU']);
  const [sku] = view.items[0].skus;
  assert.deepEqual(sku.single, { merchant_discount_yuan: 2.7, receipt_yuan: 18.6,
    discounts: [{ name: '非公开优惠', desc: '合成文案', discount_yuan: 2.7 }] });
  assert.deepEqual(sku.multi, { quantity: 3, avg_merchant_discount_yuan: 4.2, receipt_yuan: 17.1,
    discounts: [{ name: '多单立减', desc: '合成立减', discount_yuan: 12.6 }] });
  const warnings = result.envelope.meta.warnings;
  assert.deepEqual(warnings.map((warning) => [warning.code, warning.goods_id, warning.sku_id, warning.scenes]),
    [['receipt_scene_ignored', '101', '1001', [7]]]);
  assert.match(warnings[0].message, /商家出资所有优惠/);
});

it('accepts the regular caliber explicitly', () => {
  const result = runCli(['goods', 'receipt', '--caliber', 'regular'], { fixtures: createGoodsReceiptFixtures() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.envelope.data.caliber, '商家出资常规优惠');
});

for (const args of [['--size', '11'], ['--size', '0'], ['--goods-id', '10a'], ['--goods-id', '101,,102'],
  ['--caliber', 'ALL'], ['--caliber', 'platform']]) {
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

it('expands every goods with remaining skus into its full sku list without duplicates', () => {
  const listed = (skuId) => receiptSku(skuId, { scenes: [receiptScene(7, { avg: 0, receipt: 1000 })] });
  const extra = (skuId, receipt, discounts = []) => receiptSku(skuId, { spec: `扩展-${skuId}`, scenes: [
    receiptScene(7, { avg: 2130 - receipt, receipt, discounts }), receiptScene(9, { avg: 0, receipt: 2130 })] });
  const fixtures = createGoodsReceiptFixtures({ total: 3, goods: [
    receiptGoods(201, [listed(20101), listed(20102)], { remain: 1 }),
    receiptGoods(202, [listed(20201)]),
    receiptGoods(203, [listed(20301), listed(20302)], { remain: 2 }),
  ], expansions: {
    201: [extra(20103, 1930, [receiptDiscount('全店满减活动', '满50减4', 200)])],
    203: [listed(20302), extra(20303, 2000), extra(20304, 1800)],
  } });
  const result = runCli(['goods', 'receipt'], { fixtures });
  assert.equal(result.status, 0, result.stderr);
  const items = result.envelope.data.items;
  assert.deepEqual(items.map((item) => [item.goods_id, item.sku_count, item.skus.map((sku) => sku.sku_id)]), [
    ['201', 3, ['20101', '20102', '20103']],
    ['202', 1, ['20201']],
    ['203', 4, ['20301', '20302', '20303', '20304']],
  ]);
  assert.deepEqual(items[0].skus[2], { sku_id: '20103', spec: '扩展-20103', group_price_yuan: 21.3,
    pre_coupon_price_yuan: 21.3, pre_coupon_price_source: '拼单价',
    single: { merchant_discount_yuan: 2, receipt_yuan: 19.3,
      discounts: [{ name: '全店满减活动', desc: '满50减4', discount_yuan: 2 }] }, multi: null });
  assert.equal(items[2].skus[3].single.receipt_yuan, 18);
  const ignored = result.envelope.meta.warnings.filter((warning) => warning.code === 'receipt_scene_ignored');
  assert.deepEqual(ignored.map((warning) => warning.sku_id), ['20103', '20303', '20304']);
  assert.deepEqual(result.envelope.data.headline, ['商家出资常规优惠口径：共 3 个商品，本页 3 个商品、8 个 SKU']);
});

it('adopts the all-discounts scenes for expanded skus under --caliber all', () => {
  const [listed] = allCaliberReceiptGoods();
  const expanded = receiptSku(1002, { spec: '扩展-1002', scenes: [receiptScene(8, { avg: 0, receipt: 2130 }),
    receiptScene(10, { avg: 330, receipt: 1800, discounts: [receiptDiscount('商家出资平台券', '合成券', 330)] })] });
  const fixtures = createGoodsReceiptFixtures({ allCaliberGoods: [{ ...listed, remain_sku_num: 1 }],
    expansions: { 101: [expanded] } });
  const result = runCli(['goods', 'receipt', '--caliber', 'all'], { fixtures });
  assert.equal(result.status, 0, result.stderr);
  const [, extra] = result.envelope.data.items[0].skus;
  assert.equal(extra.sku_id, '1002');
  assert.deepEqual(extra.single, { merchant_discount_yuan: 3.3, receipt_yuan: 18,
    discounts: [{ name: '商家出资平台券', desc: '合成券', discount_yuan: 3.3 }] });
  assert.equal(extra.multi, null);
  const ignored = result.envelope.meta.warnings.filter((warning) => warning.code === 'receipt_scene_ignored');
  assert.deepEqual(ignored.map((warning) => [warning.sku_id, warning.scenes]), [['1001', [7]], ['1002', [8]]]);
});

it('fails with exit six and no partial sku list when expansion returns a business error', () => {
  const fixtures = createGoodsReceiptFixtures({ expansions: { 101: { success: false, error_code: 40002,
    error_msg: '补全规格失败' } } });
  const result = runCli(['goods', 'receipt'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.error.code, 'E_BUSINESS');
  assert.equal(result.envelope.error.message, '补全规格失败');
  assert.equal(result.envelope.data, null);
});
