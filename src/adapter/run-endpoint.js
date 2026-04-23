import { createCollector, parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes, mapErrorToExit } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { isMockEnabled, mockRunEndpoint } from './mock-dispatcher.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const SUCCESS_BUSINESS_CODES = new Set([0, 1000000]);

const DEFAULT_COOLDOWN_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export const _RATE_LIMIT_CONFIG = {
  cooldownThreshold: Number(process.env.PDD_COOLDOWN_THRESHOLD) || DEFAULT_COOLDOWN_THRESHOLD,
  cooldownMs: Number(process.env.PDD_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS,
};

const rateLimitState = new Map();

export function _resetRateLimitState() {
  rateLimitState.clear();
}

export function _cooldownRemainingMs(name, now = Date.now()) {
  const state = rateLimitState.get(name);
  if (!state?.cooldownUntil) return 0;
  const remaining = state.cooldownUntil - now;
  if (remaining <= 0) {
    rateLimitState.delete(name);
    return 0;
  }
  return remaining;
}

export function _recordRateLimitFailure(name) {
  const prev = rateLimitState.get(name);
  const failures = (prev?.consecutiveFailures ?? 0) + 1;
  const state = { consecutiveFailures: failures, cooldownUntil: prev?.cooldownUntil ?? 0 };
  if (failures >= _RATE_LIMIT_CONFIG.cooldownThreshold) {
    state.cooldownUntil = Date.now() + _RATE_LIMIT_CONFIG.cooldownMs;
  }
  rateLimitState.set(name, state);
  return state;
}

export function _recordSuccess(name) {
  rateLimitState.delete(name);
}

export function readBusinessError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = raw.error_code ?? raw.errorCode;
  const msg = raw.error_msg ?? raw.errorMsg;
  if (code == null) return null;
  if (SUCCESS_BUSINESS_CODES.has(code)) return null;
  return { code: String(code), message: msg == null ? '' : String(msg) };
}

function resolveNavUrl(meta, params, ctx) {
  const raw = meta?.nav?.url;
  if (typeof raw === 'function') return raw(params, ctx);
  return raw;
}

function responseStatus(response) {
  if (!response) return null;
  try {
    const s = typeof response.status === 'function' ? response.status() : response.status;
    return typeof s === 'number' ? s : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exitCodeForMapped(mapped) {
  if (mapped.exitCode != null) return mapped.exitCode;
  return mapErrorToExit({ code: mapped.code });
}

async function attemptOnce(page, meta, params, ctx, log, navUrl) {
  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
  });

  try {
    if (navUrl) {
      try {
        await page.goto(navUrl, {
          waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
          timeout: meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
        });
      } catch (err) {
        collector.dispose();
        throw new PddCliError({
          code: 'E_NETWORK',
          message: `runEndpoint(${meta.name}): navigation failed: ${err?.message}`,
          hint: '检查网络连通性或登录态',
          detail: { url: navUrl },
          exitCode: ExitCodes.NETWORK,
        });
      }
    }

    if (meta.nav?.readyEl) {
      try {
        await page.waitForSelector(meta.nav.readyEl, { timeout: TIMEOUTS.ELEMENT_READY });
      } catch {
        log.debug({ endpoint: meta.name, readyEl: meta.nav.readyEl }, 'readyEl not found, continuing');
      }
    }

    if (typeof meta.trigger === 'function') {
      try {
        await meta.trigger(page, params, ctx);
      } catch (err) {
        if (meta.requiredTrigger) {
          collector.dispose();
          throw new PddCliError({
            code: 'E_GENERAL',
            message: `runEndpoint(${meta.name}): required trigger failed: ${err?.message}`,
            exitCode: ExitCodes.GENERAL,
          });
        }
        log.debug({ endpoint: meta.name, err: err?.message }, 'trigger failed, relying on auto-load XHR');
      }
    }
  } catch (err) {
    if (err instanceof PddCliError) throw err;
    collector.dispose();
    throw new PddCliError({
      code: 'E_GENERAL',
      message: `runEndpoint(${meta.name}): ${err?.message}`,
      exitCode: ExitCodes.GENERAL,
    });
  }

  const responses = await collector.waitFor();
  return responses[0];
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
  if (!meta.urlPattern) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `runEndpoint(${meta.name ?? '?'}): urlPattern is required`,
      exitCode: ExitCodes.USAGE,
    });
  }

  const log = getLogger();
  const startedAt = Date.now();

  // V0.2 #7: Cooldown gate — if this endpoint is cooling down from prior rate-limit storm,
  // short-circuit before any page.goto to save wall time (especially inside diagnose shop's
  // concurrent dimensions).
  const cooldownRemaining = _cooldownRemainingMs(meta.name);
  if (cooldownRemaining > 0) {
    throw new PddCliError({
      code: 'E_RATE_LIMIT',
      message: `runEndpoint(${meta.name}): in cooldown, ${Math.ceil(cooldownRemaining / 1000)}s remaining`,
      hint: `连续 ${_RATE_LIMIT_CONFIG.cooldownThreshold} 次限流触发 ${Math.round(_RATE_LIMIT_CONFIG.cooldownMs / 60000)} 分钟冷却期，已跳过请求；请稍后重试`,
      detail: {
        endpoint: meta.name,
        cooldown_remaining_ms: cooldownRemaining,
        cooldown_triggered: true,
      },
      exitCode: ExitCodes.RATE_LIMIT,
    });
  }

  try {
    const result = await _executeEndpoint(page, meta, params, ctx, log, startedAt);
    _recordSuccess(meta.name);
    return result;
  } catch (err) {
    if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
      const state = _recordRateLimitFailure(meta.name);
      if (state.cooldownUntil > 0) {
        err.detail = {
          ...(err.detail ?? {}),
          cooldown_triggered: true,
          cooldown_threshold: _RATE_LIMIT_CONFIG.cooldownThreshold,
          cooldown_ms: _RATE_LIMIT_CONFIG.cooldownMs,
          consecutive_failures: state.consecutiveFailures,
        };
        const cooldownMin = Math.round(_RATE_LIMIT_CONFIG.cooldownMs / 60000);
        err.hint = `连续 ${state.consecutiveFailures} 次限流，已触发 ${cooldownMin} 分钟冷却期；${err.hint ?? ''}`.trim();
      }
    }
    throw err;
  }
}

async function _executeEndpoint(page, meta, params, ctx, log, startedAt) {
  // D8: resolve nav.url exactly once per runEndpoint call (reused across 429 retries).
  let navUrl;
  try {
    navUrl = resolveNavUrl(meta, params, ctx);
  } catch (err) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `runEndpoint(${meta.name}): nav.url function threw: ${err?.message}`,
      exitCode: ExitCodes.USAGE,
    });
  }

  let attempt = 0;
  let response;

  // Retry loop for 429 (D11 exponential backoff). Total attempts = 1 + RETRY_DELAYS_MS.length.
  while (true) {
    response = await attemptOnce(page, meta, params, ctx, log, navUrl);
    const status = responseStatus(response);

    if (status === 429) {
      if (attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        log.debug({ endpoint: meta.name, attempt: attempt + 1, delay }, 'HTTP 429, backing off');
        attempt += 1;
        await sleep(delay);
        continue;
      }
      throw new PddCliError({
        code: 'E_RATE_LIMIT',
        message: `runEndpoint(${meta.name}): rate limited after ${RETRY_DELAYS_MS.length} retries`,
        hint: '请求过于频繁，请稍后重试',
        detail: { url: navUrl, status },
        exitCode: ExitCodes.RATE_LIMIT,
      });
    }

    if (status === 401 || status === 403) {
      throw new PddCliError({
        code: 'E_AUTH_EXPIRED',
        message: `runEndpoint(${meta.name}): auth expired (HTTP ${status})`,
        hint: '登录态失效，请重新登录',
        detail: { url: navUrl, status },
        exitCode: ExitCodes.AUTH,
      });
    }

    break;
  }

  const raw = await parseBody(response);
  const status = responseStatus(response);
  const isHttpError = status != null && status >= 400;

  // HTTP error branch — delegate to errorMapper even when body is empty/unparsable.
  if (isHttpError) {
    if (typeof meta.errorMapper === 'function') {
      const mapped = meta.errorMapper(raw, response);
      if (mapped && mapped.code) {
        throw new PddCliError({
          code: mapped.code,
          message: mapped.message || `runEndpoint(${meta.name}): HTTP ${status}`,
          detail: { url: navUrl, status, raw },
          exitCode: exitCodeForMapped(mapped),
        });
      }
    }
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `runEndpoint(${meta.name}): HTTP ${status}`,
      detail: { url: navUrl, status },
      exitCode: ExitCodes.NETWORK,
    });
  }

  if (raw == null) {
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `runEndpoint(${meta.name}): empty or unparsable response body`,
      hint: '可能被风控拦截，尝试重新登录',
      exitCode: ExitCodes.NETWORK,
    });
  }

  const ok = typeof meta.isSuccess === 'function' ? meta.isSuccess(raw) : true;
  if (!ok) {
    if (typeof meta.errorMapper === 'function') {
      const mapped = meta.errorMapper(raw, response);
      if (mapped && mapped.code) {
        throw new PddCliError({
          code: mapped.code,
          message: mapped.message || `runEndpoint(${meta.name}): business error`,
          hint: raw?.errorMsg || raw?.error_msg || '',
          detail: { errorCode: raw?.errorCode ?? raw?.error_code, raw },
          exitCode: exitCodeForMapped(mapped),
        });
      }
    }
    const businessErr = readBusinessError(raw);
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: businessErr?.message
        ? `runEndpoint(${meta.name}): ${businessErr.message}`
        : `runEndpoint(${meta.name}): business error`,
      hint: raw?.errorMsg || raw?.error_msg || '查看 detail.raw 字段',
      detail: {
        errorCode: raw?.errorCode ?? raw?.error_code,
        errorMsg: raw?.errorMsg ?? raw?.error_msg,
        raw,
      },
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const normalized = typeof meta.normalize === 'function' ? meta.normalize(raw) : { raw };
  log.debug({
    endpoint: meta.name,
    latency_ms: Date.now() - startedAt,
    attempts: attempt + 1,
  }, 'runEndpoint completed');

  return normalized;
}

export { TIMEOUTS };
