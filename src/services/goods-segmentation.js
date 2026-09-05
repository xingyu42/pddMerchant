import { normalizeGoodsName, extractItems, buildGoodsKey } from './diagnose/inventory-health.js';

const EPSILON = 0.001;

function readGoodsId(raw) {
  const id = raw?.goods_id ?? raw?.goodsId;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) return String(id);
  if (typeof id === 'string') {
    const trimmed = id.trim();
    if (trimmed.length > 0 && trimmed !== '0') return trimmed;
  }
  return null;
}

function detectStrategy(orderItems, goodsItems) {
  if (goodsItems.length === 0) return 'goods_name';
  const goodsAllHaveId = goodsItems.every((g) => g.goods_id != null);
  if (!goodsAllHaveId) return 'goods_name';
  if (orderItems.length === 0) return 'goods_id';
  return orderItems.every((it) => it.goods_id != null) ? 'goods_id' : 'goods_name';
}

function detectMatchedBy(strategy, orderItems, goodsItems) {
  if (strategy === 'goods_id') return 'goods_id';
  const ordersHaveAnyId = orderItems.some((it) => it.goods_id != null);
  const goodsHaveAnyId = goodsItems.some((g) => g.goods_id != null);
  if (ordersHaveAnyId !== goodsHaveAnyId) return 'mixed';
  return 'goods_name';
}

export function segmentGoods(input, options = {}) {
  const { goods = [], orders30d = [], promoRoi = null, truncated = false, ratelimited = false } = input;
  const { goodsScanTruncated = false, goodsScanRateLimited = false, goodsTotal } = input;
  const { windowDays = 30 } = options;
  const goodsIncomplete = goodsScanTruncated || goodsScanRateLimited
    || (Number.isFinite(goodsTotal) && goodsTotal > goods.length);
  const ordersIncomplete = truncated || ratelimited || !Array.isArray(input.orders30d);
  const incomplete = goodsIncomplete || ordersIncomplete;
  const dataQuality = {
    goods_complete: !goodsIncomplete, orders_complete: !ordersIncomplete,
    goods_truncated: goodsScanTruncated, goods_ratelimited: goodsScanRateLimited,
    orders_truncated: truncated, orders_ratelimited: ratelimited,
  };

  const warnings = [];
  if (incomplete) warnings.push('采集不完整，统计仅反映已采集数据');
  if (goods.length === 0) {
    return {
      level: 'goods',
      window_days: windowDays,
      items: [],
      summary: { total_goods: 0, matched_by: null, ambiguous_groups: 0, data_completeness: incomplete ? 'partial' : 'empty', data_quality: dataQuality },
      warnings,
    };
  }

  const goodsItems = goods.map((g) => ({
    goods_id: readGoodsId(g),
    goods_name: normalizeGoodsName(g?.goods_name ?? g?.goodsName),
    raw_name: String(g?.goods_name ?? g?.goodsName ?? ''),
    quantity: Number(g?.quantity ?? 0),
    sku_group_price: g?.sku_group_price ?? g?.skuGroupPrice ?? null,
  }));

  const orderItems = (Array.isArray(orders30d) ? orders30d : []).flatMap(extractItems);
  const strategy = detectStrategy(orderItems, goodsItems);
  const matchedBy = detectMatchedBy(strategy, orderItems, goodsItems);

  const soldMap = new Map();
  for (const item of orderItems) {
    const key = buildGoodsKey(item, strategy);
    soldMap.set(key, (soldMap.get(key) ?? 0) + item.quantity);
  }

  const promoRoiMap = new Map();
  if (promoRoi && Array.isArray(promoRoi.rows)) {
    for (const row of promoRoi.rows) {
      const gid = row.goods_id != null ? String(row.goods_id) : null;
      const gname = normalizeGoodsName(row.goods_name);
      if (gid) promoRoiMap.set(`id:${gid}`, row.roi);
      if (gname) promoRoiMap.set(`name:${gname}`, row.roi);
    }
  }

  const nameBuckets = new Map();
  for (const g of goodsItems) {
    const key = buildGoodsKey(g, strategy);
    const arr = nameBuckets.get(key) ?? [];
    arr.push(g);
    nameBuckets.set(key, arr);
  }

  const eligibleGoods = [];
  let ambiguousCount = 0;
  for (const [key, bucket] of nameBuckets) {
    if (bucket.length > 1 && key.startsWith('name:')) {
      ambiguousCount += 1;
      warnings.push(`重名商品 "${key.slice(5)}" (${bucket.length} 个) 无法唯一匹配，已排除统计`);
      continue;
    }
    for (const g of bucket) {
      const gKey = buildGoodsKey(g, strategy);
      const unitsSold = soldMap.get(gKey) ?? 0;
      const dailyAvg = unitsSold / Math.max(windowDays, 1);
      const sDays = dailyAvg > EPSILON ? g.quantity / dailyAvg : (g.quantity > 0 ? Infinity : 0);

      let pRoi = null;
      if (g.goods_id) pRoi = promoRoiMap.get(`id:${g.goods_id}`) ?? null;
      if (pRoi == null && g.goods_name) pRoi = promoRoiMap.get(`name:${g.goods_name}`) ?? null;

      eligibleGoods.push({ ...g, units_sold_30d: unitsSold, daily_avg: dailyAvg, stock_days: sDays, promo_roi: pRoi });
    }
  }

  const items = [];

  for (const g of eligibleGoods) {
    items.push({
      goods_id: g.goods_id,
      goods_name: g.raw_name || g.goods_name,
      units_sold_30d: ordersIncomplete ? null : g.units_sold_30d,
      observed_units_sold: g.units_sold_30d,
      quantity: g.quantity,
      stock_days: ordersIncomplete || g.stock_days === Infinity ? null : Math.round(g.stock_days),
      promo_roi: g.promo_roi,
    });
  }

  let completeness = 'full';
  if (goodsIncomplete && ordersIncomplete) completeness = 'partial_goods_orders';
  else if (goodsIncomplete) completeness = 'partial_goods';
  else if (ordersIncomplete) completeness = 'partial_orders';
  else if (orders30d.length === 0) completeness = 'no_orders';
  if (!promoRoi) completeness = completeness === 'full' ? 'no_promo' : completeness;

  return {
    level: 'goods',
    window_days: windowDays,
    items,
    summary: {
      total_goods: items.length,
      matched_by: matchedBy,
      ambiguous_groups: ambiguousCount,
      data_completeness: completeness,
      data_quality: dataQuality,
    },
    warnings,
  };
}
