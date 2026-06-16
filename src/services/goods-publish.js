import { createConsumerContext } from '../adapter/browser.js';
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

// NOTE: Sub-modules in ./goods-publish/ (payload-builder, property-matcher, sku-mapper)
// are Phase 2 (API-based publish path). Currently unused — the active path uses UI automation.
// Do NOT remove: they have test coverage and will be integrated when PDD exposes a stable API.

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

export async function publishGoodsFromLink(ctx, goodsUrl, opts = {}) {
  const goodsId = parseGoodsUrl(goodsUrl);
  const draftOnly = opts.draftOnly ?? true;
  const mockEnabled = isMockEnabled();

  if (!mockEnabled) {
    // IP 软封冷却期内：在任何真实网络请求前就短路退避（省资源、不再烧 IP）。
    // 放在 breaker.wrap 之外，避免把"主动退避"误记为 scrape 阶段失败而触发熔断。
    // 与 scrapeSourceGoods 一致走 ctx 注入 seam（便于测试注入）。
    (ctx.scrapeCooldown ?? getSharedScrapeCooldown()).check();
  }

  const selectedTemplate = await resolvePublishCostTemplate(ctx, opts.costTemplateId ?? null);

  if (mockEnabled) return buildMockPublishResult(ctx, goodsId, draftOnly, selectedTemplate.id);
  const log = ctx.log;
  const warnings = [];
  const breaker = getSharedBreaker();

  const source = await breaker.wrap('scrape', async () => {
    log.info({ goodsId }, 'goods-publish: Phase A — scraping source');
    const consumer = await createConsumerContext(ctx.context.browser(), {
      storageStatePath: process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH,
    });
    try {
      return await scrapeSourceGoods(consumer.page, goodsId, ctx);
    } finally {
      await consumer.close();
    }
  });

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
      const pricingPlan = buildPricingPlan(sourceForForm);
      const pricingValidation = validatePricingPlan(pricingPlan);
      await fillGoodsForm(ctx.page, sourceForForm, warnings, { pricingPlan, pricingValidation });
      await assertNoRiskControl(ctx.page, { phase: 'form' });
    })
  );

  try {
    await withWriteRateControl('publish.save_draft', () =>
      breaker.wrap('save_draft', async () => {
        log.info({ costTemplateId: selectedTemplate.id }, 'goods-publish: Phase E — saving draft');
        await clickSaveDraft(ctx.page, draft.goodsCommitId, {
          costTemplateId: selectedTemplate.id,
          strictVerify: true,
        });
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
