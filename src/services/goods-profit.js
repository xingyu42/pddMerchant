import { responseShapeError } from '../infra/errors.js';
import { toFiniteNumber } from '../infra/units.js';
import { throwIfAborted } from '../infra/abort.js';
import { listOrders } from './orders.js';
import { collectOrdersForStaleAnalysis } from './diagnose/orders-collector.js';
import { listGoodsCosts } from '../infra/goods-cost-store.js';
import { computeGoodsProfit } from './goods-profit-calculation.js';
import { collectProfitPromo } from './goods-profit-promo.js';
import { costScope, validateCostGoodsId } from './goods-cost-input.js';
import { toGoodsProfitView, GOODS_PROFIT_REPORT } from './views/goods-profit.js';
import { runReport, createReport, validateReportDays } from './operating-report.js';
import { completeShanghaiWindow } from './report-windows.js';

export { GOODS_PROFIT_REPORT };

const ORDER_FACT_FIELDS = ['goods_id', 'spec', 'goods_number', 'order_amount', 'platform_discount',
  'after_sales_status', 'shipping_time', 'pay_status', 'group_time'];

export function resolveProfitWindow(days = GOODS_PROFIT_REPORT.days.default, now = Math.floor(Date.now() / 1000)) {
  validateReportDays(GOODS_PROFIT_REPORT, days);
  return completeShanghaiWindow(days, now);
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
  const report = createReport(ctx, GOODS_PROFIT_REPORT, { window, hints });
  if (scan.truncated) report.hint('orders_truncated');
  if (scan.ratelimited) report.hint('orders_ratelimited');
  if (filtered.invalid) report.hint('invalid_order_window');
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

export async function getGoodsProfitView(ctx, { days = GOODS_PROFIT_REPORT.days.default, goodsId: filter } = {}) {
  return runReport(ctx, GOODS_PROFIT_REPORT, { days, window: completeShanghaiWindow }, async (report) => {
    const { window } = report;
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
  });
}
