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

  if (spec.strategy === 'page-api') {
    return {
      strategy: 'page-api',
      explicit: true,
      ambiguous: !(hasBuildPayload && hasApiUrl),
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
