import { PddCliError, ExitCodes, responseShapeError } from '../infra/errors.js';
import { toLocalDate, toFiniteNumber } from '../infra/units.js';
import { throwIfAborted } from '../infra/abort.js';
import { listOrders } from './orders.js';
import { collectOrdersForStaleAnalysis } from './diagnose/orders-collector.js';
import { listGoodsCosts } from '../infra/goods-cost-store.js';
import { computeGoodsProfit } from './goods-profit-calculation.js';
import { collectProfitPromo } from './goods-profit-promo.js';
import { costScope, validateCostGoodsId } from './goods-cost-input.js';
import { toGoodsProfitView } from './views/goods-profit.js';

const DAY_SECONDS = 86400;
const ORDER_FACT_FIELDS = ['goods_id', 'spec', 'goods_number', 'order_amount', 'platform_discount',
  'after_sales_status', 'shipping_time', 'pay_status', 'group_time'];

export function resolveProfitWindow(days = 30, now = Math.floor(Date.now() / 1000)) {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new PddCliError({ code: 'E_USAGE', message: '--days 需要 1–90 的整数，默认 30', exitCode: ExitCodes.USAGE });
  }
  const end = Math.floor((now + 8 * 3600) / DAY_SECONDS) * DAY_SECONDS - 8 * 3600;
  const start = end - days * DAY_SECONDS;
  return { days, start, end, startDate: toLocalDate(start), endDate: toLocalDate(end - 1) };
}

function filterOrders(orders, window) {
  const seen = new Map();
  const filtered = [];
  let invalid = false;
  for (const order of orders) {
    const groupedAt = toFiniteNumber(order?.group_time);
    if (!Number.isInteger(groupedAt) || groupedAt <= 0) { invalid = true; continue; }
    if (groupedAt < window.start || groupedAt >= window.end) continue;
    const identity = order.order_sn ?? order.orderSn;
    const facts = JSON.stringify(ORDER_FACT_FIELDS.map((field) => order[field]));
    if (identity != null && seen.has(String(identity))) {
      invalid ||= seen.get(String(identity)) !== facts;
      continue;
    }
    if (identity != null) seen.set(String(identity), facts);
    filtered.push(order);
  }
  return { orders: filtered, invalid };
}

async function readProfitOrders(page, params, ctx) {
  throwIfAborted(ctx.signal);
  const result = await listOrders(page, params, ctx);
  if (!Array.isArray(result?.orders)) throw responseShapeError('orders.list', 'orders');
  return result;
}

export async function collectProfitOrders(page, ctx, { window, maxPages, delayMs } = {}) {
  throwIfAborted(ctx.signal);
  let requestCount = 0;
  const read = async (currentPage, params, currentCtx) => {
    requestCount += 1;
    return readProfitOrders(currentPage, params, currentCtx);
  };
  const scan = await collectOrdersForStaleAnalysis(page, ctx, {
    scope: 'all', since: window.start, now: window.end - 1, scanDays: window.days,
    pageSize: 50, maxPages: maxPages ?? Math.max(10, Math.ceil(window.days / 7) * 3),
    ...(delayMs === undefined ? {} : { delayMs }), listOrders: read,
  });
  throwIfAborted(ctx.signal);
  const filtered = filterOrders(scan.orders, window);
  const hints = [];
  if (scan.truncated) hints.push('orders_truncated');
  if (scan.ratelimited) hints.push('orders_ratelimited');
  if (filtered.invalid) hints.push('invalid_order_window');
  return { ...scan, orders: filtered.orders, complete: !scan.truncated && !scan.ratelimited && !filtered.invalid,
    request_count: requestCount, hints };
}

function filterProfitItems(analysis, goodsId, input) {
  if (goodsId === null) return analysis;
  const matched = analysis.items.filter((item) => item.goods_id === goodsId);
  if (matched.length) return { ...analysis, items: matched };
  const known = input.promo.byGoods.has(goodsId) ? input.promo.byGoods.get(goodsId) : 0;
  const promo = { ...input.promo, byGoods: new Map([[goodsId, known]]) };
  return { ...analysis, items: computeGoodsProfit({ ...input, orders: [], promo }).items };
}

export async function getGoodsProfitView(ctx, { days = 30, goodsId: filter } = {}) {
  const window = resolveProfitWindow(days);
  const goodsId = filter == null ? null : validateCostGoodsId(filter);
  const scope = costScope({ ...ctx, config: { mall: ctx.mallId } });
  const entries = listGoodsCosts(scope);
  const orders = await collectProfitOrders(ctx.page, ctx, { window });
  const promo = await collectProfitPromo(ctx.page, ctx, { window });
  const quality = { orders_complete: orders.complete, orders_truncated: orders.truncated, orders_ratelimited: orders.ratelimited,
    promo_complete: promo.complete, promo_truncated: promo.truncated, promo_ratelimited: promo.ratelimited };
  const input = { orders: orders.orders, entries, promo, quality };
  const analysis = filterProfitItems(computeGoodsProfit(input), goodsId, input);
  return { data: toGoodsProfitView(analysis, { window, quality, mallId: scope.mallId, goodsId,
    reasons: [...orders.hints, ...promo.hints] }), warnings: promo.warnings,
  meta: { xhr_count: orders.request_count + promo.request_count } };
}
