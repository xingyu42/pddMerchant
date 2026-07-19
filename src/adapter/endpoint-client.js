import { parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes, mapErrorToExit } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { classifyRateLimit } from './classify-rate-limit.js';
import { throwIfAborted, abortableSleep } from '../infra/abort.js';
import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
import { executeAttempt } from './endpoint-attempt.js';

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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(origPayload, payload) {
  const merged = { ...origPayload };
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = mergePlainObjects(merged[key], value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

// 超集合并：保留页面 JS 生成的请求体（含 crawlerInfo / Anti-Content 等风控签名），
// buildPayload 的业务字段覆盖页面同名字段；嵌套纯对象递归合并以保留 queryRange
// 等容器内的页面签名字段。非 JSON body（如 multipart）回退到整替模式。
// 参考 src/adapter/goods-publish/form-filler.js 的已验证模式。
export function mergePayload(origPostData, payload) {
  if (!origPostData) return payload;
  try {
    const origPayload = JSON.parse(origPostData);
    if (isPlainObject(origPayload)) {
      return mergePlainObjects(origPayload, payload);
    }
  } catch {
    // 非 JSON body，维持整替模式
  }
  return payload;
}

export class PlaywrightEndpointClient {
  constructor({ limiter, cooldownState, pageSession } = {}) {
    this._limiter = limiter;
    this._cooldownState = cooldownState ?? { map: new Map(), threshold: undefined, ms: undefined };
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
      const { normalized, attempts } = await this._executeWithRetry(page, meta, params, ctx, log, startedAt);
      this._recordSuccess(meta.name);
      return {
        data: normalized,
        meta: {
          attempt: attempts,
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
    if (!Number.isInteger(this._cooldownState.threshold) || this._cooldownState.threshold <= 0
      || !Number.isFinite(this._cooldownState.ms) || this._cooldownState.ms <= 0) {
      throw new PddCliError({
        code: 'E_CONFIG_INVALID',
        message: 'Endpoint cooldown runtime configuration is missing',
        detail: { source: 'runtime', reason: 'fields_missing', fields: ['cooldownThreshold', 'cooldownMs'] },
        exitCode: ExitCodes.GENERAL,
      });
    }
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
          detail: { endpoint: meta.name, url: navUrl, status },
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
          detail: { endpoint: meta.name, classification: rateLimitClass, raw },
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
          hint: raw?.errorMsg || raw?.error_msg || '设 PDD_DEBUG_RAW=1 查看脱敏后的原始响应',
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

      return { normalized, attempts: attempt + 1 };
    }
  }

  async _runTrigger(meta, page, params, ctx, log) {
    if (typeof meta.trigger !== 'function') return;
    try {
      await meta.trigger(page, params, ctx);
    } catch (err) {
      if (meta.requiredTrigger) {
        throw new PddCliError({
          code: 'E_GENERAL',
          message: `${meta.name}: required trigger failed: ${err?.message}`,
          exitCode: ExitCodes.GENERAL,
        });
      }
      log.debug({ endpoint: meta.name, err: err?.message }, 'trigger failed, relying on auto-load XHR');
    }
  }

  async _attemptOnce(page, meta, params, ctx, log, navUrl) {
    const { strategy } = resolveEndpointStrategy(meta);
    if (strategy === 'fetch') {
      return this._attemptFetch(page, meta, params, ctx, log, navUrl);
    }
    return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
  }

  async _attemptFetch(page, meta, params, ctx, log, navUrl) {
    const payload = meta.buildPayload(params, ctx);
    let routeHandler;

    return executeAttempt({
      page,
      meta,
      params,
      ctx,
      log,
      navUrl,
      pageSession: ctx.pageSession ?? this._pageSession,
      prepareTransport: async (pg) => {
        routeHandler = async (route) => {
          const origPostData = route.request().postData();
          const merged = mergePayload(origPostData, payload);
          await route.continue({ postData: JSON.stringify(merged) });
        };
        await pg.route(meta.urlPattern, routeHandler);
      },
      cleanupTransport: async (pg) => {
        if (routeHandler) {
          await pg.unroute(meta.urlPattern, routeHandler).catch((err) => {
            log.debug({ err: err?.message, endpoint: meta?.name }, 'endpoint-client: unroute failed');
          });
        }
      },
      runTrigger: this._runTrigger.bind(this),
    });
  }

  async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
    return executeAttempt({
      page,
      meta,
      params,
      ctx,
      log,
      navUrl,
      pageSession: ctx.pageSession ?? this._pageSession,
      prepareTransport: async () => {},
      cleanupTransport: async () => {},
      runTrigger: this._runTrigger.bind(this),
    });
  }
}
