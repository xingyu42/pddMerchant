import { normalizeGoodsName, extractItems, buildGoodsKey } from './diagnose/inventory-health.js';
import { collectAllGoods } from './diagnose/goods-collector.js';
import { collectOrdersForStaleAnalysis } from './diagnose/orders-collector.js';
import { analyzePromoRoi } from './promo-roi.js';
import { getPromoReport } from './promo.js';
import { getLogger } from '../infra/logger.js';
import { mallIdOf } from './views/_shared.js';
import { DATA_COMPLETENESS_LABEL, MATCHED_BY_LABEL } from './views/labels.js';
import { labelOf } from '../infra/units.js';

const EPSILON = 0.001;

export const GOODS_SEGMENT_ITEM_FIELDS = Object.freeze([
  'goods_id', 'goods_name', 'units_sold', 'observed_units_sold', 'quantity', 'stock_days', 'promo_roi',
]);

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

// 事实性 headline：数量与数据完整性，不做好坏判断
function segmentHeadline(windowDays, items, summary) {
  const { data_quality: quality } = summary;
  if (items.length === 0) return [`近 ${windowDays} 天无可统计商品`];
  const known = items.filter((item) => item.units_sold !== null);
  const headline = [`近 ${windowDays} 天统计商品 ${items.length} 件`];
  if (known.length === items.length) {
    const zero = known.filter((item) => item.units_sold === 0).length;
    headline.push(`有销量 ${items.length - zero} 件，零销量 ${zero} 件`);
  }
  if (!quality.orders_complete) headline.push('订单采集不完整，全周期销量与可售天数未计算');
  if (!quality.goods_complete) headline.push('商品采集不完整，仅统计已采集商品');
  return headline;
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
    const summary = { matched_by: null, ambiguous_groups: 0, data_completeness: incomplete ? 'partial' : 'empty', data_quality: dataQuality };
    return {
      headline: segmentHeadline(windowDays, [], summary),
      window_days: windowDays,
      items: [],
      total: 0,
      summary,
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

      eligibleGoods.push({ ...g, units_sold: unitsSold, daily_avg: dailyAvg, stock_days: sDays, promo_roi: pRoi });
    }
  }

  const items = [];

  for (const g of eligibleGoods) {
    items.push({
      goods_id: g.goods_id,
      goods_name: g.raw_name || g.goods_name,
      units_sold: ordersIncomplete ? null : g.units_sold,
      observed_units_sold: g.units_sold,
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

  const summary = {
    matched_by: matchedBy,
    ambiguous_groups: ambiguousCount,
    data_completeness: completeness,
    data_quality: dataQuality,
  };
  return {
    headline: segmentHeadline(windowDays, items, summary),
    window_days: windowDays,
    items,
    total: items.length,
    summary,
    warnings,
  };
}

// 输出层把内部代码（spec 定义的 matched_by / data_completeness 值）翻译为中文标签
function toSegmentSummaryView(summary) {
  return {
    ...summary,
    matched_by: labelOf(MATCHED_BY_LABEL, summary.matched_by),
    data_completeness: labelOf(DATA_COMPLETENESS_LABEL, summary.data_completeness),
  };
}

// 推广 ROI 为可选补充：失败时不影响商品统计；金额单位警告随结果返回
async function collectPromoRoi(page, ctx) {
  try {
    const report = await getPromoReport(page, {}, ctx);
    const warnings = report?.unitWarnings ?? [];
    if (!(report?.entities?.length > 0)) return { promoRoi: null, warnings };
    const promoRoi = analyzePromoRoi({ entities: report.entities, totals: report.totals ?? {} }, { by: 'sku' });
    return { promoRoi, warnings };
  } catch (err) {
    (ctx.log ?? getLogger()).debug({ err: err?.message }, 'goods.segment: promo enrichment failed');
    return { promoRoi: null, warnings: [] };
  }
}

// goods.segment 命令级结果：{ data: v2 视图, warnings }
export async function getGoodsSegmentView(ctx, { days = 30, size = 50, maxPages = 10, usePromo = true } = {}) {
  const page = ctx.page;
  const hasContext = typeof page?.context === 'function';
  const ordersPage = hasContext ? await page.context().newPage() : page;
  const promoPage = hasContext ? await page.context().newPage() : page;
  try {
    const [goodsResult, ordersResult] = await Promise.all([
      collectAllGoods(page, ctx, { pageSize: size, maxPages }),
      collectOrdersForStaleAnalysis(ordersPage, ctx, { scanDays: days }),
    ]);
    const promo = usePromo ? await collectPromoRoi(promoPage, ctx) : { promoRoi: null, warnings: [] };
    const { promoRoi } = promo;
    const { warnings, ...data } = segmentGoods({
      goods: goodsResult.goods,
      goodsTotal: goodsResult.total,
      goodsScanTruncated: goodsResult.truncated,
      goodsScanRateLimited: goodsResult.ratelimited,
      orders30d: ordersResult.orders,
      promoRoi,
      truncated: ordersResult.truncated,
      ratelimited: ordersResult.ratelimited,
    }, { windowDays: days });
    return {
      data: { ...data, summary: toSegmentSummaryView(data.summary), mall_id: mallIdOf(ctx) },
      warnings: [...warnings, ...promo.warnings],
    };
  } finally {
    if (hasContext) {
      await ordersPage.close().catch(() => {});
      await promoPage.close().catch(() => {});
    }
  }
}
