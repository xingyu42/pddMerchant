import { createCollector } from './xhr-collector.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { throwIfAborted, remainingMs, timeoutError } from '../infra/abort.js';
import { getLogger } from '../infra/logger.js';

const noopAsync = async () => {};

function isSameOrigin(page, navUrl) {
  try {
    const currentUrl = typeof page.url === 'function' ? page.url() : page.url;
    return new URL(currentUrl).origin === new URL(navUrl).origin;
  } catch {
    return false;
  }
}

async function gotoWithSignal(page, navUrl, gotoOptions, signal) {
  throwIfAborted(signal);
  const navigation = Promise.resolve(page.goto(navUrl, gotoOptions));
  if (!signal) return navigation;

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(timeoutError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  navigation.catch(() => {});
  try {
    return await Promise.race([navigation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function rethrowOrWrapNavigationError(err, endpoint, navUrl, ctx) {
  if (err instanceof PddCliError) throw err;
  throwIfAborted(ctx?.signal);
  if (remainingMs(ctx) === 0) throw timeoutError();
  throw new PddCliError({
    code: 'E_NETWORK',
    message: `${endpoint}: navigation failed: ${err?.message}`,
    hint: '检查网络连通性或登录态',
    detail: { url: navUrl },
    exitCode: ExitCodes.NETWORK,
  });
}

/**
 * Navigate a page to `navUrl` with remaining-budget clamping, AbortSignal
 * propagation, and unified `E_NETWORK` wrapping.
 *
 * @param {object} page - Playwright page
 * @param {string|undefined} navUrl - Target navigation URL
 * @param {object} meta - Endpoint spec (name, nav, navTimeout)
 * @param {object} ctx - Execution context (signal, deadlineAt, clock)
 * @param {object} [options]
 * @param {boolean} [options.skipIfSameOrigin=false] - Skip goto when page origin matches navUrl
 * @returns {Promise<boolean>} Whether navigation was executed
 */
export async function navigatePageWithBudget(page, navUrl, meta, ctx = {}, { skipIfSameOrigin = false } = {}) {
  if (!navUrl) return false;
  throwIfAborted(ctx?.signal);
  const remaining = remainingMs(ctx);
  if (remaining === 0) throw timeoutError();
  if (skipIfSameOrigin && isSameOrigin(page, navUrl)) return false;

  const endpoint = meta?.name ?? 'endpoint';
  const timeout = Math.min(meta?.navTimeout ?? TIMEOUTS.QUICK_NAV, remaining);
  try {
    await gotoWithSignal(page, navUrl, {
      waitUntil: meta?.nav?.waitUntil ?? 'domcontentloaded',
      timeout,
    }, ctx?.signal);
    return true;
  } catch (err) {
    rethrowOrWrapNavigationError(err, endpoint, navUrl, ctx);
  }
}

async function runTrigger(meta, page, params, ctx, log) {
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

async function waitForReadyElement(page, meta, ctx, log) {
  if (!meta.nav?.readyEl) return;
  const readyBudget = remainingMs(ctx);
  if (readyBudget === 0) throw timeoutError();
  try {
    await page.waitForSelector(meta.nav.readyEl, {
      timeout: Math.min(TIMEOUTS.ELEMENT_READY, readyBudget),
    });
  } catch {
    throwIfAborted(ctx.signal);
    if (remainingMs(ctx) === 0) throw timeoutError();
    log.debug({ endpoint: meta.name, readyEl: meta.nav.readyEl }, 'readyEl not found, continuing');
  }
}

/**
 * Shared lifecycle for a single fetch/legacy endpoint attempt.
 *
 * @param {object} options
 * @param {object} options.meta - Endpoint spec
 * @param {object} [options.params={}] - Request params
 * @param {object} [options.ctx={}] - Execution context (page, log, navUrl, pageSession, signal, deadlineAt)
 * @param {object} [options.transport={}] - Grouped transport hooks ({ prepare, cleanup, trigger })
 * @returns {Promise<Response>} First XHR response matching urlPattern
 */
export async function executeAttempt({
  meta,
  params = {},
  ctx = {},
  transport = {},
}) {
  const page = ctx.page;
  const log = ctx.log ?? getLogger();
  const navUrl = ctx.navUrl;
  const pageSession = ctx.pageSession ?? null;
  const prepareTransport = transport.prepare ?? noopAsync;
  const cleanupTransport = transport.cleanup ?? noopAsync;
  const triggerRunner = transport.trigger ?? runTrigger;

  throwIfAborted(ctx.signal);

  const remaining = remainingMs(ctx);
  if (remaining === 0) throw timeoutError();
  const collectorTimeout = Math.min(meta.collectorTimeout ?? TIMEOUTS.XHR_COLLECTOR, remaining);

  const usesSelectedPage = Boolean(
    navUrl
    && typeof pageSession?.selectPage === 'function'
    && typeof pageSession?.recordNavigation === 'function',
  );
  const attemptPage = usesSelectedPage ? await pageSession.selectPage(page, navUrl) : page;

  let collector = null;
  try {
    await prepareTransport(attemptPage, meta, params, ctx);
    collector = createCollector(attemptPage, {
      pattern: meta.urlPattern,
      timeout: collectorTimeout,
      signal: ctx.signal,
    });
    if (await navigatePageWithBudget(attemptPage, navUrl, meta, ctx)) {
      if (usesSelectedPage) pageSession.recordNavigation(attemptPage, navUrl);
    }
    await waitForReadyElement(attemptPage, meta, ctx, log);
    await triggerRunner(meta, attemptPage, params, ctx, log);
    const responses = await collector.waitFor();
    return responses[0];
  } catch (err) {
    collector?.dispose();
    rethrowOrWrapNavigationError(err, meta?.name ?? 'endpoint', navUrl, ctx);
  } finally {
    await cleanupTransport(attemptPage, meta).catch((err) => {
      log.debug({ err: err?.message, endpoint: meta?.name }, 'endpoint-attempt: cleanupTransport failed');
    });
  }
}
