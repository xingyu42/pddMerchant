import { matchSales, normalizeGoodsName, readGoodsId, scanQuality } from './goods-sales-matcher.js';
import { collectAllGoods } from './diagnose/goods-collector.js';
import { collectOrdersForStaleAnalysis } from './diagnose/orders-collector.js';
import { analyzePromoRoi } from './promo-roi.js';
import { getPromoReport } from './promo.js';
import { getLogger } from '../infra/logger.js';
import { toGoodsSegmentView } from './views/goods-segmentation.js';
import { withEndpointPages } from '../adapter/endpoint-pages.js';

const EPSILON = 0.001;

export { GOODS_SEGMENT_ITEM_FIELDS } from './views/goods-segmentation.js';

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

function promoRoiByGoods(promoRoi) {
  const promoRoiMap = new Map();
  if (promoRoi && Array.isArray(promoRoi.rows)) {
    for (const row of promoRoi.rows) {
      const gid = readGoodsId(row);
      const gname = normalizeGoodsName(row.goods_name);
      if (gid) promoRoiMap.set(`id:${gid}`, row.roi);
      if (gname) promoRoiMap.set(`name:${gname}`, row.roi);
    }
  }
  return promoRoiMap;
}

function segmentItem(goods, unitsSold, promoMap, windowDays, ordersComplete) {
  const dailyAvg = unitsSold / Math.max(windowDays, 1);
  const stockDays = goods.quantity === null ? null
    : dailyAvg > EPSILON ? goods.quantity / dailyAvg : (goods.quantity > 0 ? null : 0);
  const promoRoi = promoMap.get(`id:${goods.goods_id}`) ?? promoMap.get(`name:${goods.goods_name}`) ?? null;
  return { goods_id: goods.goods_id, goods_name: goods.raw_name || goods.goods_name,
    units_sold: ordersComplete ? unitsSold : null, observed_units_sold: unitsSold, quantity: goods.quantity,
    stock_days: !ordersComplete || stockDays === null ? null : Math.round(stockDays), promo_roi: promoRoi };
}

function segmentCompleteness(quality, goods, orders, promoRoi) {
  const incomplete = !quality.goods_complete || !quality.orders_complete;
  if (goods.length === 0) return incomplete ? 'partial' : 'empty';
  if (!quality.goods_complete && !quality.orders_complete) return 'partial_goods_orders';
  if (!quality.goods_complete) return 'partial_goods';
  if (!quality.orders_complete) return 'partial_orders';
  if (orders.length === 0) return 'no_orders';
  return promoRoi ? 'full' : 'no_promo';
}

export function segmentGoods(input, { windowDays = 30 } = {}) {
  const { goods = [], orders30d = [], promoRoi = null } = input;
  // 分群把缺失的商品列表视为空列表。
  const dataQuality = scanQuality({ ...input, goods: input.goods ?? [] });
  const warnings = [];
  if (!dataQuality.goods_complete || !dataQuality.orders_complete) warnings.push('采集不完整，统计仅反映已采集数据');
  const matched = matchSales(goods, orders30d);
  warnings.push(...matched.warnings);
  const promoMap = promoRoiByGoods(promoRoi);
  const items = [...matched.byGoods.values()].flatMap(({ goods: bucket, unitsSold }) =>
    bucket.map((item) => segmentItem(item, unitsSold, promoMap, windowDays, dataQuality.orders_complete)));
  const summary = {
    matched_by: goods.length === 0 ? null : matched.matchedBy,
    ambiguous_groups: matched.ambiguous.length,
    data_completeness: segmentCompleteness(dataQuality, goods, orders30d, promoRoi),
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
  return withEndpointPages(page, 2, async ([ordersPage, promoPage]) => {
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
      data: toGoodsSegmentView(data, ctx),
      warnings: [...warnings, ...promo.warnings],
    };
  });
}
