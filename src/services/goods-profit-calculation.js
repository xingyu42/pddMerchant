import { toFiniteNumber } from '../infra/units.js';
import { sumKnown, ratioPct } from '../infra/metrics.js';
import { COST_NAMES } from './goods-cost-input.js';

// 运费险不在成本录入中，取平台收费记录（insuranceFen）。
const PROFIT_COST_FIELDS = Object.freeze([...COST_NAMES.map((name) => `${name}_fen`), 'insurance_fen']);
const ORDER_MONEY_FIELDS = ['paid_amount_fen', 'platform_discount_fen', 'revenue_fen', 'observed_revenue_fen', 'after_sales_revenue_fen'];
const SUM_FIELDS = [...ORDER_MONEY_FIELDS, ...PROFIT_COST_FIELDS, 'observed_order_count', 'quantity',
  'refunded_order_count', 'after_sales_order_count', 'default_fallback_order_count', 'missing_entry_order_count'];
const WINDOW_MONEY_FIELDS = [...ORDER_MONEY_FIELDS.filter((key) => key !== 'observed_revenue_fen'),
  ...PROFIT_COST_FIELDS, 'merchant_cost_fen', 'gross_profit_fen', 'net_profit_fen'];

function fen(value) {
  const number = toFiniteNumber(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function emptyTotals() {
  return { ...Object.fromEntries(SUM_FIELDS.map((field) => [field, 0])), cost_updated_at: null, missing_entry: false };
}

// 未付款取消：pay_status 为 0。这类订单没有成交时间（confirm_time 为 0），金额与成本均按 0 计。
export function isUnpaidCancelled(order) {
  return order?.pay_status != null && Number(order.pay_status) === 0;
}

function classify(order) {
  if (isUnpaidCancelled(order)) return 'cancelled';
  if (!Object.hasOwn(order, 'after_sales_status')) return 'unknown';
  if (order.after_sales_status === null) return 'normal';
  const code = Number(order.after_sales_status);
  if (code === 5) return 'refunded';
  if (code === 10 || code === 11) return 'open';
  return 'unknown';
}

function matchEntry(order, entries) {
  const goodsId = order.goods_id == null ? null : String(order.goods_id);
  const spec = typeof order.spec === 'string' && order.spec.length ? order.spec : null;
  const exact = entries.get(JSON.stringify([goodsId, spec]));
  const fallback = entries.get(JSON.stringify([goodsId, null]));
  return { entry: exact ?? fallback ?? null, fallback: !exact && Boolean(fallback) && spec !== null };
}

// 运费险取体验提升计划收费记录的平台逐单服务费，不读成本录入值（ADR 0004）：收费成功退款不扣回；
// 待收费在退款或未付款取消时为 0；记录拉全时无记录为 0；记录不完整、金额或状态未知为 null。
function insuranceFen(order, state, insurance) {
  if (state === 'cancelled') return 0;
  if (!insurance?.complete) return null;
  const identity = order.order_sn ?? order.orderSn;
  const records = identity == null ? [] : insurance.byOrder.get(String(identity)) ?? [];
  return sumKnown(records.map((record) => {
    if (record.status === 'charged') return record.fen;
    if (record.status !== 'pending' || state === 'unknown') return null;
    return state === 'refunded' ? 0 : record.fen;
  }));
}

function orderCosts(order, state, entry, quantity, insurance) {
  if (state === 'cancelled') return Object.fromEntries(PROFIT_COST_FIELDS.map((field) => [field, 0]));
  const refunded = state === 'refunded';
  const shippedAt = toFiniteNumber(order.shipping_time);
  const shipped = shippedAt === 0 ? false : shippedAt > 0 ? true : null;
  const costs = {};
  for (const field of PROFIT_COST_FIELDS) {
    if (field === 'insurance_fen') costs[field] = insuranceFen(order, state, insurance);
    else if (state === 'unknown') costs[field] = null;
    else if (field === 'purchase_fen') costs[field] = refunded ? 0 : entry && quantity !== null ? entry[field] * quantity : null;
    else if (refunded && shipped === false) costs[field] = 0;
    else costs[field] = refunded && shipped === null ? null : entry?.[field] ?? null;
  }
  return costs;
}

function orderTotals(order, entryIndex, insurance) {
  const state = classify(order);
  const zero = state === 'cancelled' || state === 'refunded';
  const quantity = zero ? 0 : fen(order.goods_number);
  const paid = zero ? 0 : state === 'unknown' ? null : fen(order.order_amount);
  const platform = zero ? 0 : state === 'unknown' ? null : fen(order.platform_discount);
  const revenue = sumKnown([paid, platform]);
  const match = matchEntry(order, entryIndex);
  return {
    ...orderCosts(order, state, match.entry, quantity, insurance),
    paid_amount_fen: paid, platform_discount_fen: platform, revenue_fen: revenue, observed_revenue_fen: revenue,
    observed_order_count: 1, quantity,
    refunded_order_count: state === 'unknown' ? null : Number(state === 'refunded'),
    after_sales_order_count: state === 'unknown' ? null : Number(state === 'open'),
    after_sales_revenue_fen: state === 'unknown' ? null : state === 'open' ? revenue : 0,
    default_fallback_order_count: Number(match.fallback), missing_entry_order_count: Number(!match.entry),
    cost_updated_at: match.entry?.updated_at ?? null, missing_entry: !match.entry,
  };
}

function mergeTotals(target, source) {
  for (const field of SUM_FIELDS) target[field] = sumKnown([target[field], source[field]]);
  if (source.cost_updated_at && (!target.cost_updated_at || source.cost_updated_at > target.cost_updated_at)) {
    target.cost_updated_at = source.cost_updated_at;
  }
  target.missing_entry ||= source.missing_entry;
}

function finishTotals(totals, ordersComplete, spend) {
  const result = { ...totals, order_count: totals.observed_order_count, promo_spend_fen: spend };
  result.merchant_cost_fen = totals.missing_entry ? null : sumKnown(PROFIT_COST_FIELDS.map((field) => totals[field]));
  result.gross_profit_fen = result.revenue_fen === null || result.merchant_cost_fen === null
    ? null : result.revenue_fen - result.merchant_cost_fen;
  result.net_profit_fen = result.gross_profit_fen === null || spend === null ? null : result.gross_profit_fen - spend;
  if (!ordersComplete) {
    for (const field of WINDOW_MONEY_FIELDS) result[field] = null;
    result.order_count = null;
    result.quantity = null;
  }
  result.gross_margin_pct = ratioPct(result.gross_profit_fen, result.revenue_fen);
  result.net_margin_pct = ratioPct(result.net_profit_fen, result.revenue_fen);
  result.data_status = ordersComplete && result.net_profit_fen !== null ? 'full' : 'partial';
  return result;
}

function groupOrders(orders, entries, promo, insurance) {
  const index = new Map(entries.map((entry) => [JSON.stringify([entry.goods_id, entry.spec]), entry]));
  const groups = new Map();
  for (const order of orders) {
    const goodsId = order.goods_id == null || order.goods_id === '' ? null : String(order.goods_id);
    if (!groups.has(goodsId)) groups.set(goodsId, { ...emptyTotals(), goods_id: goodsId, goods_name: order.goods_name ?? null });
    const group = groups.get(goodsId);
    if (!group.goods_name && order.goods_name) group.goods_name = order.goods_name;
    mergeTotals(group, orderTotals(order, index, insurance));
  }
  for (const goodsId of promo?.byGoods?.keys() ?? []) {
    if (!groups.has(goodsId)) groups.set(goodsId, { ...emptyTotals(), goods_id: goodsId, goods_name: null,
      missing_entry: !entries.some((entry) => entry.goods_id === goodsId) });
  }
  return groups;
}

export function computeGoodsProfit({ orders = [], entries = [], promo = null, insurance = null, quality = {} }) {
  const groups = groupOrders(orders, entries, promo, insurance);
  const summaryTotals = emptyTotals();
  const items = [];
  let unattributed = 0;
  for (const group of groups.values()) {
    mergeTotals(summaryTotals, group);
    if (group.goods_id === null) { unattributed += group.observed_order_count; continue; }
    const spend = promo?.complete ? (promo.byGoods.has(group.goods_id) ? promo.byGoods.get(group.goods_id) : 0) : null;
    items.push(finishTotals(group, quality.orders_complete !== false, spend));
  }
  const summary = finishTotals(summaryTotals, quality.orders_complete !== false, promo?.complete ? promo.total_fen : null);
  if (unattributed) { summary.net_profit_fen = null; summary.net_margin_pct = null; summary.data_status = 'partial'; }
  summary.goods_count = items.length;
  summary.unattributed_order_count = unattributed;
  summary.attributed_promo_spend_fen = promo?.complete ? promo.attributed_fen : null;
  summary.shop_promo_spend_fen = promo?.complete ? promo.shop_fen : null;
  if (promo?.shop_fen === null) summary.data_status = 'partial';
  items.sort((first, second) => first.goods_id.localeCompare(second.goods_id));
  return { items, summary };
}
