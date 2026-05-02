import { normalizeGoodsName, extractItems, buildGoodsKey } from './diagnose/inventory-health.js';

const EPSILON = 0.001;

const TIER_CONFIG = Object.freeze({
  A: { min: 75, label: '主推款', action: 'main_push', hint: '集中预算、评价、活动资源' },
  B: { min: 50, label: '潜力款', action: 'test_optimize', hint: '测图、测价、测人群' },
  C: { min: 25, label: '引流款', action: 'traffic_observe', hint: '控制利润底线，承担拉新角色' },
  D: { min: 0, label: '清仓/下架款', action: 'clearance', hint: '降价、合并、下架、清库存' },
});

function percentileRank(values, value) {
  if (values.length === 0) return 0;
  let below = 0;
  for (const v of values) if (v < value) below += 1;
  return Math.round((below / values.length) * 100);
}

function stockScore(stockDays) {
  if (stockDays <= 45) return 100;
  if (stockDays <= 90) return 50;
  return 0;
}

function promoScore(promoRoi, breakEvenRoi) {
  if (promoRoi == null) return 0;
  if (promoRoi >= breakEvenRoi) return 100;
  if (promoRoi > 0) return 50;
  return 0;
}

function assignTier(composite) {
  if (composite >= 75) return 'A';
  if (composite >= 50) return 'B';
  if (composite >= 25) return 'C';
  return 'D';
}

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
  const { goods = [], orders30d = [], promoRoi = null, truncated = false, ratelimited = false } = input ?? {};
  const { windowDays = 30, breakEvenRoi = 1.0 } = options;

  const warnings = [];
  if (goods.length === 0) {
    return {
      level: 'goods',
      window_days: windowDays,
      tiers: { A: { count: 0, label: '主推款' }, B: { count: 0, label: '潜力款' }, C: { count: 0, label: '引流款' }, D: { count: 0, label: '清仓/下架款' } },
      items: [],
      summary: { total_goods: 0, matched_by: null, ambiguous_groups: 0, data_completeness: 'empty' },
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

  const orderItems = orders30d.flatMap(extractItems);
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
      warnings.push(`重名商品 "${key.slice(5)}" (${bucket.length} 个) 已排除分层`);
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

  const allSales = eligibleGoods.map((g) => g.units_sold_30d);
  const items = [];

  for (const g of eligibleGoods) {
    const salesRank = percentileRank(allSales, g.units_sold_30d);
    const sScore = stockScore(g.stock_days === Infinity ? 999 : g.stock_days);
    const pScore = promoScore(g.promo_roi, breakEvenRoi);
    const composite = Math.round(salesRank * 0.50 + sScore * 0.30 + pScore * 0.20);
    const clamped = Math.max(0, Math.min(100, composite));

    let tier = assignTier(clamped);
    let action = TIER_CONFIG[tier].action;
    let actionHint = TIER_CONFIG[tier].hint;

    if (g.quantity === 0 && g.units_sold_30d > 0) {
      if (tier === 'C' || tier === 'D') tier = 'B';
      action = 'restock';
      actionHint = '断货中但有销量，优先补货';
    } else if (g.units_sold_30d === 0 && g.quantity > 0) {
      tier = 'D';
      action = 'clearance';
      actionHint = '零销量有库存，降价或下架';
    }

    items.push({
      goods_id: g.goods_id,
      goods_name: g.raw_name || g.goods_name,
      tier,
      composite_score: clamped,
      sales_rank: salesRank,
      units_sold_30d: g.units_sold_30d,
      quantity: g.quantity,
      stock_days: g.stock_days === Infinity ? null : Math.round(g.stock_days),
      stock_score: sScore,
      promo_roi: g.promo_roi,
      promo_score: pScore,
      action,
      action_hint: actionHint,
    });
  }

  items.sort((a, b) => b.composite_score - a.composite_score);

  const tiers = { A: { count: 0, label: '主推款' }, B: { count: 0, label: '潜力款' }, C: { count: 0, label: '引流款' }, D: { count: 0, label: '清仓/下架款' } };
  for (const item of items) tiers[item.tier].count += 1;

  let completeness = 'full';
  if (truncated || ratelimited) completeness = 'partial_orders';
  else if (orders30d.length === 0) completeness = 'no_orders';
  if (!promoRoi) completeness = completeness === 'full' ? 'no_promo' : completeness;

  return {
    level: 'goods',
    window_days: windowDays,
    tiers,
    items,
    summary: {
      total_goods: items.length,
      matched_by: matchedBy,
      ambiguous_groups: ambiguousCount,
      data_completeness: completeness,
    },
    warnings,
  };
}
