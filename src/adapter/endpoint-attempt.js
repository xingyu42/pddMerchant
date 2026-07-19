import { createCollector } from './xhr-collector.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { throwIfAborted, remainingMs } from '../infra/abort.js';
import { getLogger } from '../infra/logger.js';

/**
 * Shared lifecycle for a single endpoint attempt.
 *
 * Phases:
 *  1. Abort check
 *  2. Timeout calculation (clamped to ctx.deadlineAt)
 *  3. Transport preparation (fetch: route setup; legacy: no-op)
 *  4. XHR collector creation
 *  5. Navigation (with pageSession support)
 *  6. Optional readyEl wait
 *  7. Trigger execution
 *  8. Collector wait
 *  9. Transport cleanup (finally block)
 *
 * @param {object} config
 * @param {object} config.page - Playwright page
 * @param {object} config.meta - Endpoint spec
 * @param {object} config.params - Request params
 * @param {object} config.ctx - Execution context (signal, deadlineAt)
 * @param {object} config.log - Logger instance
 * @param {string} config.navUrl - Resolved navigation URL
 * @param {object|null} config.pageSession - Resolved page session (already includes client fallback)
 * @param {function} config.prepareTransport - Setup hook: async (page, meta, params, ctx) => void
 * @param {function} config.cleanupTransport - Cleanup hook: async (page, meta) => void
 * @param {function} config.runTrigger - Trigger executor: async (meta, page, params, ctx, log) => void
 * @returns {Promise<Response>} First XHR response matching urlPattern
 */
export async function executeAttempt({
  page,
  meta,
  params,
  ctx,
  log,
  navUrl,
  pageSession,
  prepareTransport,
  cleanupTransport,
  runTrigger,
}) {
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

  await prepareTransport(page, meta, params, ctx);

  const collector = createCollector(page, {
    pattern: meta.urlPattern,
    timeout: collectorTimeout,
    signal: ctx.signal,
  });

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

    await runTrigger(meta, page, params, ctx, log);

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
    await cleanupTransport(page, meta).catch((err) => {
      getLogger().debug({ err: err?.message, endpoint: meta?.name }, 'endpoint-attempt: cleanupTransport failed');
    });
  }
}
