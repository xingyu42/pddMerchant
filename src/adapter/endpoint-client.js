import { createCollector, parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes, mapErrorToExit } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { classifyRateLimit } from './classify-rate-limit.js';
import { throwIfAborted, remainingMs, abortableSleep } from '../infra/abort.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];
export const SUCCESS_BUSINESS_CODES = new Set([0, 1000000]);

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

function resolveNavUrl(meta, params, ctx) {
  const raw = meta?.nav?.url;
  if (typeof raw === 'function') return raw(params, ctx);
  return raw;
}

export function readBusinessError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = raw.error_code ?? raw.errorCode;
  const msg = raw.error_msg ?? raw.errorMsg;
  if (code == null) return null;
  if (SUCCESS_BUSINESS_CODES.has(code)) return null;
  return { code: String(code), message: msg == null ? '' : String(msg) };
}

export class PlaywrightEndpointClient {
  constructor({ limiter, cooldownState, pageSession } = {}) {
    this._limiter = limiter;
    this._cooldownState = cooldownState ?? { map: new Map(), threshold: 3, ms: 5 * 60 * 1000 };
    this._pageSession = pageSession;
  }

  async execute(spec, params = {}, ctx = {}) {
    const meta = spec;
    const page = ctx.page;
    const log = ctx.log ?? getLogger();

    if (!page || !meta) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: 'EndpointClient.execute: page and spec are required',
        exitCode: ExitCodes.USAGE,
      });
    }

    const startedAt = Date.now();

    const cooldownRemaining = this._cooldownRemainingMs(meta.name);
    if (cooldownRemaining > 0) {
      throw new PddCliError({
        code: 'E_RATE_LIMIT',
        message: `${meta.name}: in cooldown, ${Math.ceil(cooldownRemaining / 1000)}s remaining`,
        hint: `连续限流触发冷却期，已跳过请求；请稍后重试`,
        detail: { endpoint: meta.name, cooldown_remaining_ms: cooldownRemaining, cooldown_triggered: true },
        exitCode: ExitCodes.RATE_LIMIT,
      });
    }

    let limiterWaitMs = 0;
    if (this._limiter) {
      const { waitMs } = await this._limiter.acquire(meta.name);
      limiterWaitMs = waitMs;
    }

    try {
      const result = await this._executeWithRetry(page, meta, params, ctx, log, startedAt);
      this._recordSuccess(meta.name);
      return {
        data: result,
        meta: {
          attempt: 1,
          limiter_wait_ms: limiterWaitMs,
          endpoint: meta.name,
          correlation_id: ctx.correlation_id,
        },
      };
    } catch (err) {
      if (err instanceof PddCliError && err.code === 'E_RATE_LIMIT') {
        this._recordRateLimitFailure(meta.name);
      }
      throw err;
    }
  }

  _cooldownRemainingMs(name, now = Date.now()) {
    const state = this._cooldownState.map.get(name);
    if (!state?.cooldownUntil) return 0;
    const remaining = state.cooldownUntil - now;
    if (remaining <= 0) {
      this._cooldownState.map.delete(name);
      return 0;
    }
    return remaining;
  }

  _recordRateLimitFailure(name) {
    const prev = this._cooldownState.map.get(name);
    const failures = (prev?.consecutiveFailures ?? 0) + 1;
    const state = { consecutiveFailures: failures, cooldownUntil: prev?.cooldownUntil ?? 0 };
    if (failures >= this._cooldownState.threshold) {
      state.cooldownUntil = Date.now() + this._cooldownState.ms;
    }
    this._cooldownState.map.set(name, state);
    return state;
  }

  _recordSuccess(name) {
    this._cooldownState.map.delete(name);
  }

  async _executeWithRetry(page, meta, params, ctx, log, startedAt) {
    let navUrl;
    try {
      navUrl = resolveNavUrl(meta, params, ctx);
    } catch (err) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `${meta.name}: nav.url function threw: ${err?.message}`,
        exitCode: ExitCodes.USAGE,
      });
    }

    let attempt = 0;

    while (true) {
      throwIfAborted(ctx.signal);
      const response = await this._attemptOnce(page, meta, params, ctx, log, navUrl);
      const status = responseStatus(response);

      if (status === 429) {
        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          log.debug({ endpoint: meta.name, attempt: attempt + 1, delay }, 'HTTP 429, backing off');
          attempt += 1;
          await abortableSleep(delay, ctx.signal);
          continue;
        }
        throw new PddCliError({
          code: 'E_RATE_LIMIT',
          message: `${meta.name}: rate limited after ${RETRY_DELAYS_MS.length} retries`,
          hint: '请求过于频繁，请稍后重试',
          detail: { url: navUrl, status },
          exitCode: ExitCodes.RATE_LIMIT,
        });
      }

      if (status === 401 || status === 403) {
        throw new PddCliError({
          code: 'E_AUTH_EXPIRED',
          message: `${meta.name}: auth expired (HTTP ${status})`,
          hint: '登录态失效，请重新登录',
          detail: { url: navUrl, status },
          exitCode: ExitCodes.AUTH,
        });
      }

      const raw = await parseBody(response);
      const isHttpError = status != null && status >= 400;

      if (isHttpError) {
        if (typeof meta.errorMapper === 'function') {
          const mapped = meta.errorMapper(raw, response);
          if (mapped && mapped.code) {
            throw new PddCliError({
              code: mapped.code,
              message: mapped.message || `${meta.name}: HTTP ${status}`,
              detail: { url: navUrl, status, raw },
              exitCode: mapped.exitCode ?? mapErrorToExit({ code: mapped.code }),
            });
          }
        }
        throw new PddCliError({
          code: 'E_NETWORK',
          message: `${meta.name}: HTTP ${status}`,
          detail: { url: navUrl, status },
          exitCode: ExitCodes.NETWORK,
        });
      }

      if (raw == null) {
        throw new PddCliError({
          code: 'E_NETWORK',
          message: `${meta.name}: empty or unparsable response body`,
          hint: '可能被风控拦截，尝试重新登录',
          exitCode: ExitCodes.NETWORK,
        });
      }

      const rateLimitClass = classifyRateLimit(raw, response);
      if (rateLimitClass) {
        throw new PddCliError({
          code: 'E_RATE_LIMIT',
          message: `${meta.name}: rate limit detected (${rateLimitClass})`,
          hint: '请求过于频繁，请稍后重试',
          detail: { classification: rateLimitClass, raw },
          exitCode: ExitCodes.RATE_LIMIT,
        });
      }

      const ok = typeof meta.isSuccess === 'function' ? meta.isSuccess(raw) : true;
      if (!ok) {
        if (typeof meta.errorMapper === 'function') {
          const mapped = meta.errorMapper(raw, response);
          if (mapped && mapped.code) {
            throw new PddCliError({
              code: mapped.code,
              message: mapped.message || `${meta.name}: business error`,
              hint: raw?.errorMsg || raw?.error_msg || '',
              detail: { errorCode: raw?.errorCode ?? raw?.error_code, raw },
              exitCode: mapped.exitCode ?? mapErrorToExit({ code: mapped.code }),
            });
          }
        }
        const businessErr = readBusinessError(raw);
        throw new PddCliError({
          code: 'E_BUSINESS',
          message: businessErr?.message
            ? `${meta.name}: ${businessErr.message}`
            : `${meta.name}: business error`,
          hint: raw?.errorMsg || raw?.error_msg || '查看 detail.raw 字段',
          detail: { errorCode: raw?.errorCode ?? raw?.error_code, raw },
          exitCode: ExitCodes.BUSINESS,
        });
      }

      const normalized = typeof meta.normalize === 'function' ? meta.normalize(raw) : { raw };
      log.debug({
        endpoint: meta.name,
        latency_ms: Date.now() - startedAt,
        attempts: attempt + 1,
      }, 'endpoint completed');

      return normalized;
    }
  }

  async _attemptOnce(page, meta, params, ctx, log, navUrl) {
    const hasFetchPath = typeof meta.buildPayload === 'function' && meta.apiUrl;
    if (hasFetchPath) {
      return this._attemptFetch(page, meta, params, ctx, log, navUrl);
    }
    return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
  }

  async _attemptFetch(page, meta, params, ctx, log, navUrl) {
    throwIfAborted(ctx.signal);
    const remaining = remainingMs(ctx);
    const navTimeout = Math.min(
      meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
      remaining === 0 ? 1 : (remaining || Infinity),
    );
    const collectorTimeout = Math.min(
      meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
      remaining === 0 ? 1 : (remaining || Infinity),
    );

    const payload = meta.buildPayload(params, ctx);
    const routeHandler = async (route) => {
      await route.continue({ postData: JSON.stringify(payload) });
    };
    await page.route(meta.urlPattern, routeHandler);

    const collector = createCollector(page, {
      pattern: meta.urlPattern,
      timeout: collectorTimeout,
      signal: ctx.signal,
    });

    try {
      if (navUrl) {
        const pageSession = ctx.pageSession ?? this._pageSession;
        if (pageSession) {
          await pageSession.goto(page, navUrl, {
            waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
            timeout: navTimeout,
          });
        } else {
          await page.goto(navUrl, {
            waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
            timeout: navTimeout,
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

      const responses = await collector.waitFor();
      return responses[0];
    } catch (err) {
      collector.dispose();
      if (err instanceof PddCliError) throw err;
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: navigation failed: ${err?.message}`,
        hint: '检查网络连通性或登录态',
        detail: { url: navUrl },
        exitCode: ExitCodes.NETWORK,
      });
    } finally {
      await page.unroute(meta.urlPattern, routeHandler).catch(() => {});
    }
  }

  async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
    throwIfAborted(ctx.signal);
    const remaining = remainingMs(ctx);
    const collectorTimeout = Math.min(
      meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
      remaining === 0 ? 1 : (remaining || Infinity),
    );
    const collector = createCollector(page, {
      pattern: meta.urlPattern,
      timeout: collectorTimeout,
      signal: ctx.signal,
    });

    const pageSession = ctx.pageSession ?? this._pageSession;
    const navTimeout = Math.min(
      meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
      remaining === 0 ? 1 : (remaining || Infinity),
    );

    try {
      if (navUrl) {
        if (pageSession) {
          await pageSession.goto(page, navUrl, {
            waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
            timeout: navTimeout,
          });
        } else {
          await page.goto(navUrl, {
            waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
            timeout: navTimeout,
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
              message: `${meta.name}: required trigger failed: ${err?.message}`,
              exitCode: ExitCodes.GENERAL,
            });
          }
          log.debug({ endpoint: meta.name, err: err?.message }, 'trigger failed, relying on auto-load XHR');
        }
      }
    } catch (err) {
      collector.dispose();
      if (err instanceof PddCliError) throw err;
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: navigation failed: ${err?.message}`,
        hint: '检查网络连通性或登录态',
        detail: { url: navUrl },
        exitCode: ExitCodes.NETWORK,
      });
    }

    const responses = await collector.waitFor();
    return responses[0];
  }
}
