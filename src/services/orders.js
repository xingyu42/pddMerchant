import { runEndpoint } from '../adapter/run-endpoint.js';
import { ORDER_LIST, ORDER_DETAIL, ORDER_STATS } from '../adapter/endpoints/orders.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';

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

export function computeOrderStats(orders) {
  const list = Array.isArray(orders) ? orders : [];
  const total = list.length;

  const statusDistribution = {};
  const shippingDurations = [];
  let refundCount = 0;

  for (const o of list) {
    const status = o?.order_status ?? o?.orderStatus;
    const key = status == null ? 'unknown' : String(status);
    statusDistribution[key] = (statusDistribution[key] ?? 0) + 1;

    const orderTime = o?.order_time ?? o?.orderTime;
    const shipTime = o?.ship_time ?? o?.shipTime ?? o?.shipping_time;
    if (typeof orderTime === 'number' && typeof shipTime === 'number' && shipTime > orderTime) {
      shippingDurations.push(shipTime - orderTime);
    }

    const hasRefund = Boolean(
      o?.refund_status
      ?? o?.refundStatus
      ?? (o?.after_sale_type && o.after_sale_type !== 1)
      ?? (o?.afterSaleType && o.afterSaleType !== 1)
    );
    if (hasRefund) refundCount += 1;
  }

  shippingDurations.sort((a, b) => a - b);

  return {
    total,
    status_distribution: statusDistribution,
    shipping_seconds: {
      samples: shippingDurations.length,
      p50: percentile(shippingDurations, 50),
      p95: percentile(shippingDurations, 95),
    },
    refund_rate: total > 0 ? refundCount / total : 0,
    refund_count: refundCount,
  };
}
