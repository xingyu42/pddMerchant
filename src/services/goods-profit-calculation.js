import { toFiniteNumber, round } from '../infra/units.js';
import { COST_NAMES } from './goods-cost-input.js';

export const PROFIT_COST_FIELDS = Object.freeze(COST_NAMES.map((name) => `${name}_fen`));
const ORDER_MONEY_FIELDS = ['paid_amount_fen', 'platform_discount_fen', 'revenue_fen', 'observed_revenue_fen', 'after_sales_revenue_fen'];
const SUM_FIELDS = [...ORDER_MONEY_FIELDS, ...PROFIT_COST_FIELDS, 'observed_order_count', 'quantity',
  'refunded_order_count', 'after_sales_order_count', 'default_fallback_order_count', 'missing_entry_order_count'];
const WINDOW_MONEY_FIELDS = [...ORDER_MONEY_FIELDS.filter((key) => key !== 'observed_revenue_fen'),
  ...PROFIT_COST_FIELDS, 'merchant_cost_fen', 'gross_profit_fen', 'net_profit_fen'];

export function sumKnown(values) {
  return values.some((value) => value == null) ? null : values.reduce((sum, value) => sum + value, 0);
}

function fen(value) {
  const number = toFiniteNumber(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function emptyTotals() {
  return { ...Object.fromEntries(SUM_FIELDS.map((field) => [field, 0])), cost_updated_at: null, missing_entry: false };
}

function classify(order) {
  if (order.pay_status != null && Number(order.pay_status) === 0) return 'cancelled';
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

function orderCosts(order, state, entry, quantity) {
  if (state === 'cancelled') return Object.fromEntries(PROFIT_COST_FIELDS.map((field) => [field, 0]));
  if (state === 'unknown') return Object.fromEntries(PROFIT_COST_FIELDS.map((field) => [field, null]));
  const refunded = state === 'refunded';
  const shippedAt = toFiniteNumber(order.shipping_time);
  const shipped = shippedAt === 0 ? false : shippedAt > 0 ? true : null;
  const costs = {};
  for (const field of PROFIT_COST_FIELDS) {
    if (field === 'purchase_fen') costs[field] = refunded ? 0 : entry && quantity !== null ? entry[field] * quantity : null;
    else if (refunded && shipped === false) costs[field] = 0;
    else costs[field] = refunded && shipped === null ? null : entry?.[field] ?? null;
  }
  return costs;
}

function orderTotals(order, entryIndex) {
  const state = classify(order);
  const zero = state === 'cancelled' || state === 'refunded';
  const quantity = zero ? 0 : fen(order.goods_number);
  const paid = zero ? 0 : state === 'unknown' ? null : fen(order.order_amount);
  const platform = zero ? 0 : state === 'unknown' ? null : fen(order.platform_discount);
  const revenue = sumKnown([paid, platform]);
  const match = matchEntry(order, entryIndex);
  return {
    ...orderCosts(order, state, match.entry, quantity),
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

function percent(numerator, denominator) {
  return numerator == null || denominator == null || denominator === 0 ? null : round(numerator / denominator * 100, 2);
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
  result.gross_margin_pct = percent(result.gross_profit_fen, result.revenue_fen);
  result.net_margin_pct = percent(result.net_profit_fen, result.revenue_fen);
  result.data_status = ordersComplete && result.net_profit_fen !== null ? 'full' : 'partial';
  return result;
}

function groupOrders(orders, entries, promo) {
  const index = new Map(entries.map((entry) => [JSON.stringify([entry.goods_id, entry.spec]), entry]));
  const groups = new Map();
  for (const order of orders) {
    const goodsId = order.goods_id == null || order.goods_id === '' ? null : String(order.goods_id);
    if (!groups.has(goodsId)) groups.set(goodsId, { ...emptyTotals(), goods_id: goodsId, goods_name: order.goods_name ?? null });
    const group = groups.get(goodsId);
    if (!group.goods_name && order.goods_name) group.goods_name = order.goods_name;
    mergeTotals(group, orderTotals(order, index));
  }
  for (const goodsId of promo?.byGoods?.keys() ?? []) {
    if (!groups.has(goodsId)) groups.set(goodsId, { ...emptyTotals(), goods_id: goodsId, goods_name: null,
      missing_entry: !entries.some((entry) => entry.goods_id === goodsId) });
  }
  return groups;
}

export function computeGoodsProfit({ orders = [], entries = [], promo = null, quality = {} }) {
  const groups = groupOrders(orders, entries, promo);
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
