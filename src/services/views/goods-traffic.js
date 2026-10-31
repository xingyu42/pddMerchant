import { round, toPct, toFiniteNumber, yuanFromFen } from '../../infra/units.js';
import { TRAFFIC_HINT_LABEL } from './labels.js';

const METRICS = [
  ['visitor_count', 'goodsUv'], ['page_view_count', 'goodsPv'], ['fav_user_count', 'goodsFavCnt'],
  ['order_create_user_count', 'ordrCrtUsrCnt'], ['order_rate_pct', 'ordrVstrRto', toPct],
  ['pay_conversion_pct', 'goodsVcr', toPct], ['pay_rate_pct', 'payOrdrRto', toPct],
  ['pay_order_count', 'payOrdrCnt'], ['pay_goods_qty', 'payOrdrGoodsQty'], ['pay_buyer_count', 'payOrdrUsrCnt'],
  ['pay_amount_yuan', 'payOrdrAmt', round], ['consult_user_count', 'cnsltUsrQty'],
];
export const GOODS_TRAFFIC_PROMO_FIELDS = Object.freeze(['promo_direct_order_count', 'promo_indirect_order_count',
  'promo_direct_amount_yuan', 'promo_indirect_amount_yuan', 'promo_spend_yuan', 'promo_click_count',
  'non_promo_order_count', 'non_promo_amount_yuan']);
export const GOODS_TRAFFIC_ITEM_FIELDS = Object.freeze(['goods_id', 'goods_name', ...METRICS.map(([key]) => key),
  'category', ...GOODS_TRAFFIC_PROMO_FIELDS]);

export function toGoodsTrafficItem(row, promo = {}) {
  return { goods_id: row.goodsId == null ? null : String(row.goodsId), goods_name: row.goodsName ?? null,
    ...Object.fromEntries(METRICS.map(([key, field, convert = toFiniteNumber]) => [key, convert(row[field])])),
    category: row.cate3Name ?? null,
    promo_direct_order_count: promo.directOrderNum ?? null, promo_indirect_order_count: promo.indirectOrderNum ?? null,
    promo_direct_amount_yuan: yuanFromFen(promo.directAmountFen), promo_indirect_amount_yuan: yuanFromFen(promo.indirectAmountFen),
    promo_spend_yuan: yuanFromFen(promo.spendFen), promo_click_count: promo.click ?? null,
    non_promo_order_count: promo.nonPromoOrders ?? null, non_promo_amount_yuan: yuanFromFen(promo.nonPromoAmountFen) };
}

export function toGoodsTrafficView(rows, { window, goodsId, total, quality, promotions, hints, mallId }) {
  return { headline: [`近 ${window.days} 天商品流量，共 ${total} 个商品，返回 ${rows.length} 条明细`], window,
    filter_goods_id: goodsId ?? null, items: rows.map((row) => toGoodsTrafficItem(row, promotions.get(String(row.goodsId)))),
    total, data_quality: quality, hints: [...new Set(hints)].map((key) => TRAFFIC_HINT_LABEL[key]), mall_id: mallId };
}
