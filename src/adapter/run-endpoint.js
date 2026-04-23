import { createCollector, parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes, mapErrorToExit } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { isMockEnabled, mockRunEndpoint } from './mock-dispatcher.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const SUCCESS_BUSINESS_CODES = new Set([0, 1000000]);

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
