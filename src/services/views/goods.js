// 商品领域视图（输出契约 v2 防腐层）：白名单投影商品记录与运费模板，上游其余字段一律丢弃。
// 字段依据 research/upstream-schema-2026-10.md §3–§4：sku_price / sku_group_price 为分的数组（多 SKU）。
import { toFiniteNumber, yuanFromFen } from '../../infra/units.js';
import { text } from './_shared.js';

export const GOODS_VIEW_FIELDS = Object.freeze([
  'goods_id', 'goods_name', 'quantity',
  'price_min_yuan', 'price_max_yuan', 'single_price_min_yuan', 'single_price_max_yuan',
  'promotion',
]);

// goods stock 专用：商品视图字段之后追加低库存规格数与规格明细；goods list 的商品视图字段不变
export const GOODS_STOCK_ITEM_FIELDS = Object.freeze([...GOODS_VIEW_FIELDS, 'low_stock_sku_count', 'skus']);

export const GOODS_STOCK_SKU_FIELDS = Object.freeze(['sku_id', 'spec', 'quantity', 'on_sale', 'low_stock']);

export const GOODS_PROMOTION_VIEW_FIELDS = Object.freeze(['name', 'price_min_yuan', 'price_max_yuan']);

export const COST_TEMPLATE_VIEW_FIELDS = Object.freeze(['template_id', 'name']);

// 分（单值或数组）→ { min, max } 元；无有效值时两端均为 null
function priceRange(fenValues) {
  const list = (Array.isArray(fenValues) ? fenValues : [fenValues])
    .map(toFiniteNumber)
    .filter((value) => value !== null);
  if (list.length === 0) return { min: null, max: null };
  return { min: yuanFromFen(Math.min(...list)), max: yuanFromFen(Math.max(...list)) };
}

// 上游 promotion_goods 8 字段仅保留名称与价格区间（activity_type 等无标签证据，丢弃）
function toPromotionView(promotion) {
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) return null;
  return {
    name: text(promotion.activity_name),
    price_min_yuan: yuanFromFen(promotion.min_price),
    price_max_yuan: yuanFromFen(promotion.max_price),
  };
}

// 输入为 services/goods.js 的商品记录（goods_id 已按 goods_id ?? goodsId ?? id 归一）
export function toGoodsView(record) {
  const groupPrice = priceRange(record?.sku_group_price);
  const singlePrice = priceRange(record?.sku_price);
  return {
    goods_id: text(record?.goods_id),
    goods_name: text(record?.goods_name),
    quantity: toFiniteNumber(record?.quantity),
    price_min_yuan: groupPrice.min,
    price_max_yuan: groupPrice.max,
    single_price_min_yuan: singlePrice.min,
    single_price_max_yuan: singlePrice.max,
    promotion: toPromotionView(record?.promotion),
  };
}

function toStockSkuView(sku) {
  return {
    sku_id: text(sku?.sku_id),
    spec: text(sku?.spec),
    quantity: toFiniteNumber(sku?.quantity),
    on_sale: typeof sku?.on_sale === 'boolean' ? sku.on_sale : null,
    low_stock: sku?.low_stock === true,
  };
}

// 规格数据不可用（记录 skus 非数组）→ skus 与 low_stock_sku_count 均为 null
export function toGoodsStockView(record) {
  const skus = Array.isArray(record?.skus) ? record.skus.map(toStockSkuView) : null;
  const lowStockSkuCount = skus === null ? null : skus.filter((sku) => sku.low_stock).length;
  return { ...toGoodsView(record), low_stock_sku_count: lowStockSkuCount, skus };
}

// free_province_need 无值域证据，不输出
export function toCostTemplateView(template) {
  return {
    template_id: text(template?.id),
    name: text(template?.name),
  };
}
