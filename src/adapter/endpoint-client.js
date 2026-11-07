import { parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { interpretResponse } from './response-interpreter.js';
import { readResponseStatus } from './classify-rate-limit.js';
import { isMockEnabled, mockRunEndpoint } from './mock-dispatcher.js';
import {
  throwIfAborted,
  abortableSleep,
  remainingMs,
  timeoutError,
} from '../infra/abort.js';
import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
import { executeAttempt } from './endpoint-attempt.js';
import { executePageApiRequest } from './page-api-client.js';
import { TIMEOUTS } from '../infra/timeouts.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

function resolveNavUrl(meta, params, ctx) {
  try {
    const raw = meta?.nav?.url;
    return typeof raw === 'function' ? raw(params, ctx) : raw;
  } catch (error) {
    throw new PddCliError({
      code: 'E_USAGE', message: `${meta.name}: nav.url function threw: ${error?.message}`,
      exitCode: ExitCodes.USAGE,
    });
  }
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

    if ((!page && !isMockEnabled()) || !meta) {
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
    if (this._limiter && !isMockEnabled()) {
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

  // 传输只提供 HTTP 状态和上游响应体，fixture 与浏览器共用后续判定、归一化和冷却记账。
  async send(spec, params, ctx) {
    if (isMockEnabled()) {
      const raw = await mockRunEndpoint(spec, params);
      return { status: 200, raw, response: { status: () => 200 } };
    }
    const response = await this._attemptOnce(ctx.page, spec, params, ctx, ctx.log, ctx.navUrl);
    const status = readResponseStatus(response);
    const raw = [401, 403, 429].includes(status) ? null : await parseBody(response);
    return { status, raw, response };
  }

  async _executeWithRetry(page, meta, params, ctx, log, startedAt) {
    const navUrl = resolveNavUrl(meta, params, ctx);
    let attempt = 0;
    while (true) {
      throwIfAborted(ctx.signal);
      const { status, raw, response } = await this.send(meta, params, { ...ctx, page, log, navUrl });
      if (status === 429 && attempt < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[attempt];
        log.debug({ endpoint: meta.name, attempt: attempt + 1, delay }, 'HTTP 429, backing off');
        attempt += 1;
        await abortableSleep(delay, ctx.signal);
        continue;
      }
      const normalized = interpretResponse(meta, { status, raw, response, url: navUrl, retries: attempt });
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
    if (strategy === 'page-api') {
      return this._attemptPageApi(page, meta, params, ctx, navUrl);
    }
    if (strategy === 'fetch') {
      return this._attemptFetch(page, meta, params, ctx, log, navUrl);
    }
    return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
  }

  async _preparePageApi(page, meta, ctx, navUrl) {
    if (!navUrl) return;
    throwIfAborted(ctx.signal);
    const remaining = remainingMs(ctx);
    if (remaining === 0) throw timeoutError();

    try {
      const currentUrl = typeof page.url === 'function' ? page.url() : page.url;
      if (new URL(currentUrl).origin === new URL(navUrl).origin) return;
    } catch {
      // Fresh pages have no merchant runtime; initialize the supplied page in place.
    }

    try {
      await page.goto(navUrl, {
        waitUntil: meta.nav?.waitUntil ?? 'domcontentloaded',
        timeout: Math.min(meta.navTimeout ?? TIMEOUTS.QUICK_NAV, remaining),
      });
    } catch (err) {
      if (err instanceof PddCliError) throw err;
      throwIfAborted(ctx.signal);
      if (remainingMs(ctx) === 0) throw timeoutError();
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: navigation failed: ${err?.message}`,
        hint: '检查网络连通性或登录态',
        detail: { url: navUrl },
        exitCode: ExitCodes.NETWORK,
      });
    }
  }

  async _attemptPageApi(page, meta, params, ctx, navUrl) {
    const missingFields = [];
    if (typeof meta.buildPayload !== 'function') missingFields.push('buildPayload');
    if (typeof meta.apiUrl !== 'string' || meta.apiUrl.length === 0) missingFields.push('apiUrl');
    if (missingFields.length > 0) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `${meta.name}: invalid page-api endpoint spec`,
        hint: `缺少或无效字段: ${missingFields.join(', ')}`,
        detail: { endpoint: meta.name, fields: missingFields },
        exitCode: ExitCodes.USAGE,
      });
    }
    const payload = meta.buildPayload(params, ctx);
    await this._preparePageApi(page, meta, ctx, navUrl);
    throwIfAborted(ctx.signal);
    const requestBudgetMs = remainingMs(ctx);
    if (requestBudgetMs === 0) throw timeoutError();

    let result;
    try {
      result = await executePageApiRequest(
        page,
        { apiUrl: meta.apiUrl, payload },
        { signal: ctx.signal, timeoutMs: requestBudgetMs },
      );
    } catch (err) {
      if (err instanceof PddCliError) throw err;
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: page API execution failed: ${err?.message ?? 'unknown error'}`,
        hint: '页面执行上下文或网络请求失败；请重试并检查登录态与网络连通性',
        detail: { endpoint: meta.name },
        exitCode: ExitCodes.NETWORK,
      });
    }
    if (result.unavailable) {
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: page API client unavailable`,
        hint: '页面运行时或签名客户端未在等待窗口内就绪；可重试，持续失败时请升级 CLI',
        detail: { endpoint: meta.name, reason: result.reason },
        exitCode: ExitCodes.NETWORK,
      });
    }
    if (result.transportError) {
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `${meta.name}: page API transport failed`,
        hint: '页面请求客户端未返回业务错误码；请重试并检查登录态与网络连通性',
        detail: { endpoint: meta.name, status: result.status, reason: result.message },
        exitCode: ExitCodes.NETWORK,
      });
    }
    let responseUrl = meta.apiUrl;
    try {
      const baseUrl = typeof page.url === 'function' ? page.url() : page.url;
      responseUrl = new URL(meta.apiUrl, baseUrl).href;
    } catch {
      // Relative apiUrl is still useful to error mappers when page.url is unavailable.
    }
    return {
      status: () => result.status,
      ok: () => result.status >= 200 && result.status < 300,
      url: () => responseUrl,
      headers: () => ({ 'content-type': 'application/json' }),
      json: async () => result.raw,
      text: async () => JSON.stringify(result.raw),
    };
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
