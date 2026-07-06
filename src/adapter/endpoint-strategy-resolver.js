/**
 * Endpoint Strategy Resolver
 *
 * Resolves endpoint transport strategy from spec fields.
 *
 * Phase 1 (Current)
 * - Implicit inference only (backward compatible)
 * - Returns strategy based on buildPayload + apiUrl presence
 * - No explicit spec.strategy field support
 *
 * Phase 2 (Future)
 * - Add explicit spec.strategy field support
 * - Enable opt-in explicit strategy declarations
 * - Validate declared strategy matches inferred strategy
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
 * @returns {{ strategy: 'fetch'|'legacy', explicit: boolean, ambiguous: boolean }}
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

  if (hasBuildPayload && hasApiUrl) {
    return { strategy: 'fetch', explicit: false, ambiguous: false };
  }

  if (!hasBuildPayload && !hasApiUrl) {
    return { strategy: 'legacy', explicit: false, ambiguous: false };
  }

  return { strategy: 'legacy', explicit: false, ambiguous: true };
}
