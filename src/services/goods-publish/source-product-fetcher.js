import { browserRuntimeError } from '../../adapter/browser-validation.js';
import { deleteAuthState, loadAuthState } from '../../adapter/auth-state.js';
import {
  acquireQingguoProxyLease,
  readSourceProxyConfig,
} from '../../adapter/goods-publish/qingguo-proxy.js';
import { observeSourceGoodsPage } from '../../adapter/goods-publish/source-scraper.js';
import { abortableSleep, throwIfAborted } from '../../infra/abort.js';
import { resolveConsumerAccountContext } from '../../infra/consumer-account-resolver.js';
import { ExitCodes, PddCliError, softRiskControlDetected } from '../../infra/errors.js';
import { getLogger } from '../../infra/logger.js';
import { appendUniqueWarnings } from '../../infra/output.js';
import { defaultSourceGoodsCache } from '../goods-publish-source-cache.js';
import {
  buildEmptyShellError,
  classifySourceObservation,
  parseGoodsUrl,
  scoreSourceObservation,
} from './source-normalizer.js';

const SOURCE_PROXY_MAX_ATTEMPTS = 3;
const SOURCE_PROXY_RETRY_DELAYS = [500, 1000];

function isRetryableProxyAttemptError(err) {
  return err?.code === 'E_PROXY_UNAVAILABLE' || err?.code === 'E_PROXY_NETWORK';
}

function mapProxyBrowserError(err) {
  if (err instanceof PddCliError) return err;
  const text = `${err?.name ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`;
  // Chromium surfaces upstream HTTP 407 as ERR_TUNNEL_CONNECTION_FAILED for
  // IP-whitelist proxies; rotating leases cannot repair auth failures.
  if (/407|proxy.*auth|ERR_PROXY_AUTH_REQUESTED|ERR_INVALID_AUTH_CREDENTIALS|ERR_TUNNEL_CONNECTION_FAILED/i.test(text)) {
    return new PddCliError({
      code: 'E_PROXY_AUTH',
      message: '青果代理连接认证失败',
      hint: '当前未启用代理账号密码鉴权，请确认青果套餐或节点是否要求额外鉴权',
      detail: { provider: 'qingguo' },
      exitCode: ExitCodes.AUTH,
    });
  }
  if (/TimeoutError|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ERR_(PROXY|TUNNEL|CONNECTION|TIMED_OUT)|net::ERR_/i.test(text)) {
    return new PddCliError({
      code: 'E_PROXY_NETWORK',
      message: '青果代理连接超时、拒绝或提前断开',
      hint: '系统会在重试预算内更换短效代理；不会自动回退直连',
      detail: { provider: 'qingguo' },
      exitCode: ExitCodes.NETWORK,
    });
  }
  return new PddCliError({
    code: 'E_GENERAL',
    message: '源商品代理抓取发生未分类错误',
    hint: '查看脱敏 verbose 日志定位问题；为避免泄露代理节点，原始错误不会写入普通输出',
    detail: { provider: 'qingguo' },
    exitCode: ExitCodes.GENERAL,
  });
}

function proxyLeaseSummary(lease, attempt, now) {
  return {
    provider: lease.provider,
    attempt,
    area: lease.area,
    isp: lease.isp,
    remaining_ms: Math.max(0, lease.expiresAt - now()),
    request_id_hash: lease.requestIdHash,
  };
}

function scoreCandidateForObserver(candidate) {
  const { snapshot, score } = scoreSourceObservation(candidate);
  return { complete: snapshot.complete, score };
}

async function readCachedSource(sourceCache, goodsId, log) {
  try {
    const source = await sourceCache.read(goodsId);
    if (source) log.info({ goodsId }, 'goods-publish: source cache hit');
    return source;
  } catch (error) {
    log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache read failed, falling back to live scrape');
    return null;
  }
}

async function writeCachedSource(sourceCache, goodsId, source, log) {
  try {
    await sourceCache.write(goodsId, source);
    log.debug({ goodsId }, 'goods-publish: source cache written');
  } catch (error) {
    log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache write failed');
  }
}

async function clearCachedSource(sourceCache, goodsId, warnings, log) {
  try {
    const removed = await sourceCache.remove(goodsId);
    if (removed) log.debug({ goodsId }, 'goods-publish: source cache cleared');
  } catch (error) {
    log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache cleanup failed after successful publish');
    if (Array.isArray(warnings) && !warnings.includes('source_cache_cleanup_failed')) {
      warnings.push('source_cache_cleanup_failed');
    }
  }
}

function normalizeObservedResult(observed, scrapeCooldown, log) {
  const classified = classifySourceObservation(observed.observation, {
    earlyObservation: observed.earlyObservation,
    pageUrl: observed.pageUrl,
  });
  if (classified.kind === 'empty_shell') {
    const cooldownResult = scrapeCooldown.recordSoftBlock(classified.signal);
    throw buildEmptyShellError(classified.data, cooldownResult);
  }
  if (classified.kind === 'consumer_degradation') {
    throw softRiskControlDetected(classified.signal);
  }
  if (classified.kind === 'invalid') {
    throw classified.error;
  }

  const { source, skuSnapshot } = classified;
  log.debug({
    fiberFound: source._fiberFound,
    catID: source.catID,
    catID1: source.catID1,
    catID2: source.catID2,
    catID3: source.catID3,
    carouselCount: Array.isArray(source.carousel) ? source.carousel.length : 0,
    skuTextLen: source.skuText?.length ?? 0,
    dimensionCount: skuSnapshot.skuDimensions.length,
    skuCount: skuSnapshot.skus.length,
    skuIssues: skuSnapshot.issues,
    bodyLen: source._bodyLen,
    roots: source._roots,
    appWall: source._appWall,
  }, 'source-scrape extracted fields');

  return source;
}

function buildContextOpener({ browserPort, browserSession, loadConsumerAuthState }) {
  return async function openReadOnlyConsumerContext(consumerAccountId, { storageState: explicitState, proxy } = {}) {
    const storageState = explicitState ?? loadConsumerAuthState(consumerAccountId).state;
    const options = { storageState, ...(proxy ? { proxy } : {}) };
    if (browserPort?.deriveConsumerContext && browserSession) {
      return browserPort.deriveConsumerContext(browserSession, options);
    }
    throw browserRuntimeError('browser_profile_missing');
  };
}

async function invalidateDegradedConsumerAuth(err, consumerAccountId, deleteConsumerAuthState, log) {
  if (err?.code !== 'E_RISK_CONTROL_SOFT') return;
  const cleanup = await deleteConsumerAuthState(consumerAccountId);
  err.detail = {
    ...(err.detail && typeof err.detail === 'object' ? err.detail : {}),
    consumer_account_degraded: true,
    consumer_auth_removed: cleanup.removed,
    consumer_auth_existed: cleanup.existed,
  };
  err.hint = '消费者账号已降级，旧登录态已删除；请更换账号并执行 pdd login --consumer';
  log.warn({ reason: err.detail.reason, authExisted: cleanup.existed },
    'goods-publish: degraded consumer auth removed');
}

async function resolveConsumerTarget(consumerAccount, resolveConsumerAccount) {
  if (consumerAccount && typeof consumerAccount === 'object' && consumerAccount.accountId != null) {
    return { accountId: consumerAccount.accountId, storageState: consumerAccount.storageState };
  }
  const resolved = await resolveConsumerAccount({ account: consumerAccount });
  return { accountId: resolved.accountId, storageState: undefined };
}

async function scrapeDirect({ goodsId, target, openContext, scrapeDeps }) {
  const { observePage, scrapeSimulate, random, scrapeCooldown, log } = scrapeDeps;
  const consumer = await openContext(target.accountId, { storageState: target.storageState });
  try {
    const observed = await observePage(consumer.page, goodsId, {
      simulate: scrapeSimulate,
      random,
      scoreCandidate: scoreCandidateForObserver,
    });
    return normalizeObservedResult(observed, scrapeCooldown, log);
  } finally {
    await consumer.close();
  }
}

async function runProxyAttempt({ goodsId, proxyConfig, attempt, target, openContext, signal, scrapeDeps }) {
  const { acquireProxyLease, observePage, scrapeSimulate, random, scrapeCooldown, now, log } = scrapeDeps;
  let consumer = null;
  let lease = null;
  try {
    lease = await acquireProxyLease(proxyConfig, { signal });
    log.debug(proxyLeaseSummary(lease, attempt, now), 'goods-publish: source proxy acquired');
    consumer = await openContext(target.accountId, {
      storageState: target.storageState,
      proxy: { server: lease.server },
    });
    const observed = await observePage(consumer.page, goodsId, {
      simulate: scrapeSimulate,
      random,
      scoreCandidate: scoreCandidateForObserver,
    });
    const source = normalizeObservedResult(observed, scrapeCooldown, log);
    log.debug({ ...proxyLeaseSummary(lease, attempt, now), result: 'success' },
      'goods-publish: source proxy attempt completed');
    return source;
  } catch (err) {
    if (signal?.aborted) throwIfAborted(signal);
    const mapped = mapProxyBrowserError(err);
    const failedSummary = lease
      ? proxyLeaseSummary(lease, attempt, now)
      : { provider: 'qingguo', attempt, request_id_hash: mapped?.detail?.request_id_hash ?? null };
    log.debug({ ...failedSummary, result: mapped?.code ?? 'E_GENERAL' }, 'goods-publish: source proxy attempt failed');
    throw mapped;
  } finally {
    await consumer?.close();
  }
}

async function scrapeWithProxy({ goodsId, proxyConfig, target, openContext, signal, onRetryRecovered, scrapeDeps }) {
  for (let attempt = 1; attempt <= SOURCE_PROXY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const source = await runProxyAttempt({ goodsId, proxyConfig, attempt, target, openContext, signal, scrapeDeps });
      if (attempt > 1) onRetryRecovered();
      return source;
    } catch (err) {
      if (!isRetryableProxyAttemptError(err) || attempt === SOURCE_PROXY_MAX_ATTEMPTS) throw err;
      await scrapeDeps.sleep(SOURCE_PROXY_RETRY_DELAYS[attempt - 1], signal);
    }
  }
  throw new PddCliError({
    code: 'E_PROXY_UNAVAILABLE',
    message: '青果代理重试预算已耗尽',
    exitCode: ExitCodes.NETWORK,
  });
}

function createLiveAcquisition({ goodsId, proxyConfig, warnings, clearCache, scrapeDeps }) {
  const {
    sourceCache,
    scrapeCooldown,
    browserPort,
    browserSession,
    resolveConsumerAccount,
    loadConsumerAuthState,
    deleteConsumerAuthState,
    log,
  } = scrapeDeps;

  return Object.freeze({
    goodsId,
    cacheHit: false,
    warnings,
    async fetch({ signal, consumerAccount, warnings: callerWarnings, browserSession: callSession } = {}) {
      throwIfAborted(signal);
      const target = await resolveConsumerTarget(consumerAccount, resolveConsumerAccount);
      const openContext = buildContextOpener({
        browserPort,
        browserSession: callSession ?? browserSession,
        loadConsumerAuthState,
      });
      const onRetryRecovered = () => {
        appendUniqueWarnings(warnings, ['source_proxy_retry_recovered']);
        appendUniqueWarnings(callerWarnings, ['source_proxy_retry_recovered']);
      };

      let source;
      try {
        log.info({ goodsId }, 'goods-publish: Phase A — scraping source');
        source = proxyConfig.enabled
          ? await scrapeWithProxy({ goodsId, proxyConfig, target, openContext, signal, onRetryRecovered, scrapeDeps })
          : await scrapeDirect({ goodsId, target, openContext, scrapeDeps });
      } catch (err) {
        await invalidateDegradedConsumerAuth(err, target.accountId, deleteConsumerAuthState, log);
        throw err;
      }

      scrapeCooldown.recordSuccess();
      await writeCachedSource(sourceCache, goodsId, source, log);
      return source;
    },
    clearCache,
  });
}

async function prepareSourceAcquisition(goodsUrl, sourceProxyEnv, readProxyConfig, scrapeDeps) {
  const { sourceCache, scrapeCooldown, log } = scrapeDeps;
  const goodsId = parseGoodsUrl(goodsUrl);
  const cachedSource = await readCachedSource(sourceCache, goodsId, log);
  const warnings = [];
  const clearCache = (callerWarnings) => clearCachedSource(sourceCache, goodsId, callerWarnings ?? warnings, log);

  if (cachedSource) {
    return Object.freeze({
      goodsId,
      cacheHit: true,
      warnings,
      async fetch({ signal } = {}) {
        throwIfAborted(signal);
        return structuredClone(cachedSource);
      },
      clearCache,
    });
  }

  if (!scrapeCooldown || typeof scrapeCooldown.check !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'SourceProductFetcher 需要有效的 scrapeCooldown 实例',
      exitCode: ExitCodes.GENERAL,
    });
  }
  scrapeCooldown.check();
  const proxyConfig = readProxyConfig(sourceProxyEnv);
  return createLiveAcquisition({ goodsId, proxyConfig, warnings, clearCache, scrapeDeps });
}

export function createSourceProductFetcher(options = {}) {
  const { sourceProxyEnv = {}, readProxyConfig = readSourceProxyConfig } = options;
  const scrapeDeps = {
    sourceCache: options.sourceCache ?? defaultSourceGoodsCache,
    scrapeCooldown: options.scrapeCooldown,
    scrapeSimulate: options.scrapeSimulate ?? true,
    browserPort: options.browserPort ?? null,
    browserSession: options.browserSession ?? null,
    observePage: options.observePage ?? observeSourceGoodsPage,
    acquireProxyLease: options.acquireProxyLease ?? acquireQingguoProxyLease,
    resolveConsumerAccount: options.resolveConsumerAccount ?? resolveConsumerAccountContext,
    loadConsumerAuthState: options.loadConsumerAuthState ?? loadAuthState,
    deleteConsumerAuthState: options.deleteConsumerAuthState ?? deleteAuthState,
    sleep: options.sleep ?? abortableSleep,
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
    log: options.log ?? getLogger(),
  };

  return Object.freeze({
    prepare: (goodsUrl) => prepareSourceAcquisition(goodsUrl, sourceProxyEnv, readProxyConfig, scrapeDeps),
  });
}
