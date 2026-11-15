import { runEndpoint } from '../adapter/run-endpoint.js';
import { PLAN_ORDER_INSURANCE_LIST } from '../adapter/endpoints/experience-plan.js';
import { throwIfAborted, abortableSleep } from '../infra/abort.js';
import { createReport } from './operating-report.js';
import { GOODS_PROFIT_REPORT } from './views/goods-profit.js';
import { planMoneyReader } from './views/experience-plan.js';

const DAY_MS = 86400000;
// 上游「运费补贴生效时间跨度不能超过一个月」：单次按创建时间查询最多 30 天。
const SPAN_MS = 30 * DAY_MS;
const PAGE_SIZE = 100;
const FEE_STATUS = Object.freeze({ 收费成功: 'charged', 待收费: 'pending' });

// 订单先创建后成团：创建时间从窗口起点前 1 天起，到窗口终点（含）止，按 ≤30 天分段。
function createSpans(window) {
  const spans = [];
  const end = (window.end * 1000) - 1;
  for (let begin = (window.start * 1000) - DAY_MS; begin <= end; begin += SPAN_MS) {
    spans.push({ createBeginTime: begin, createEndTime: Math.min(begin + SPAN_MS - 1, end) });
  }
  return spans;
}

function addRecords(result, items, money, unknownStatuses) {
  for (const item of items) {
    const status = FEE_STATUS[item.feeStatusDesc] ?? 'unknown';
    if (status === 'unknown') unknownStatuses.add(String(item.feeStatusDesc ?? '缺失'));
    const orderSn = item.orderSn == null ? null : String(item.orderSn);
    if (orderSn === null) { result.complete = false; continue; }
    if (!result.byOrder.has(orderSn)) result.byOrder.set(orderSn, []);
    result.byOrder.get(orderSn).push({ status, fen: money.fen(item.serviceAmountVO) });
  }
}

async function scanSpan(page, ctx, span, { maxPages, delayMs }, state) {
  let total = null;
  let collected = 0;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    throwIfAborted(ctx.signal);
    if (state.result.request_count > 0) await abortableSleep(delayMs, ctx.signal);
    state.result.request_count += 1;
    const list = await runEndpoint(page, PLAN_ORDER_INSURANCE_LIST, { page: pageNumber, ...span }, ctx);
    if (total === null) total = list.total;
    else if (list.total !== total) { state.result.complete = false; return; }
    addRecords(state.result, list.items, state.money, state.unknownStatuses);
    collected += list.items.length;
    if (collected >= total) return;
    if (list.items.length === 0) { state.result.complete = false; return; }
  }
  state.result.truncated = true;
  state.result.complete = false;
}

// 体验提升计划收费记录（待收费 + 收费成功）按订单号汇总；拉取失败或截断时 complete:false，由计算层置 null。
export async function collectProfitInsurance(page, ctx, { window, maxPages = 50, delayMs = 200 }) {
  const result = { byOrder: new Map(), complete: true, truncated: false, warnings: [], hints: [], request_count: 0 };
  const state = { result, money: planMoneyReader(), unknownStatuses: new Set() };
  const report = createReport(ctx, GOODS_PROFIT_REPORT, { window, hints: result.hints });
  const collected = await report.optional('insurance_unavailable', async () => {
    for (const span of createSpans(window)) {
      await scanSpan(page, ctx, span, { maxPages, delayMs }, state);
      if (result.truncated) break;
    }
    return result;
  }, () => ({ ...result, complete: false }));
  if (collected.complete === false && !result.hints.includes('insurance_unavailable')) report.hint('insurance_incomplete');
  collected.warnings = [...state.money.warnings(),
    ...[...state.unknownStatuses].map((status) => `运费险收费状态未知（${status}），对应订单运费险输出为 null`)];
  return collected;
}
