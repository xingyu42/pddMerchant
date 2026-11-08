// 预估实收视图：白名单投影、分转元、来源标签与 headline；数值均为平台报告值，不重算。
import { yuanFromFen } from '../../infra/units.js';

export const GOODS_RECEIPT_ITEM_FIELDS = Object.freeze(['goods_id', 'goods_name', 'sku_count', 'skus']);
export const GOODS_RECEIPT_SKU_FIELDS = Object.freeze(['sku_id', 'spec', 'group_price_yuan', 'pre_coupon_price_yuan',
  'pre_coupon_price_source', 'single', 'multi']);
export const GOODS_RECEIPT_SINGLE_FIELDS = Object.freeze(['merchant_discount_yuan', 'receipt_yuan', 'discounts']);
export const GOODS_RECEIPT_MULTI_FIELDS = Object.freeze(['quantity', 'avg_merchant_discount_yuan', 'receipt_yuan',
  'discounts']);
export const GOODS_RECEIPT_DISCOUNT_FIELDS = Object.freeze(['name', 'desc', 'discount_yuan']);

const GROUP_PRICE_SOURCE = '拼单价';

function toDiscounts(scene) {
  return scene.merge_promo_detail_list.map((item) => ({ name: item.source_type_str, desc: item.promo_desc,
    discount_yuan: yuanFromFen(item.discount_amount) }));
}

// 单件与多件场景同构：多件额外带件数，商家出资优惠为平均每件。
function toScene(scene, { multi = false } = {}) {
  if (!scene) return null;
  const discount = yuanFromFen(scene.avg_discount_amount);
  const head = multi ? { quantity: scene.number, avg_merchant_discount_yuan: discount }
    : { merchant_discount_yuan: discount };
  return { ...head, receipt_yuan: yuanFromFen(scene.promo_price), discounts: toDiscounts(scene) };
}

// sku 已由 service 按口径选出 single / multi 场景（缺失为 null）。
function toGoodsReceiptSku(sku) {
  const activity = sku.activity_price_info;
  return {
    sku_id: sku.sku_id, spec: sku.sku_spec, group_price_yuan: yuanFromFen(sku.group_price),
    pre_coupon_price_yuan: yuanFromFen(activity ? activity.activity_price : sku.group_price),
    pre_coupon_price_source: activity ? activity.activity_type_desc : GROUP_PRICE_SOURCE,
    single: toScene(sku.single), multi: toScene(sku.multi, { multi: true }),
  };
}

function toItem(goods) {
  return { goods_id: goods.goods_id, goods_name: goods.goods_name, sku_count: goods.skus.length,
    skus: goods.skus.map(toGoodsReceiptSku) };
}

function headline({ caliberLabel, total, items, goodsIds }) {
  const skuCount = items.reduce((sum, item) => sum + item.sku_count, 0);
  const lines = [`${caliberLabel}口径：共 ${total} 个商品，本页 ${items.length} 个商品、${skuCount} 个 SKU`];
  if (goodsIds.length > 0) lines.push(`按 ${goodsIds.length} 个商品 ID 筛选`);
  return lines;
}

export function toGoodsReceiptView(goods, { total, page, size, caliberLabel, goodsIds = [] }) {
  const items = goods.map(toItem);
  return { headline: headline({ caliberLabel, total, items, goodsIds }), items, total, page, size,
    caliber: caliberLabel };
}
