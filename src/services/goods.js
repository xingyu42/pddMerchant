import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_LIST } from '../adapter/endpoints/goods.js';

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;

export function isLowStock(goods, threshold = DEFAULT_LOW_STOCK_THRESHOLD) {
  const qty = Number(goods?.quantity);
  if (!Number.isFinite(qty)) return false;
  return qty <= threshold;
}

function toGoodsRecord(g) {
  return {
    goods_id: g.goods_id ?? g.goodsId ?? null,
    goods_name: g.goods_name ?? g.goodsName ?? '',
    quantity: Number.isFinite(Number(g.quantity)) ? Number(g.quantity) : 0,
    sku_price: g.sku_price ?? g.skuPrice ?? null,
    sku_group_price: g.sku_group_price ?? g.skuGroupPrice ?? null,
    origin_sku_group_price: g.origin_sku_group_price ?? null,
    promotion: g.promotion ?? g.promotion_goods ?? null,
    mall_id: g.mall_id ?? g.mallId ?? null,
  };
}

export async function listGoods(page, params = {}, ctx = {}) {
  const result = await runEndpoint(page, GOODS_LIST, params, ctx);
  const goods = Array.isArray(result?.goods) ? result.goods.map(toGoodsRecord) : [];
  return {
    total: Number(result?.total) || 0,
    goods,
    sessionId: result?.sessionId ?? null,
    raw: result?.raw ?? null,
  };
}

export async function getGoodsStock(page, params = {}, ctx = {}) {
  const threshold = Number.isFinite(Number(params.threshold))
    ? Number(params.threshold)
    : DEFAULT_LOW_STOCK_THRESHOLD;

  const base = await listGoods(page, {
    ...params,
    size: params.size ?? 50,
  }, ctx);

  const annotated = base.goods.map((g) => ({
    ...g,
    is_low_stock: isLowStock(g, threshold),
  }));
  const low = annotated.filter((g) => g.is_low_stock);

  return {
    total: base.total,
    threshold,
    low_stock_count: low.length,
    low_stock: low,
    goods: annotated,
    sessionId: base.sessionId,
    raw: base.raw,
  };
}
