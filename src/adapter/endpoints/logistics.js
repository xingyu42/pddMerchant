import { ExitCodes, PddCliError, responseShapeError } from '../../infra/errors.js';
import { PDD_HOME } from '../auth-state.js';
import { pickFields } from './_shared.js';

const FORWARD_WAYBILL_FIELDS = ['shippingId', 'shippingName', 'trackingNumber'];
const RAW_TRACE_NODE_FIELDS = ['time', 'status', 'subStatus', 'info'];
const FORWARD_TRACE_KEYS = ['traceList'];
const REVERSE_TRACE_KEYS = ['traces', 'trace_list', 'traceList'];
const SUCCESS_BUSINESS_CODES = new Set([0, 1000000, '0', '1000000', '成功']);

function requireNonEmptyString(value, fieldName, endpointName) {
  const trimmed = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!trimmed) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `${endpointName}: missing ${fieldName}`,
      hint: `请提供有效的 ${fieldName}`,
      detail: { endpoint: endpointName, field: fieldName },
      exitCode: ExitCodes.USAGE,
    });
  }
  return trimmed;
}

function assertObjectArray(value, endpointName, fieldLabel) {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw responseShapeError(endpointName, fieldLabel);
  }
  return value;
}

function optionalText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function findTraceField(result, keys) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  for (const key of keys) {
    if (result[key] !== undefined) return { key, value: result[key] };
  }
  return null;
}

function unwrapTrackResult(raw, endpointName) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw responseShapeError(endpointName, 'response object');
  }
  if (!Object.hasOwn(raw, 'result') || raw.result === undefined) {
    throw responseShapeError(endpointName, 'result field');
  }
  if (raw.result !== null && (typeof raw.result !== 'object' || Array.isArray(raw.result))) {
    throw responseShapeError(endpointName, 'result object');
  }
  return raw.result;
}

function hasNonSuccessBusinessCode(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw.errorCode ?? raw.error_code;
  const code = typeof value === 'string' ? value.trim() : value;
  return code != null && code !== '' && !SUCCESS_BUSINESS_CODES.has(code);
}

function redactLogisticsRaw(traceKeys) {
  return (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const traceField = findTraceField(raw.result, traceKeys);
    const traceCount = Array.isArray(traceField?.value) ? traceField.value.length : null;
    return {
      ...(typeof raw.success === 'boolean' ? { success: raw.success } : {}),
      result_present: raw.result != null,
      ...(traceCount !== null ? { trace_count: traceCount } : {}),
    };
  };
}

function mapLogisticsBusinessError(endpointName) {
  return (raw, response) => {
    const status = typeof response?.status === 'function' ? response.status() : response?.status;
    const hasFailureCode = hasNonSuccessBusinessCode(raw);
    if (typeof status === 'number' && status >= 400) {
      if (!hasFailureCode) return null;
    } else if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.success === true && !hasFailureCode)) {
      return null;
    }
    return {
      code: 'E_BUSINESS',
      message: `${endpointName}: 平台返回业务错误`,
      hint: '物流接口返回业务错误，请稍后重试',
      exitCode: ExitCodes.BUSINESS,
    };
  };
}

function normalizeForwardTrack(raw) {
  const endpointName = 'logistics.forwardTrack';
  const result = unwrapTrackResult(raw, endpointName);
  if (result === null) {
    return { available: false, orderSn: null, wideGotTime: null, waybills: [], traces: [] };
  }

  const rawWaybills = result.waybillList === undefined
    ? []
    : assertObjectArray(result.waybillList, endpointName, 'result.waybillList array');
  const traceField = findTraceField(result, FORWARD_TRACE_KEYS);
  const rawTraces = traceField
    ? assertObjectArray(traceField.value, endpointName, `result.${traceField.key} array`)
    : [];

  const waybills = rawWaybills.map((waybill) => pickFields(waybill, FORWARD_WAYBILL_FIELDS));
  const traces = rawTraces.map((node) => pickFields(node, RAW_TRACE_NODE_FIELDS));
  const orderSn = optionalText(result.orderSn);
  const wideGotTime = result.wideGotTime ?? null;

  return {
    available: Boolean(orderSn || waybills.length > 0 || traces.length > 0 || wideGotTime != null),
    orderSn,
    wideGotTime,
    waybills,
    traces,
  };
}

function normalizeReverseTrack(raw) {
  const endpointName = 'logistics.reverseTrack';
  const result = unwrapTrackResult(raw, endpointName);
  if (result === null) {
    return {
      available: false, shippingId: null, shippingName: null, trackingNumber: null, wideGotTime: null, traces: [],
    };
  }

  const traceField = findTraceField(result, REVERSE_TRACE_KEYS);
  const rawTraces = traceField
    ? assertObjectArray(traceField.value, endpointName, `result.${traceField.key} array`)
    : [];

  const traces = rawTraces.map((node) => pickFields(node, RAW_TRACE_NODE_FIELDS));
  const rawShippingId = result.shippingId ?? result.shipping_id;
  const parsedShippingId = Number(rawShippingId);
  const shippingId = rawShippingId != null && rawShippingId !== '' && Number.isSafeInteger(parsedShippingId) && parsedShippingId >= 0
    ? parsedShippingId
    : null;
  const shippingName = optionalText(result.shippingName ?? result.shipping_name);
  const trackingNumber = optionalText(result.trackingNumber ?? result.tracking_number);
  const wideGotTime = result.wideGotTime ?? result.wide_got_time ?? null;

  return {
    available: Boolean(shippingId != null || shippingName || trackingNumber || traces.length > 0 || wideGotTime != null),
    shippingId,
    shippingName,
    trackingNumber,
    wideGotTime,
    traces,
  };
}

export const ORDER_FORWARD_TRACK = {
  name: 'logistics.forwardTrack',
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  apiUrl: '/artascope/express/track/query',
  method: 'POST',
  fixtureVariantKey: 'orderSn',
  buildPayload: ({ orderSn }) => ({
    orderSn: requireNonEmptyString(orderSn, 'orderSn', 'logistics.forwardTrack'),
    source: 'mms_order_detail',
    filterInvalidDefaultTrace: true,
  }),
  normalize: normalizeForwardTrack,
  redactRaw: redactLogisticsRaw(FORWARD_TRACE_KEYS),
  successRule: { mode: 'flag' },
  errorMapper: mapLogisticsBusinessError('logistics.forwardTrack'),
};

export const AFTER_SALES_REVERSE_TRACK = {
  name: 'logistics.reverseTrack',
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  method: 'GET',
  fixtureVariantKey: 'trackingNumber',
  apiUrl: ({ shippingId, trackingNumber } = {}) => {
    const sid = requireNonEmptyString(shippingId, 'shippingId', 'logistics.reverseTrack');
    const tracking = requireNonEmptyString(trackingNumber, 'trackingNumber', 'logistics.reverseTrack');
    const query = new URLSearchParams({ shippingId: sid, trackingNumber: tracking });
    return `/express_base/mms/track/sale_back?${query.toString()}`;
  },
  buildPayload: () => null,
  normalize: normalizeReverseTrack,
  redactRaw: redactLogisticsRaw(REVERSE_TRACE_KEYS),
  successRule: { mode: 'flag' },
  errorMapper: mapLogisticsBusinessError('logistics.reverseTrack'),
};
