import { SHANGHAI_OFFSET_MS, labelOf, round, toLocalDateTime } from '../../infra/units.js';
import { text } from './_shared.js';

export const DELIVERY_CALIBER = '快递送达即算（入柜/驿站优先，否则签收/代收/出柜）';

export const DELIVERY_SOURCE_LABEL = Object.freeze({
  live: '实时查询',
  in_transit: '运输中',
  untracked: '无可用轨迹',
  skipped_cap: '超出配额未查',
  skipped_throttled: '流控中止未查',
  failed: '查询失败',
  unshipped: '未发货',
});

export function isAfterSalesCaseShipped(raw) {
  const desc = text(raw?.sellerAfterSalesShippingStatusDesc);
  if (desc !== null) return desc === '已发货';
  const status = raw?.sellerAfterSalesShippingStatus;
  return status === 1 || status === '1';
}

export const FORWARD_TRACK_FIELDS = Object.freeze([
  'available', 'shipping_id', 'shipping_name', 'tracking_number', 'got_at',
  'delivered_at', 'delivery_event', 'in_cabinet_at',
  'signed_at', 'transit_days', 'trace_count', 'traces',
]);

export const REVERSE_TRACK_CASE_FIELDS = Object.freeze([
  'after_sales_id', 'status', 'type', 'apply_at', 'closed_at',
  'reverse_shipping_id', 'reverse_shipping_name', 'reverse_tracking_number',
  'reverse_available', 'got_at', 'return_arrived_at', 'return_delivery_event',
  'return_in_cabinet_at', 'return_signed_at',
  'delivery_to_apply_days', 'apply_to_return_arrived_days',
  'delivery_to_return_arrived_days', 'reverse_transit_days', 'trace_count', 'traces',
]);

export const TRACE_NODE_FIELDS = Object.freeze([
  'occurred_at', 'status', 'summary',
]);

export const ORDER_DETAIL_TRACK_FIELDS = Object.freeze([
  'delivery_caliber', 'forward', 'returns',
]);

const TRACE_STATUS_LABEL = Object.freeze({
  GOT: '已揽收',
  DEPARTURE: '运输中',
  ARRIVAL: '已到达',
  TRANSIT: '运输中',
  TRANSPORT: '运输中',
  DISPATCH: '派送中',
  DELIVERING: '派送中',
  IN_CABINET: '已入柜/驿站待取',
  OUT_CABINET: '已出柜/取件',
  SIGN_ON_BEHALF: '已代收',
  SIGN: '已签收',
  INBOUND: '中转入库',
  UNPACKING: '中转合包/拆包',
  OUTBOUND: '中转出库',
  MERCHANT_SHIPPED: '商家已发货',
  OTHER: '其他节点',
});

const TRACE_SUMMARY_TEMPLATE = Object.freeze({
  GOT: '快件已揽收',
  DEPARTURE: '快件运输中（已发出）',
  ARRIVAL: '快件已到达中转节点',
  DISPATCH: '快件正在派送',
  IN_CABINET: '快件已存入快递柜或驿站待取',
  OUT_CABINET: '快件已从快递柜或驿站取出',
  SIGN_ON_BEHALF: '快件已代收',
  SIGN: '快件已签收',
  INBOUND: '快件已到达中转仓入库',
  UNPACKING: '快件正在中转仓合包/拆包',
  OUTBOUND: '快件已从中转仓出库发往目的地',
  MERCHANT_SHIPPED: '商家已发货，等待快递揽收',
  OTHER: '物流节点更新',
});

const SIGN_STATUSES = new Set(['SIGN', 'SIGN_ON_BEHALF', 'OUT_CABINET']);
const CARRIER_PROGRESS_STATUSES = new Set([
  'GOT', 'DEPARTURE', 'ARRIVAL', 'DISPATCH', 'INBOUND', 'UNPACKING',
  'OUTBOUND', 'IN_CABINET', 'OUT_CABINET', 'SIGN', 'SIGN_ON_BEHALF',
]);
const EXPLICIT_STATUS_MAP = Object.freeze({
  GOT: 'GOT',
  COLLECTED: 'GOT',
  PICKED_UP: 'GOT',
  DEPARTURE: 'DEPARTURE',
  TRANSPORT: 'DEPARTURE',
  TRANSIT: 'DEPARTURE',
  SEND: 'DISPATCH',
  ARRIVAL: 'ARRIVAL',
  ARRIVE: 'ARRIVAL',
  DISPATCH: 'DISPATCH',
  DELIVERING: 'DISPATCH',
  DELIVERY: 'DISPATCH',
  IN_CABINET: 'IN_CABINET',
  CABINET_IN: 'IN_CABINET',
  STA_IN: 'IN_CABINET',
  STATION_IN: 'IN_CABINET',
  OUT_CABINET: 'OUT_CABINET',
  CABINET_OUT: 'OUT_CABINET',
  STA_OUT: 'OUT_CABINET',
  STATION_OUT: 'OUT_CABINET',
  SIGN_ON_BEHALF: 'SIGN_ON_BEHALF',
  SIGNED_ON_BEHALF: 'SIGN_ON_BEHALF',
  SIGN: 'SIGN',
  SIGNED: 'SIGN',
  INBOUND: 'INBOUND',
  UNPACKING: 'UNPACKING',
  OUTBOUND: 'OUTBOUND',
});

export const ORDER_TRACK_REPORT = Object.freeze({
  hints: Object.freeze({
    forward_unavailable: '订单暂未发货或正向物流轨迹不可用',
    forward_no_carrier_trace: '正向物流仅有发货通知或历史轨迹已过期，暂无承运商轨迹',
    forward_track_unavailable: '正向物流轨迹拉取失败，正向物流与收货耗时暂不可用',
    reverse_track_missing_id: '部分售后退货单缺少退货物流公司 ID，逆向轨迹暂不可用',
    reverse_track_empty: '部分售后退货单暂无可用逆向物流轨迹',
    reverse_track_unavailable: '部分售后退货单的逆向物流轨迹拉取失败，仅返回已采集结果',
  }),
});

const SHANGHAI_DATETIME_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.\d+)?)?$/;

export function parseShanghaiDateTimeToSeconds(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value >= 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num <= 0) return null;
    return num >= 1e12 ? Math.floor(num / 1000) : num;
  }
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsedMs = Date.parse(trimmed);
    if (!Number.isFinite(parsedMs) || parsedMs <= 0) return null;
    return Math.floor(parsedMs / 1000);
  }
  const match = SHANGHAI_DATETIME_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() + 1 !== month
    || check.getUTCDate() !== day
    || check.getUTCHours() !== hour
    || check.getUTCMinutes() !== minute
    || check.getUTCSeconds() !== second
  ) {
    return null;
  }
  const epochSec = Math.floor((check.getTime() - SHANGHAI_OFFSET_MS) / 1000);
  return epochSec > 0 ? epochSec : null;
}

export function diffDays(fromSec, toSec) {
  if (
    typeof fromSec !== 'number' || !Number.isFinite(fromSec) || fromSec <= 0
    || typeof toSec !== 'number' || !Number.isFinite(toSec) || toSec <= 0
    || toSec < fromSec
  ) {
    return null;
  }
  return round((toSec - fromSec) / 86400, 2);
}

const CABINET_KEYWORDS_RE = /(?:快递柜|自提柜|丰巢|菜鸟驿站|驿站|代收点|代收点位|服务站|服务点|自提点|取件码)/;
const SAFE_STATUS_CODE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

function classifyConsolidationInfo(info) {
  if (!info || CABINET_KEYWORDS_RE.test(info)) return null;
  if (/(?:已出库|出库)[^\n。；]{0,12}(?:装车|发往|中转|转运)|(?:中转仓|集运仓)[^\n。；]{0,12}已出库/.test(info)) {
    return 'OUTBOUND';
  }
  if (/(?:正在合包|正在拆包|合包完成)/.test(info)) return 'UNPACKING';
  if (/(?:送达|送至|到达)[^\n。；]{0,16}(?:中转仓|换单转)|(?:中转仓|转运仓|集运仓|中转|转运|集运|发出|圆通|极兔|中通|韵达|申通|顺丰|邮政)[^\n。；]{0,16}包裹已入库|包裹已入库[^\n。；]{0,16}(?:中转|转运|集运|发出|分拣)/.test(info)) {
    return 'INBOUND';
  }
  return null;
}

function classifyFallbackInfo(info) {
  if (!info) return null;
  if (/(?:商家已发货|正在通知[^，。；\n]{0,12}取件|等待[^，。；\n]{0,8}揽收)/.test(info)) return 'MERCHANT_SHIPPED';
  if (/(?:已从.*取出|已取件离柜|已领取|(?:驿站|快递柜|自提柜|代收点)[^，。；\n]{0,12}已出库)/.test(info)) {
    return 'OUT_CABINET';
  }
  if (/(?:放入|存入|投递\s*(?:至|到)|送\s*(?:至|到|达)|暂存|已到达|已入库)[^\n。；]{0,20}(?:快递柜|自提柜|丰巢|驿站|代收点|服务站|服务点|自提点)/.test(info)) {
    return 'IN_CABINET';
  }
  if (/(?:已代收|代签收|前台代收|门卫代收|物业代收|家人代收|驿站代收)/.test(info)) return 'SIGN_ON_BEHALF';
  if (/(?:凭取件码|等待取件)/.test(info)) return 'IN_CABINET';
  if (/(?:已签收|本人签收|签收成功|客户已签收|已投递)/.test(info)) return 'SIGN';
  if (/(?:正在派件|正在投递|派送中|安排投递|派件员)/.test(info)) return 'DISPATCH';
  if (/(?:已揽收|已收件|已收取快件|揽件成功|(?:快递员|派件员|揽收员|专员|网点|分部)[^，。；\n]{0,35}已取件)/.test(info)) {
    return 'GOT';
  }
  if (/已取件/.test(info)) return 'OUT_CABINET';
  if (/(?:已发往|已发出|离开|发车|装车)/.test(info)) return 'DEPARTURE';
  if (/(?:已到达|到达|抵达)/.test(info)) return 'ARRIVAL';
  return null;
}

export function classifyTraceStatus(node) {
  const info = String(node?.info ?? '').trim();
  const consolidation = classifyConsolidationInfo(info);
  if (consolidation) return consolidation;

  const subStatus = String(node?.subStatus ?? '').trim().toUpperCase();
  if (EXPLICIT_STATUS_MAP[subStatus]) return EXPLICIT_STATUS_MAP[subStatus];
  if (subStatus.startsWith('IN_CABINET')) return 'IN_CABINET';
  if (subStatus.startsWith('OUT_CABINET')) return 'OUT_CABINET';
  if (subStatus.startsWith('SIGN_ON_BEHALF')) return 'SIGN_ON_BEHALF';
  if (subStatus.startsWith('SIGN')) return 'SIGN';

  const status = String(node?.status ?? '').trim().toUpperCase();
  if (EXPLICIT_STATUS_MAP[status]) return EXPLICIT_STATUS_MAP[status];

  const fallback = classifyFallbackInfo(info);
  if (fallback) return fallback;
  return SAFE_STATUS_CODE_RE.test(status) ? status : 'OTHER';
}

export function traceStatusLabel(status) {
  return Object.hasOwn(TRACE_STATUS_LABEL, status) ? TRACE_STATUS_LABEL[status] : TRACE_STATUS_LABEL.OTHER;
}

export function buildTraceSummary(status) {
  return Object.hasOwn(TRACE_SUMMARY_TEMPLATE, status)
    ? TRACE_SUMMARY_TEMPLATE[status]
    : TRACE_SUMMARY_TEMPLATE.OTHER;
}

function buildTraceNodes(rawTraces) {
  const nodes = (Array.isArray(rawTraces) ? rawTraces : []).map((node, index) => {
    const timeSec = parseShanghaiDateTimeToSeconds(node?.time);
    const status = classifyTraceStatus(node);
    const statusLabel = traceStatusLabel(status);
    const summary = buildTraceSummary(status);
    return {
      index,
      timeSec,
      occurred_at: timeSec != null ? toLocalDateTime(timeSec) : null,
      status,
      status_label: statusLabel,
      summary,
    };
  });
  nodes.sort((a, b) => {
    if (a.timeSec == null && b.timeSec == null) return a.index - b.index;
    if (a.timeSec == null) return 1;
    if (b.timeSec == null) return -1;
    return a.timeSec - b.timeSec || a.index - b.index;
  });
  return nodes;
}

function isLegResetNode(node, inCabinetAtSec, signedAtSec) {
  return node.status === 'INBOUND'
    || node.status === 'UNPACKING'
    || node.status === 'OUTBOUND'
    || (node.status === 'GOT' && (inCabinetAtSec != null || signedAtSec != null));
}

function extractMilestonesFromTrack(track) {
  const nodes = buildTraceNodes(track?.traces);
  let gotAtSec = null;
  let inCabinetAtSec = null;
  let signedAtSec = null;
  let signedEvent = null;

  for (const node of nodes) {
    if (node.timeSec == null) continue;
    if (node.status === 'GOT' && gotAtSec == null) gotAtSec = node.timeSec;
    if (isLegResetNode(node, inCabinetAtSec, signedAtSec)) {
      inCabinetAtSec = null;
      signedAtSec = null;
      signedEvent = null;
      continue;
    }
    if (node.status === 'IN_CABINET' && inCabinetAtSec == null) inCabinetAtSec = node.timeSec;
    if (SIGN_STATUSES.has(node.status) && signedAtSec == null) {
      signedAtSec = node.timeSec;
      signedEvent = node.status;
    }
  }

  if (gotAtSec == null) gotAtSec = parseShanghaiDateTimeToSeconds(track?.wideGotTime);
  const deliveredAtSec = inCabinetAtSec ?? signedAtSec ?? null;
  const deliveryEvent = inCabinetAtSec != null ? 'IN_CABINET' : signedAtSec != null ? signedEvent : null;
  const hasCarrierProgress = nodes.some((node) => CARRIER_PROGRESS_STATUSES.has(node.status));

  return {
    got_at_sec: gotAtSec,
    delivered_at_sec: deliveredAtSec,
    delivery_event: deliveryEvent,
    in_cabinet_at_sec: inCabinetAtSec,
    signed_at_sec: signedAtSec,
    has_carrier_progress: hasCarrierProgress,
    traces: nodes.map(({ occurred_at, status_label, summary }) => ({
      occurred_at,
      status: status_label,
      summary,
    })),
  };
}

function formatIdString(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return null;
}

export function extractForwardMilestones(track) {
  const milestones = extractMilestonesFromTrack(track);
  const primaryWaybill = Array.isArray(track?.waybills) && track.waybills.length > 0 ? track.waybills[0] : null;
  return {
    available: Boolean(track?.available),
    shipping_id: formatIdString(primaryWaybill?.shippingId),
    shipping_name: text(primaryWaybill?.shippingName),
    tracking_number: text(primaryWaybill?.trackingNumber),
    ...milestones,
  };
}

export function extractReverseMilestones(track) {
  const milestones = extractMilestonesFromTrack(track);
  return {
    available: Boolean(track?.available),
    shipping_id: formatIdString(track?.shippingId),
    shipping_name: text(track?.shippingName),
    tracking_number: text(track?.trackingNumber),
    ...milestones,
  };
}

function buildForwardTrackView(forwardMilestones) {
  return {
    available: forwardMilestones.available,
    shipping_id: forwardMilestones.shipping_id,
    shipping_name: forwardMilestones.shipping_name,
    tracking_number: forwardMilestones.tracking_number,
    got_at: toLocalDateTime(forwardMilestones.got_at_sec),
    delivered_at: toLocalDateTime(forwardMilestones.delivered_at_sec),
    delivery_event: forwardMilestones.delivery_event ? traceStatusLabel(forwardMilestones.delivery_event) : null,
    in_cabinet_at: toLocalDateTime(forwardMilestones.in_cabinet_at_sec),
    signed_at: toLocalDateTime(forwardMilestones.signed_at_sec),
    transit_days: diffDays(forwardMilestones.got_at_sec, forwardMilestones.delivered_at_sec),
    trace_count: forwardMilestones.traces.length,
    traces: forwardMilestones.traces,
  };
}

function buildReturnTrackCaseView(entry, forwardMilestones) {
  const rawCase = entry?.rawCase ?? {};
  const caseView = entry?.caseView ?? null;
  const reverseMilestones = entry?.reverseMilestones ?? extractReverseMilestones(entry?.reverseTrack);
  const applyAtSec = parseShanghaiDateTimeToSeconds(rawCase.createdAt);
  const closedAtSec = parseShanghaiDateTimeToSeconds(rawCase.closeTime ?? rawCase.closedAt);

  return {
    after_sales_id: caseView?.after_sales_id ?? formatIdString(rawCase.id),
    status: caseView?.status ?? text(rawCase.afterSalesStatusDesc) ?? labelOf({}, rawCase.afterSalesStatus),
    type: caseView?.type ?? text(rawCase.afterSalesTypeName) ?? text(rawCase.afterSalesTypeDesc) ?? labelOf({}, rawCase.afterSalesType),
    apply_at: caseView?.created_at ?? toLocalDateTime(applyAtSec),
    closed_at: caseView?.closed_at ?? toLocalDateTime(closedAtSec),
    reverse_shipping_id: reverseMilestones.shipping_id ?? formatIdString(rawCase.reverseShippingId),
    reverse_shipping_name: reverseMilestones.shipping_name ?? text(rawCase.reverseShippingName),
    reverse_tracking_number: reverseMilestones.tracking_number ?? caseView?.reverse_tracking_number ?? text(rawCase.reverseTrackingNumber),
    reverse_available: reverseMilestones.available,
    got_at: toLocalDateTime(reverseMilestones.got_at_sec),
    return_arrived_at: toLocalDateTime(reverseMilestones.delivered_at_sec),
    return_delivery_event: reverseMilestones.delivery_event ? traceStatusLabel(reverseMilestones.delivery_event) : null,
    return_in_cabinet_at: toLocalDateTime(reverseMilestones.in_cabinet_at_sec),
    return_signed_at: toLocalDateTime(reverseMilestones.signed_at_sec),
    delivery_to_apply_days: diffDays(forwardMilestones.delivered_at_sec, applyAtSec),
    apply_to_return_arrived_days: diffDays(applyAtSec, reverseMilestones.delivered_at_sec),
    delivery_to_return_arrived_days: diffDays(forwardMilestones.delivered_at_sec, reverseMilestones.delivered_at_sec),
    reverse_transit_days: diffDays(reverseMilestones.got_at_sec, reverseMilestones.delivered_at_sec),
    trace_count: reverseMilestones.traces.length,
    traces: reverseMilestones.traces,
  };
}

function buildReturnTimingClause(returns) {
  if (returns.length === 0) return null;
  const latest = returns[0];
  const parts = [];
  if (latest.delivery_to_apply_days != null) parts.push(`收货至发起售后 ${latest.delivery_to_apply_days} 天`);
  const arrivalLabel = latest.return_delivery_event === '已入柜/驿站待取' ? '退回到达' : '退回签收';
  if (latest.delivery_to_return_arrived_days != null) {
    parts.push(`收货至${arrivalLabel} ${latest.delivery_to_return_arrived_days} 天`);
  } else if (latest.apply_to_return_arrived_days != null) {
    parts.push(`发起售后至${arrivalLabel} ${latest.apply_to_return_arrived_days} 天`);
  }
  return parts.length > 0 ? parts.join('，') : null;
}

function buildTrackHeadlineClauses(forward, hasCarrierProgress, returns, forwardFailed) {
  let forwardClause = '正向物流暂无承运商轨迹';
  if (forwardFailed) forwardClause = ORDER_TRACK_REPORT.hints.forward_track_unavailable;
  else if (!forward.available) forwardClause = '正向物流暂无可用轨迹';
  else if (forward.delivered_at) forwardClause = `正向快递 ${forward.delivered_at} 送达（${forward.delivery_event}）`;
  else if (hasCarrierProgress) forwardClause = `正向物流运输中（${forward.trace_count} 条轨迹）`;

  return {
    forwardClause,
    returnTimingClause: buildReturnTimingClause(returns),
  };
}

export function toOrderDetailTrackView({
  forwardTrack = null,
  forwardMilestones = null,
  cases = [],
  forwardFailed = false,
} = {}) {
  const resolvedForwardMilestones = forwardMilestones ?? extractForwardMilestones(forwardTrack);
  const forward = buildForwardTrackView(resolvedForwardMilestones);
  const returns = (Array.isArray(cases) ? cases : []).map((entry) => buildReturnTrackCaseView(entry, resolvedForwardMilestones));
  const clauses = buildTrackHeadlineClauses(forward, resolvedForwardMilestones.has_carrier_progress, returns, forwardFailed);

  return {
    track: {
      delivery_caliber: DELIVERY_CALIBER,
      forward,
      returns,
    },
    ...clauses,
  };
}
