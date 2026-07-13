import { createConsumerContext } from '../adapter/browser.js';
import { deleteAuthState } from '../adapter/auth-state.js';
import { CONSUMER_AUTH_STATE_PATH } from '../infra/paths.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getSharedBreaker } from '../infra/circuit-breaker.js';
import { getSharedScrapeCooldown } from '../infra/scrape-cooldown.js';
import { parseGoodsUrl, scrapeSourceGoods } from '../adapter/goods-publish/source-scraper.js';
import { resolvePddCategory, buildCategorySearchText } from '../adapter/goods-publish/category-resolver.js';
import { selectCategory, fillGoodsForm, clickSaveDraft } from '../adapter/goods-publish/form-filler.js';
import { isMockEnabled, loadFixture } from '../adapter/mock-dispatcher.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PUBLISH_COST_TEMPLATE_LIST, GOODS_PUBLISH_SUBMIT } from '../adapter/endpoints/goods-publish.js';
import { withWriteRateControl } from '../infra/rate-control.js';
import { assertNoRiskControl } from '../adapter/goods-publish/risk-detector.js';
import { rewriteTitle } from './title-rewriter.js';
import { transformImages } from './image-transform.js';
import { buildPricingPlan, validatePricingPlan } from './pricing-validator.js';
import { defaultSourceGoodsCache } from './goods-publish-source-cache.js';
import { abortableSleep } from '../infra/abort.js';
import {
  acquireQingguoProxyLease,
  readSourceProxyConfig,
} from '../adapter/goods-publish/qingguo-proxy.js';

const SOURCE_PROXY_MAX_ATTEMPTS = 3;
const SOURCE_PROXY_RETRY_DELAYS = [500, 1000];

// NOTE: The Phase 2 API-based publish path (payload-builder, property-matcher, sku-mapper)
// was removed on 2026-07-10 in favor of the active UI-automation path. If PDD later exposes a
// stable publish API, reintroduce those modules from git history rather than reviving stale code.

export async function listCostTemplates(ctx) {
  const result = await runEndpoint(ctx.page, GOODS_PUBLISH_COST_TEMPLATE_LIST, {}, ctx);
  const templates = result.templates ?? result.cost_template_list ?? result.result?.cost_template_list ?? result.result?.list ?? [];
  return templates.map(t => ({
    id: t.id ?? t.cost_template_id ?? t.costTemplateId ?? null,
    name: t.name ?? t.costTemplateName ?? '',
    free_province_need: t.free_province_need ?? null,
  }));
}

export async function resolvePublishCostTemplate(ctx, requestedId = null) {
  const templates = (await listCostTemplates(ctx)).filter(t => t.id != null && String(t.id) !== '');
  if (templates.length === 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '未找到可用运费模板',
      hint: '请先在商家后台创建至少一个运费模板后重试',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  if (requestedId == null || String(requestedId).trim() === '') return templates[0];
  const selected = templates.find(t => String(t.id ?? '') === String(requestedId ?? ''));
  if (selected) return selected;

  throw new PddCliError({
    code: 'E_USAGE',
    message: `运费模板不存在: ${requestedId}`,
    hint: '运行 pdd goods templates 查看可用运费模板 ID',
    detail: { cost_template_id: requestedId },
    exitCode: ExitCodes.USAGE,
  });
}

async function buildMockPublishResult(ctx, goodsId, draftOnly, costTemplateId) {
  const fixture = loadFixture('goods-publish/publish-result.json');
  const status = draftOnly ? 'draft' : 'submitted';
  const result = {
    goods_id: fixture.goods_id,
    goods_commit_id: fixture.goods_commit_id,
    source_goods_id: fixture.source_goods_id ?? goodsId,
    status,
    source_title: fixture.source_title ?? fixture.goods_name,
    cost_template_id: costTemplateId,
    warnings: fixture.warnings ?? [],
  };
  if (!draftOnly) {
    const submit = await runEndpoint(ctx.page, GOODS_PUBLISH_SUBMIT, {
      goods_commit_id: fixture.goods_commit_id,
      goods_id: fixture.goods_id,
    }, ctx);
    result.submit = assertSubmitSucceeded(submit);
  }
  return result;
}

function summarizeSubmitResult(result) {
  const raw = result?.raw ?? result;
  const code = raw?.error_code ?? raw?.errorCode ?? result?.error_code ?? result?.errorCode;
  return {
    success: result?.success === true || code === 0 || code === 1000000,
  };
}

function assertSubmitSucceeded(result) {
  const summary = summarizeSubmitResult(result);
  if (summary.success) return summary;
  const raw = result?.raw ?? result;
  const mapped = GOODS_PUBLISH_SUBMIT.errorMapper?.(raw);
  throw new PddCliError({
    code: mapped?.code ?? 'E_BUSINESS',
    message: mapped?.message || '商品提交发布失败',
    hint: '保存草稿已完成，但提交发布被平台拒绝',
    detail: { errorCode: raw?.error_code ?? raw?.errorCode },
    exitCode: mapped?.exitCode ?? ExitCodes.BUSINESS,
  });
}

function wrapSaveDraftError(err) {
  if (err?.exitCode === ExitCodes.RATE_LIMIT || err?.exitCode === ExitCodes.AUTH) throw err;
  if (err instanceof PddCliError) throw err;
  throw new PddCliError({
    code: 'E_BUSINESS',
    message: err?.message || '保存草稿失败，已停止发布流程',
    exitCode: ExitCodes.BUSINESS,
  });
}

function isRetryableProxyAttemptError(err) {
  return err?.code === 'E_PROXY_UNAVAILABLE'
    || err?.code === 'E_PROXY_NETWORK';
}

function isProxyInfrastructureError(err) {
  return err?.code === 'E_PROXY_UNAVAILABLE' || err?.code === 'E_PROXY_NETWORK';
}

function mapProxyBrowserError(err) {
  if (err instanceof PddCliError) return err;
  const text = `${err?.name ?? ''} ${err?.code ?? ''} ${err?.message ?? ''}`;
  // Chromium hides an upstream HTTP 407 behind ERR_TUNNEL_CONNECTION_FAILED for
  // this IP-whitelist provider. Retrying fresh leases cannot repair provider auth.
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

function proxyLeaseSummary(lease, attempt) {
  return {
    provider: lease.provider,
    attempt,
    area: lease.area,
    isp: lease.isp,
    remaining_ms: Math.max(0, lease.expiresAt - Date.now()),
    request_id_hash: lease.requestIdHash,
  };
}

async function invalidateDegradedConsumerAuth(ctx, err) {
  if (err?.code !== 'E_RISK_CONTROL_SOFT') return;
  const authStatePath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH;
  const cleanup = await deleteAuthState(authStatePath);
  err.detail = {
    ...(err.detail && typeof err.detail === 'object' ? err.detail : {}),
    consumer_account_degraded: true,
    consumer_auth_removed: cleanup.removed,
    consumer_auth_existed: cleanup.existed,
  };
  err.hint = '消费者账号已降级，旧登录态已删除；请更换账号并执行 pdd login --consumer';
  ctx.log.warn({ reason: err.detail.reason, authExisted: cleanup.existed },
    'goods-publish: degraded consumer auth removed');
}

async function scrapeSourceDirect(ctx, goodsId) {
  const consumer = await createConsumerContext(ctx.context.browser(), {
    storageStatePath: process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH,
  });
  try {
    return await scrapeSourceGoods(consumer.page, goodsId, ctx);
  } finally {
    await consumer.close();
  }
}

async function runProxyScrapeAttempt(ctx, goodsId, proxyConfig, attempt) {
  let consumer = null;
  let lease = null;
  try {
    lease = await acquireQingguoProxyLease(proxyConfig, { signal: ctx.signal });
    ctx.log.debug(proxyLeaseSummary(lease, attempt), 'goods-publish: source proxy acquired');
    consumer = await createConsumerContext(ctx.context.browser(), {
      storageStatePath: process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH,
      proxy: {
        server: lease.server,
      },
    });
    const source = await scrapeSourceGoods(consumer.page, goodsId, {
      ...ctx,
    });
    ctx.log.debug({ ...proxyLeaseSummary(lease, attempt), result: 'success' },
      'goods-publish: source proxy attempt completed');
    return source;
  } catch (err) {
    const mapped = mapProxyBrowserError(err);
    ctx.log.debug({
      ...(lease ? proxyLeaseSummary(lease, attempt) : {
        provider: 'qingguo',
        attempt,
        request_id_hash: mapped?.detail?.request_id_hash ?? null,
      }),
      result: mapped?.code ?? 'E_GENERAL',
    }, 'goods-publish: source proxy attempt failed');
    throw mapped;
  } finally {
    await consumer?.close();
  }
}

async function scrapeSourceWithProxy(ctx, goodsId, proxyConfig, warnings) {
  for (let attempt = 1; attempt <= SOURCE_PROXY_MAX_ATTEMPTS; attempt++) {
    try {
      const source = await runProxyScrapeAttempt(ctx, goodsId, proxyConfig, attempt);
      if (attempt > 1) warnings.push('source_proxy_retry_recovered');
      return source;
    } catch (err) {
      if (!isRetryableProxyAttemptError(err)) throw err;
      if (attempt === SOURCE_PROXY_MAX_ATTEMPTS) {
        throw err;
      }
      if (isProxyInfrastructureError(err)) {
        await abortableSleep(SOURCE_PROXY_RETRY_DELAYS[attempt - 1], ctx.signal);
      }
    }
  }
  throw new PddCliError({
    code: 'E_PROXY_UNAVAILABLE',
    message: '青果代理重试预算已耗尽',
    exitCode: ExitCodes.NETWORK,
  });
}

async function readCachedSource(ctx, sourceCache, goodsId) {
  try {
    const source = await sourceCache.read(goodsId);
    if (source) ctx.log.info({ goodsId }, 'goods-publish: source cache hit');
    return source;
  } catch (error) {
    ctx.log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache read failed, falling back to live scrape');
    return null;
  }
}

async function writeCachedSource(ctx, sourceCache, goodsId, source) {
  try {
    await sourceCache.write(goodsId, source);
    ctx.log.debug({ goodsId }, 'goods-publish: source cache written');
  } catch (error) {
    ctx.log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache write failed');
  }
}

async function clearCachedSource(ctx, sourceCache, goodsId, warnings) {
  try {
    const removed = await sourceCache.remove(goodsId);
    if (removed) ctx.log.debug({ goodsId }, 'goods-publish: source cache cleared');
  } catch (error) {
    ctx.log.warn({ goodsId, cache_error: error?.code ?? 'E_UNKNOWN' },
      'goods-publish: source cache cleanup failed after successful publish');
    warnings.push('source_cache_cleanup_failed');
  }
}

export async function publishGoodsFromLink(ctx, goodsUrl, opts = {}) {
  const goodsId = parseGoodsUrl(goodsUrl);
  const draftOnly = opts.draftOnly ?? true;
  const mockEnabled = isMockEnabled();
  const sourceCache = ctx.sourceGoodsCache ?? defaultSourceGoodsCache;
  const warnings = [];
  let source = null;
  let pricingPlan = null;
  let sourceProxyConfig = { enabled: false, provider: null };

  if (!mockEnabled) {
    source = await readCachedSource(ctx, sourceCache, goodsId);
    if (!source) {
      // IP 软封冷却期内：只在确实需要实时抓取时短路退避。缓存命中不消耗出口 IP。
      // 放在 breaker.wrap 之外，避免把"主动退避"误记为 scrape 阶段失败而触发熔断。
      (ctx.scrapeCooldown ?? getSharedScrapeCooldown()).check();
      sourceProxyConfig = readSourceProxyConfig();
    }
  }

  const selectedTemplate = await resolvePublishCostTemplate(ctx, opts.costTemplateId ?? null);

  if (mockEnabled) return buildMockPublishResult(ctx, goodsId, draftOnly, selectedTemplate.id);
  const log = ctx.log;
  const breaker = getSharedBreaker();

  if (!source) {
    source = await breaker.wrap('scrape', async () => {
      log.info({ goodsId }, 'goods-publish: Phase A — scraping source');
      try {
        if (!sourceProxyConfig.enabled) return await scrapeSourceDirect(ctx, goodsId);
        return await scrapeSourceWithProxy(ctx, goodsId, sourceProxyConfig, warnings);
      } catch (err) {
        await invalidateDegradedConsumerAuth(ctx, err);
        throw err;
      }
    });
    await writeCachedSource(ctx, sourceCache, goodsId, source);
  }

  const categorySearchText = await breaker.wrap('category', async () => {
    const catId3 = source.catID3 || source.catID;
    log.info({ catId3 }, 'goods-publish: Phase B — resolving category');
    const category = await resolvePddCategory(catId3, source.catID1, source.catID2);
    return buildCategorySearchText(category);
  });
  log.info({ categorySearchText }, 'goods-publish: category search text');

  // Phase B+ — title rewrite
  let sourceForForm = source;
  if (process.env.PDD_TITLE_REWRITE !== '0') {
    const rewritten = await rewriteTitle(source, {
      categoryPath: categorySearchText,
      log,
    });
    if (rewritten?.changed) {
      log.info({ original: source.goodsName, rewritten: rewritten.title, method: rewritten.method },
        'goods-publish: title rewritten');
      warnings.push(...(rewritten.warnings || []));
    }
    sourceForForm = { ...source, goodsName: rewritten?.title || source.goodsName };
  }

  // NOTE: Image transform integration point (Phase C+).
  // transformImages() is available when PDD_IMAGE_TRANSFORM=1.
  // Full integration requires form-filler to accept pre-transformed file paths via sourceForForm.carouselFiles.

  const draft = await withWriteRateControl('publish.create_draft', () =>
    breaker.wrap('create_draft', async () => {
      log.info('goods-publish: Phase C — UI category selection + draft creation');
      const result = await selectCategory(ctx.page, categorySearchText);
      await assertNoRiskControl(ctx.page, { phase: 'category' });
      return result;
    })
  );

  await withWriteRateControl('publish.fill_form', () =>
    breaker.wrap('fill_form', async () => {
      log.info({ ...draft }, 'goods-publish: Phase D — filling form');
      pricingPlan = buildPricingPlan(sourceForForm);
      const pricingValidation = validatePricingPlan(pricingPlan);
      await fillGoodsForm(ctx.page, sourceForForm, warnings, { pricingPlan, pricingValidation });
      await assertNoRiskControl(ctx.page, { phase: 'form' });
    })
  );

  try {
    await withWriteRateControl('publish.save_draft', () =>
      breaker.wrap('save_draft', async () => {
        log.info({ costTemplateId: selectedTemplate.id }, 'goods-publish: Phase E — saving draft');
        const saved = await clickSaveDraft(ctx.page, draft.goodsCommitId, {
          costTemplateId: selectedTemplate.id,
          expectedSkuPricing: pricingPlan?.skuPricing,
          strictPayload: true,
          strictVerify: true,
        });
        for (const warning of saved.verification?.warnings ?? []) {
          if (!warnings.includes(warning)) warnings.push(warning);
        }
      })
    );
  } catch (err) {
    log.warn({ err: err?.message }, 'goods-publish: save draft failed');
    wrapSaveDraftError(err);
  }

  let submit = null;
  if (!draftOnly) {
    await assertNoRiskControl(ctx.page, { phase: 'submit:before' });
    const submitResult = await withWriteRateControl('publish.submit', () =>
      breaker.wrap('submit', async () => {
        log.info('goods-publish: Phase F — submitting goods');
        return runEndpoint(ctx.page, GOODS_PUBLISH_SUBMIT, {
          goods_commit_id: draft.goodsCommitId,
          goods_id: draft.goodsId,
        }, ctx);
      })
    );
    await assertNoRiskControl(ctx.page, { phase: 'submit:after' });
    submit = assertSubmitSucceeded(submitResult);
  }

  await clearCachedSource(ctx, sourceCache, goodsId, warnings);

  return {
    goods_id: draft.goodsId,
    goods_commit_id: draft.goodsCommitId,
    status: draftOnly ? 'draft' : 'submitted',
    cost_template_id: selectedTemplate.id,
    source_title: source.goodsName,
    category_path: categorySearchText,
    rewritten_title: sourceForForm.goodsName !== source.goodsName ? sourceForForm.goodsName : undefined,
    image_transform: process.env.PDD_IMAGE_TRANSFORM === '1' ? 'enabled' : 'disabled',
    submit: submit ?? undefined,
    warnings,
  };
}
