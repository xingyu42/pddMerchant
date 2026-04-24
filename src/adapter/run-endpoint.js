import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { isMockEnabled, mockRunEndpoint } from './mock-dispatcher.js';
import { getSharedClient, _resetSharedClient, _cooldownConfig } from './rate-limiter-singleton.js';

const SUCCESS_BUSINESS_CODES = new Set([0, 1000000]);

export function readBusinessError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = raw.error_code ?? raw.errorCode;
  const msg = raw.error_msg ?? raw.errorMsg;
  if (code == null) return null;
  if (SUCCESS_BUSINESS_CODES.has(code)) return null;
  return { code: String(code), message: msg == null ? '' : String(msg) };
}

export async function runEndpoint(page, meta, params = {}, ctx = {}) {
  if (isMockEnabled()) return mockRunEndpoint(meta, params, ctx);

  if (!page || !meta) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'runEndpoint: page and meta are required',
      exitCode: ExitCodes.USAGE,
    });
  }

  const client = getSharedClient();
  const { data } = await client.execute(meta, params, {
    ...ctx,
    page,
    log: ctx.log ?? getLogger(),
  });
  return data;
}

export function _resetRateLimitState() {
  _resetSharedClient();
}

export function _cooldownRemainingMs(name, now) {
  return getSharedClient()._cooldownRemainingMs(name, now);
}

export function _recordRateLimitFailure(name) {
  return getSharedClient()._recordRateLimitFailure(name);
}

export function _recordSuccess(name) {
  return getSharedClient()._recordSuccess(name);
}

export const _RATE_LIMIT_CONFIG = Object.defineProperties({}, {
  cooldownThreshold: {
    enumerable: true,
    get() { return _cooldownConfig.threshold; },
    set(v) { _cooldownConfig.threshold = v; },
  },
  cooldownMs: {
    enumerable: true,
    get() { return _cooldownConfig.ms; },
    set(v) { _cooldownConfig.ms = v; },
  },
});

export { TIMEOUTS };
