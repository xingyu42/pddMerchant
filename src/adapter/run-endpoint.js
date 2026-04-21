import { createCollector, parseBody } from './xhr-collector.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { isMockEnabled, mockRunEndpoint } from './mock-dispatcher.js';

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

  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR,
  });

  try {
    if (meta.nav?.url) {
      try {
        await page.goto(meta.nav.url, {
          waitUntil: meta.nav.waitUntil ?? 'domcontentloaded',
          timeout: meta.navTimeout ?? TIMEOUTS.QUICK_NAV,
        });
      } catch (err) {
        collector.dispose();
        throw new PddCliError({
          code: 'E_NETWORK',
          message: `runEndpoint(${meta.name}): navigation failed: ${err?.message}`,
          hint: '检查网络连通性或登录态',
          detail: { url: meta.nav.url },
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
  const response = responses[0];

  const raw = await parseBody(response);
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
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `runEndpoint(${meta.name}): business error`,
      hint: raw?.errorMsg || raw?.error_msg || '查看 detail.raw 字段',
      detail: {
        errorCode: raw?.errorCode,
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
  }, 'runEndpoint completed');

  return normalized;
}

export { TIMEOUTS };
