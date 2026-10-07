import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  ORDER_LIST, ORDER_DETAIL, ORDER_STATS, ORDER_LIST_DEFAULT_DAYS, ORDER_LIST_CLI_SCOPES, ORDER_LIST_DEFAULT_SCOPE,
} from '../adapter/endpoints/orders.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { toLocalDate } from '../infra/units.js';
import {
  orderStatusLabel, toLocalOrderStatsView, toOrderDetailView, toOrderView, toRemoteOrderStatsView,
} from './views/order.js';
import { mallIdOf, yuanText } from './views/_shared.js';
import { ORDER_SCOPE_LABEL } from './views/labels.js';

// 命令层经 service 取得 --status 可选值（commands 不直接 import adapter）
export { ORDER_LIST_CLI_SCOPES, ORDER_LIST_DEFAULT_SCOPE };

export async function listOrders(page, params = {}, ctx = {}) {
  return runEndpoint(page, ORDER_LIST, params, ctx);
}

export async function getOrderStats(page, ctx = {}) {
  return runEndpoint(page, ORDER_STATS, {}, ctx);
}

export async function getOrderDetail(page, sn, ctx = {}) {
  if (!sn) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'getOrderDetail: sn (order_sn) is required',
      exitCode: ExitCodes.USAGE,
    });
  }
  return runEndpoint(page, ORDER_DETAIL, { order_sn: String(sn), source: 'MMS' }, ctx);
}

// 状态分布以中文标签为键；上游既无标签也无状态码时归入此键
const UNKNOWN_STATUS = '未知';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

// 售后口径只依据上游 after_sales_status（research order-list-filters-2026-10-08 §3）：
// 5 = 退款成功；其他非空码 = 售后处理中；null = 无售后。
// refund_status / refundStatus / after_sale_type / afterSaleType 在真实数据中不存在，不读取。
const AFTER_SALES_REFUNDED = 5;

// 样本中没有任何订单带 after_sales_status 键 → 售后数据不可用（null），不得伪造为 0
function countAfterSales(list) {
  const hasField = list.some((order) => order && Object.hasOwn(order, 'after_sales_status'));
  let refunded = 0;
  let open = 0;
  for (const order of list) {
    const code = order?.after_sales_status;
    if (code == null) continue;
    if (Number(code) === AFTER_SALES_REFUNDED) refunded += 1;
    else open += 1;
  }
  return { hasField, refunded, open };
}

export function computeOrderStats(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const total = list.length;

  const statusDistribution = {};
  const shippingDurations = [];

  for (const o of list) {
    const key = orderStatusLabel(o) ?? UNKNOWN_STATUS;
    statusDistribution[key] = (statusDistribution[key] ?? 0) + 1;

    const orderTime = o?.order_time ?? o?.orderTime;
    const shipTime = o?.ship_time ?? o?.shipTime ?? o?.shipping_time;
    if (typeof orderTime === 'number' && typeof shipTime === 'number' && shipTime > orderTime) {
      shippingDurations.push(shipTime - orderTime);
    }
  }

  shippingDurations.sort((a, b) => a - b);
  const afterSales = countAfterSales(list);
  const known = total === 0 || afterSales.hasField;

  return {
    total,
    status_distribution: statusDistribution,
    shipping_seconds: {
      samples: shippingDurations.length,
      p50: percentile(shippingDurations, 50),
      p95: percentile(shippingDurations, 95),
    },
    refund_rate: total > 0 && afterSales.hasField ? afterSales.refunded / total : null,
    refund_count: known ? afterSales.refunded : null,
    after_sales_count: known ? afterSales.open : null,
  };
}

// ── 输出契约 v2：命令级结果（headline + 领域视图），命令层只透传 ──

function countByStatus(items) {
  const counts = new Map();
  for (const item of items) {
    const key = item.status ?? UNKNOWN_STATUS;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${label} ${count} 单`).join('；');
}

function windowLabel({ since, until }) {
  if (since == null && until == null) return `近 ${ORDER_LIST_DEFAULT_DAYS} 天`;
  const start = toLocalDate(since);
  const end = toLocalDate(until);
  return start && end ? `${start} 至 ${end}` : '指定时间范围内';
}

// 范围标签：all →「全部订单」，其余如「待发货订单」
function scopeText(scope) {
  return `${ORDER_SCOPE_LABEL[scope] ?? ORDER_SCOPE_LABEL[ORDER_LIST_DEFAULT_SCOPE]}订单`;
}

function listHeadline(params, total, items) {
  const window = windowLabel(params);
  const scope = params.scope ?? ORDER_LIST_DEFAULT_SCOPE;
  if (total === 0 && items.length === 0) {
    return [scope === ORDER_LIST_DEFAULT_SCOPE ? `${window}无订单` : `${window}无${scopeText(scope)}`];
  }
  const pageNumber = params.page ?? 1;
  const pageLabel = pageNumber > 1 ? `第 ${pageNumber} 页` : '本页';
  const summary = `${window}${scopeText(scope)}共 ${total} 单`;
  if (items.length === 0) return [`${summary}，${pageLabel}无订单`];
  return [`${summary}，${pageLabel} ${items.length} 单`, `${pageLabel}状态：${countByStatus(items)}`];
}

// params.scope：ORDER_LIST_CLI_SCOPES 之一，缺省为全部订单（含售后 / 退款 / 已取消）
export async function getOrderListView(page, params = {}, ctx = {}) {
  const query = { ...params, scope: params.scope ?? ORDER_LIST_DEFAULT_SCOPE };
  const result = await listOrders(page, query, ctx);
  const items = (Array.isArray(result?.orders) ? result.orders : []).map(toOrderView);
  const total = result?.total ?? null;
  return { headline: listHeadline(query, total, items), items, total, mall_id: mallIdOf(ctx) };
}

function shippingSentence(order) {
  if (order.shipped_at) return `${order.shipped_at} 发货（${order.express_company ?? '快递公司未记录'}）`;
  const deadline = order.ship_deadline_at ? `，承诺发货截止 ${order.ship_deadline_at}` : '';
  return `暂无发货记录${deadline}`;
}

function detailHeadline(order) {
  return [
    `订单 ${order.order_sn ?? '(无订单号)'}：${order.status ?? UNKNOWN_STATUS}`,
    `${order.goods_name ?? '商品名未记录'} × ${order.quantity ?? '?'}，实付 ${yuanText(order.paid_amount_yuan)}`,
    shippingSentence(order),
  ];
}

export async function getOrderDetailView(page, sn, ctx = {}) {
  const result = await getOrderDetail(page, sn, ctx);
  const order = toOrderDetailView(result?.order);
  return { headline: detailHeadline(order), order, mall_id: mallIdOf(ctx) };
}

function localStatsSentence(local) {
  if (local.order_count === 0) return '本地样本无订单';
  const ship = local.ship_p95_hours == null
    ? '无已发货样本'
    : `下单至发货时长 P95 ${local.ship_p95_hours} 小时`;
  const refund = local.refund_count == null
    ? '退款数据不可用'
    : `退款成功 ${local.refund_count} 单，售后处理中 ${local.after_sales_count} 单`;
  return `本地样本 ${local.order_count} 单：${refund}，${ship}`;
}

function statsHeadline(remote, local) {
  return [
    `待发货 ${remote.pending_ship_count} 单，其中超过 12 小时 ${remote.pending_ship_over_12h_count} 单`,
    `延迟发货 ${remote.delayed_ship_count} 单，已发货待收货 ${remote.pending_receipt_count} 单`,
    localStatsSentence(local),
  ];
}

export async function getOrderStatsView(page, { size = 50 } = {}, ctx = {}) {
  const remote = toRemoteOrderStatsView(await getOrderStats(page, ctx));
  // 本地样本须包含售后订单（scope all），否则退款统计在请求层即被排除
  const listResult = await listOrders(page, { page: 1, size, scope: 'all' }, ctx);
  const local = toLocalOrderStatsView(computeOrderStats(listResult.orders));
  return { headline: statsHeadline(remote, local), remote, local, mall_id: mallIdOf(ctx) };
}
