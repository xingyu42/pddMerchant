import { ORDER_FORWARD_TRACK, AFTER_SALES_REVERSE_TRACK } from '../adapter/endpoints/logistics.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import { throwIfAborted } from '../infra/abort.js';
import { PddCliError } from '../infra/errors.js';
import { toFiniteNumber } from '../infra/units.js';
import { createReport, isDegradableReportError, reportHints } from './operating-report.js';
import { text } from './views/_shared.js';
import {
  ORDER_TRACK_REPORT,
  extractForwardMilestones,
  extractReverseMilestones,
  isAfterSalesCaseShipped,
  toOrderDetailTrackView,
} from './views/logistics.js';

export const AFTER_SALES_DEFAULT_MAX_TRACK_FETCHES = 50;
export const AFTER_SALES_MAX_TRACK_FETCHES_LIMIT = 500;

function emptyDeliveryRecord(source) {
  return {
    delivered_at_sec: null,
    delivery_event: null,
    in_cabinet_at_sec: null,
    signed_at_sec: null,
    source,
  };
}

function emptyReverseResult(overrides = {}) {
  return {
    reverseTrack: null,
    reverseMilestones: null,
    requestCount: 0,
    missingId: false,
    empty: false,
    failed: false,
    ...overrides,
  };
}

function isFatalLogisticsError(err, signal, { treatRateLimitAsFatal = true } = {}) {
  if (signal?.aborted || err?.name === 'AbortError') return true;
  if (!(err instanceof PddCliError)) return true;
  if (err.code === 'E_TIMEOUT' || err.code === 'E_INTERNAL' || err.code === 'E_RISK_CONTROL') return true;
  if (treatRateLimitAsFatal && err.code === 'E_RATE_LIMIT') return true;
  return typeof err.code === 'string' && err.code.startsWith('E_AUTH_');
}

async function collectForwardTrack(ctx, sn, report) {
  throwIfAborted(ctx?.signal);
  try {
    const forwardTrack = await runEndpoint(ctx.page, ORDER_FORWARD_TRACK, { orderSn: sn }, ctx);
    throwIfAborted(ctx?.signal);
    return { forwardTrack, forwardFailed: false, requestCount: 1 };
  } catch (err) {
    if (isFatalLogisticsError(err, ctx?.signal) || !isDegradableReportError(err)) throw err;
    report.hint('forward_track_unavailable');
    return { forwardTrack: null, forwardFailed: true, requestCount: 1 };
  }
}

async function collectSingleReverseTrack(ctx, rawCase) {
  const trackingNumber = text(rawCase?.reverseTrackingNumber);
  if (!trackingNumber) return emptyReverseResult();
  const shippingId = toFiniteNumber(rawCase?.reverseShippingId);
  if (shippingId == null || !Number.isSafeInteger(shippingId)) {
    return emptyReverseResult({ missingId: true });
  }
  throwIfAborted(ctx?.signal);
  try {
    const reverseTrack = await runEndpoint(
      ctx.page,
      AFTER_SALES_REVERSE_TRACK,
      { shippingId, trackingNumber },
      ctx,
    );
    throwIfAborted(ctx?.signal);
    const reverseMilestones = reverseTrack == null ? null : extractReverseMilestones(reverseTrack);
    const hasCarrierTraces = reverseMilestones?.available && reverseMilestones.has_carrier_progress;
    return emptyReverseResult({
      reverseTrack,
      reverseMilestones,
      requestCount: 1,
      empty: !hasCarrierTraces,
    });
  } catch (err) {
    if (isFatalLogisticsError(err, ctx?.signal) || !isDegradableReportError(err)) throw err;
    return emptyReverseResult({ requestCount: 1, failed: true });
  }
}

export async function collectOrderTrack(ctx, { orderSn, caseEntries = [] } = {}) {
  const sn = typeof orderSn === 'string' || typeof orderSn === 'number' ? String(orderSn).trim() : '';
  const report = createReport(ctx, ORDER_TRACK_REPORT);
  const { forwardTrack, forwardFailed, requestCount: forwardRequests } = await collectForwardTrack(ctx, sn, report);
  let xhrCount = forwardRequests;
  const forwardMilestones = extractForwardMilestones(forwardTrack);

  if (!forwardFailed && !forwardTrack?.available) {
    report.hint('forward_unavailable');
  } else if (!forwardFailed && !forwardMilestones.has_carrier_progress) {
    report.hint('forward_no_carrier_trace');
  }

  const cases = [];
  let warnedMissingId = false;
  let warnedEmptyReverse = false;
  let warnedReverseFailed = false;
  for (const entry of Array.isArray(caseEntries) ? caseEntries : []) {
    const result = await collectSingleReverseTrack(ctx, entry?.rawCase);
    xhrCount += result.requestCount;
    if (result.missingId) warnedMissingId = true;
    if (result.empty) warnedEmptyReverse = true;
    if (result.failed) warnedReverseFailed = true;
    cases.push({
      rawCase: entry?.rawCase,
      caseView: entry?.caseView ?? null,
      reverseTrack: result.reverseTrack,
      reverseMilestones: result.reverseMilestones,
    });
  }

  if (warnedMissingId) report.hint('reverse_track_missing_id');
  if (warnedEmptyReverse) report.hint('reverse_track_empty');
  if (warnedReverseFailed) report.hint('reverse_track_unavailable');

  const { track, forwardClause, returnTimingClause } = toOrderDetailTrackView({
    forwardTrack,
    forwardMilestones,
    cases,
    forwardFailed,
  });

  return {
    track,
    forwardClause,
    returnTimingClause,
    hints: reportHints(ORDER_TRACK_REPORT, report.hints),
    requestCount: xhrCount,
  };
}

function collectShippedUniqueOrderSns(rawItems) {
  const uniqueOrderSns = [];
  const seen = new Set();
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    if (!isAfterSalesCaseShipped(item)) continue;
    const sn = typeof item?.orderSn === 'string' || typeof item?.orderSn === 'number'
      ? String(item.orderSn).trim()
      : '';
    if (!sn || seen.has(sn)) continue;
    seen.add(sn);
    uniqueOrderSns.push(sn);
  }
  return uniqueOrderSns;
}

async function fetchSingleOrderDelivery(ctx, sn) {
  try {
    const track = await runEndpoint(ctx.page, ORDER_FORWARD_TRACK, { orderSn: sn }, ctx);
    throwIfAborted(ctx?.signal);
    const milestones = extractForwardMilestones(track);
    if (milestones.delivered_at_sec != null) {
      return {
        status: 'delivered',
        record: {
          delivered_at_sec: milestones.delivered_at_sec,
          delivery_event: milestones.delivery_event,
          in_cabinet_at_sec: milestones.in_cabinet_at_sec,
          signed_at_sec: milestones.signed_at_sec,
          source: 'live',
        },
      };
    }
    if (milestones.has_carrier_progress) {
      return { status: 'in_transit', record: emptyDeliveryRecord('in_transit') };
    }
    return { status: 'untracked', record: emptyDeliveryRecord('untracked') };
  } catch (err) {
    if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
      return { status: 'rate_limited', record: emptyDeliveryRecord('failed') };
    }
    if (isFatalLogisticsError(err, ctx?.signal, { treatRateLimitAsFatal: false }) || !isDegradableReportError(err)) {
      throw err;
    }
    return { status: 'failed', record: emptyDeliveryRecord('failed') };
  }
}

function applyDeliveryOutcome(counters, outcome, report) {
  if (outcome.status === 'delivered') {
    counters.deliveredCount++;
    return false;
  }
  if (outcome.status === 'in_transit') {
    counters.inTransitCount++;
    return false;
  }
  if (outcome.status === 'failed') {
    counters.failedCount++;
    counters.partialFailed = true;
    return false;
  }
  if (outcome.status === 'rate_limited') {
    counters.failedCount++;
    report?.hint('delivery_track_rate_limited');
    return true;
  }
  return false;
}

function markRemainingOrders(byOrderSn, uniqueOrderSns, startIndex, source) {
  const skippedCount = Math.max(0, uniqueOrderSns.length - startIndex);
  for (let j = startIndex; j < uniqueOrderSns.length; j++) {
    byOrderSn.set(uniqueOrderSns[j], emptyDeliveryRecord(source));
  }
  return skippedCount;
}

export async function enrichAfterSalesDeliveries(
  ctx,
  rawItems,
  { maxTrackFetches = AFTER_SALES_DEFAULT_MAX_TRACK_FETCHES, report = null } = {},
) {
  const effectiveMaxFetches = maxTrackFetches ?? AFTER_SALES_DEFAULT_MAX_TRACK_FETCHES;
  const uniqueOrderSns = collectShippedUniqueOrderSns(rawItems);
  const byOrderSn = new Map();
  const counters = {
    requestCount: 0,
    deliveredCount: 0,
    inTransitCount: 0,
    skippedCapCount: 0,
    skippedThrottledCount: 0,
    failedCount: 0,
    capped: false,
    partialFailed: false,
  };

  for (let i = 0; i < uniqueOrderSns.length; i++) {
    if (counters.requestCount >= effectiveMaxFetches) {
      counters.capped = true;
      counters.skippedCapCount = markRemainingOrders(byOrderSn, uniqueOrderSns, i, 'skipped_cap');
      report?.hint('delivery_track_capped');
      break;
    }
    throwIfAborted(ctx?.signal);
    counters.requestCount++;
    const outcome = await fetchSingleOrderDelivery(ctx, uniqueOrderSns[i]);
    byOrderSn.set(uniqueOrderSns[i], outcome.record);
    if (applyDeliveryOutcome(counters, outcome, report)) {
      counters.skippedThrottledCount = markRemainingOrders(byOrderSn, uniqueOrderSns, i + 1, 'skipped_throttled');
      break;
    }
  }

  if (counters.partialFailed) report?.hint('delivery_track_partial_failed');
  return {
    byOrderSn,
    requestCount: counters.requestCount,
    stats: {
      unique_orders_count: uniqueOrderSns.length,
      fetched_orders_count: counters.requestCount,
      delivered_orders_count: counters.deliveredCount,
      in_transit_orders_count: counters.inTransitCount,
      skipped_cap_orders_count: counters.skippedCapCount,
      skipped_throttled_orders_count: counters.skippedThrottledCount,
      failed_orders_count: counters.failedCount,
      max_track_fetches: effectiveMaxFetches,
      capped: counters.capped,
    },
  };
}
