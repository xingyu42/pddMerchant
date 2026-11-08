import { metricTable } from '../../infra/metrics.js';
import { defineReport, reportHints } from '../operating-report.js';

export const GOODS_TRAFFIC_REPORT = defineReport({
  days: { choices: { 1: 0, 7: 1, 30: 2 }, default: 30, message: '--days 仅接受 {range}',
    description: '平台原生区间（{range} 天）' },
  hints: {
    promo_caliber: '推广拆分口径来自对第三方插件实现的分析，尚未经有投放店铺实测',
    non_promo_caliber: '非推广成交 = 商品明细总量减去推广直接成交，平台不提供该拆分',
    goods_truncated: '商品明细采集不完整（分页上限或提前空页），结果已截断',
    promo_unavailable: '推广数据拉取失败或已达采集上限，推广及非推广成交字段为 null',
    negative_difference: '总成交减去推广直接成交出现负差额，对应非推广成交字段为 null',
    promo_unknown_unit: '推广金额单位未知，对应推广金额及非推广成交额为 null',
  },
});

const GOODS_TRAFFIC_METRICS = metricTable([
  ['visitor_count', 'goodsUv', 'count'], ['page_view_count', 'goodsPv', 'count'], ['fav_user_count', 'goodsFavCnt', 'count'],
  ['order_create_user_count', 'ordrCrtUsrCnt', 'count'], ['order_rate_pct', 'ordrVstrRto', 'ratio'],
  ['pay_conversion_pct', 'goodsVcr', 'ratio'], ['pay_rate_pct', 'payOrdrRto', 'ratio'],
  ['pay_order_count', 'payOrdrCnt', 'count'], ['pay_goods_qty', 'payOrdrGoodsQty', 'count'], ['pay_buyer_count', 'payOrdrUsrCnt', 'count'],
  ['pay_amount_yuan', 'payOrdrAmt', 'yuan'], ['consult_user_count', 'cnsltUsrQty', 'count'],
]);
const GOODS_TRAFFIC_PROMO_METRICS = metricTable([
  ['promo_direct_order_count', 'directOrderNum', 'count'], ['promo_indirect_order_count', 'indirectOrderNum', 'count'],
  ['promo_direct_amount_yuan', 'directAmountFen', 'fen'], ['promo_indirect_amount_yuan', 'indirectAmountFen', 'fen'],
  ['promo_spend_yuan', 'spendFen', 'fen'], ['promo_click_count', 'click', 'count'],
  ['non_promo_order_count', 'nonPromoOrders', 'count'], ['non_promo_amount_yuan', 'nonPromoAmountFen', 'fen'],
]);
export const GOODS_TRAFFIC_PROMO_FIELDS = GOODS_TRAFFIC_PROMO_METRICS.fields;
export const GOODS_TRAFFIC_ITEM_FIELDS = Object.freeze(['goods_id', 'goods_name', ...GOODS_TRAFFIC_METRICS.fields,
  'category', ...GOODS_TRAFFIC_PROMO_FIELDS]);

export function toGoodsTrafficItem(row, promo = {}) {
  return { goods_id: row.goodsId == null ? null : String(row.goodsId), goods_name: row.goodsName ?? null,
    ...GOODS_TRAFFIC_METRICS.project(row),
    category: row.cate3Name ?? null,
    ...GOODS_TRAFFIC_PROMO_METRICS.project(promo) };
}

export function toGoodsTrafficView(rows, { window, goodsId, total, quality, promotions, hints, mallId }) {
  return { headline: [`近 ${window.days} 天商品流量，共 ${total} 个商品，返回 ${rows.length} 条明细`], window,
    filter_goods_id: goodsId ?? null, items: rows.map((row) => toGoodsTrafficItem(row, promotions.get(String(row.goodsId)))),
    total, data_quality: quality, hints: reportHints(GOODS_TRAFFIC_REPORT, [...new Set(hints)]), mall_id: mallId };
}
