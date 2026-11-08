import { createRateLimiter } from './rate-limiter.js';
import { PlaywrightEndpointClient } from './endpoint-client.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';

function missingRuntimeConfig(fields) {
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: 'Runtime configuration was not provided to the endpoint client',
    hint: 'Load config through the CLI runtime before creating shared adapters',
    detail: { source: 'runtime', reason: 'fields_missing', fields },
    exitCode: ExitCodes.GENERAL,
  });
}

const cooldownState = {
  map: new Map(),
  threshold: undefined,
  ms: undefined,
};

let _limiter = null;
let _client = null;
let _runtimeConfig = null;

function resolveRuntimeConfig(runtimeConfig, fields) {
  if (runtimeConfig) _runtimeConfig = runtimeConfig;
  const resolved = runtimeConfig ?? _runtimeConfig;
  const missing = fields.filter((field) => resolved?.[field] == null);
  if (missing.length > 0) throw missingRuntimeConfig(missing);
  return resolved;
}

function getSharedLimiter(runtimeConfig) {
  if (!_limiter) {
    const resolved = resolveRuntimeConfig(runtimeConfig, ['rateLimitQps', 'rateLimitBurst']);
    _limiter = createRateLimiter({
      qps: resolved.rateLimitQps,
      burst: resolved.rateLimitBurst,
    });
  }
  return _limiter;
}

export function getSharedClient(runtimeConfig) {
  if (!_client) {
    const resolved = resolveRuntimeConfig(runtimeConfig, ['cooldownThreshold', 'cooldownMs']);
    if (runtimeConfig || cooldownState.threshold == null) {
      cooldownState.threshold = resolved.cooldownThreshold;
    }
    if (runtimeConfig || cooldownState.ms == null) {
      cooldownState.ms = resolved.cooldownMs;
    }
    _client = new PlaywrightEndpointClient({
      limiter: getSharedLimiter(resolved),
      cooldownState,
    });
  }
  return _client;
}

export function _resetSharedClient() {
  cooldownState.map.clear();
  _limiter = null;
  _client = null;
}
