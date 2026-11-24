import { PddCliError, ExitCodes } from '../infra/errors.js';

/**
 * Endpoint Strategy Resolver
 *
 * Resolves endpoint transport strategy from spec fields.
 *
 * Existing endpoints keep implicit fetch/legacy inference. `page-api` is explicit
 * because it bypasses navigation, route interception, triggers, and XHR collection.
 *
 * @example
 * import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
 *
 * const { strategy, ambiguous } = resolveEndpointStrategy(endpointSpec);
 * if (strategy === 'fetch') {
 *   // Use fetch-mode execution
 * } else {
 *   // Use legacy-mode execution
 * }
 */

/**
 * Resolve endpoint transport strategy from spec.
 *
 * @param {object} spec - Endpoint spec with fields like buildPayload, apiUrl, etc.
 * @returns {{ strategy: 'fetch'|'legacy'|'page-api', explicit: boolean, ambiguous: boolean }}
 *
 * @example
 * // Fetch mode (has both buildPayload + apiUrl)
 * resolveEndpointStrategy({ buildPayload: () => ({}), apiUrl: '/api/test' })
 * // => { strategy: 'fetch', explicit: false, ambiguous: false }
 *
 * @example
 * // Legacy mode (has neither)
 * resolveEndpointStrategy({ trigger: async () => {} })
 * // => { strategy: 'legacy', explicit: false, ambiguous: false }
 *
 * @example
 * // Ambiguous (has one but not both)
 * resolveEndpointStrategy({ buildPayload: () => ({}) })
 * // => { strategy: 'legacy', explicit: false, ambiguous: true }
 */
export function resolveEndpointStrategy(spec) {
  if (!spec || typeof spec !== 'object') {
    return { strategy: 'legacy', explicit: false, ambiguous: true };
  }

  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;
  const hasPageApiUrl = hasApiUrl || typeof spec.apiUrl === 'function';

  if (spec.strategy === 'page-api') {
    return {
      strategy: 'page-api',
      explicit: true,
      ambiguous: !(hasBuildPayload && hasPageApiUrl),
    };
  }

  if (hasBuildPayload && hasApiUrl) {
    return { strategy: 'fetch', explicit: false, ambiguous: false };
  }

  if (!hasBuildPayload && !hasApiUrl) {
    return { strategy: 'legacy', explicit: false, ambiguous: false };
  }

  return { strategy: 'legacy', explicit: false, ambiguous: true };
}

export function normalizePageApiMethod(method = 'POST') {
  if (typeof method !== 'string') return null;
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'POST' ? upper : null;
}

function isEmptyPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null)
    && Reflect.ownKeys(value).length === 0;
}

export function validatePageApiMethod(method = 'POST', endpoint = null) {
  const normalized = normalizePageApiMethod(method);
  if (!normalized) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: endpoint ? `${endpoint}: unsupported page-api HTTP method` : 'page-api: unsupported HTTP method',
      hint: 'page-api 端点仅支持 GET 或 POST 方法',
      detail: endpoint ? { endpoint, method } : { method },
      exitCode: ExitCodes.USAGE,
    });
  }
  return normalized;
}

export function validatePageApiPayload(method, payload, endpoint = null) {
  if (method !== 'GET') return;
  if (payload == null || isEmptyPlainObject(payload)) return;
  throw new PddCliError({
    code: 'E_USAGE',
    message: endpoint ? `${endpoint}: GET request does not accept a non-empty payload` : 'page-api: GET request does not accept a non-empty payload',
    hint: 'GET 端点仅接受 null、undefined 或空普通对象，请将参数编码到 apiUrl 或使用 POST',
    ...(endpoint ? { detail: { endpoint } } : {}),
    exitCode: ExitCodes.USAGE,
  });
}
