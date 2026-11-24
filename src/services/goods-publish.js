import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getSharedBreaker } from '../infra/circuit-breaker.js';
import {
  buildSkuPreviewPlan,
  normalizeSourceGoodsProperties,
  parseGoodsUrl,
} from './goods-publish/source-normalizer.js';
import { createSourceProductFetcher } from './goods-publish/source-product-fetcher.js';
import { resolvePddCategory, buildCategorySearchText } from '../adapter/goods-publish/category-resolver.js';
import { buildPropertyPlan } from '../adapter/goods-publish/property-mapper.js';
import { readDynamicPropertyTemplate } from '../adapter/goods-publish/dynamic-property-template.js';
import {
  selectCategory,
  fillGoodsForm,
  fillGoodsProperties,
  fillFullCountDiscount,
  disableSizeChart,
  clickSaveDraft,
} from '../adapter/goods-publish/form-filler.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  GOODS_PUBLISH_COST_TEMPLATE_LIST,
  GOODS_PUBLISH_SUBMIT,
  GOODS_PUBLISH_TEMPLATE,
} from '../adapter/endpoints/goods-publish.js';
import { withWriteRateControl } from '../infra/rate-control.js';
import { assertNoRiskControl } from '../adapter/goods-publish/risk-detector.js';
import { transformImages } from './image-transform.js';
import { buildPricingPlan, validatePricingPlan } from './pricing-validator.js';
import { toCostTemplateView } from './views/goods.js';
import { toPublishView } from './views/goods-publish.js';
import { mallIdOf } from './views/_shared.js';

// NOTE: The Phase 2 API-based publish path (payload-builder, property-matcher, sku-mapper)
// was removed on 2026-07-10 in favor of the active UI-automation path. If PDD later exposes a
// stable publish API, reintroduce those modules from git history rather than reviving stale code.

async function listCostTemplates(ctx) {
  const result = await runEndpoint(ctx.page, GOODS_PUBLISH_COST_TEMPLATE_LIST, {}, ctx);
  const templates = result.templates ?? [];
  return templates.map((t) => ({
    id: t.id ?? t.cost_template_id ?? t.costTemplateId ?? null,
    name: t.name ?? t.costTemplateName ?? '',
    free_province_need: t.free_province_need ?? null,
  }));
}

export async function getCostTemplatesView(ctx) {
  const items = (await listCostTemplates(ctx)).map(toCostTemplateView);
  const headline = items.length === 0
    ? ['当前店铺没有运费模板']
    : [`共 ${items.length} 个运费模板`];
  return { headline, items, total: items.length, mall_id: mallIdOf(ctx) };
}

async function resolvePublishCostTemplate(ctx, requestedId = null) {
  const templates = (await listCostTemplates(ctx)).filter((t) => t.id != null && String(t.id) !== '');
  if (templates.length === 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '未找到可用运费模板',
      hint: '请先在商家后台创建至少一个运费模板后重试',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  if (requestedId == null || String(requestedId).trim() === '') return templates[0];
  const selected = templates.find((t) => String(t.id ?? '') === String(requestedId));
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
  const fixture = ctx.runtime.loadFixture('goods-publish/publish-result.json');
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

function sourceEvidenceError(issues, detail = {}) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message: '源商品属性或 SKU 颜色预览图证据不完整',
    hint: '已在创建商家草稿前停止；不会从详情文本、SKU 顺序或相近名称猜测',
    detail: { issues, ...detail },
    exitCode: ExitCodes.BUSINESS,
  });
}

function validateSourcePublishEvidence(source) {
  const goodsProperties = normalizeSourceGoodsProperties(
    source?.goodsProperties ?? source?.goodsProperty,
  );
  const preview = buildSkuPreviewPlan({
    skuDimensions: source?.skuDimensions,
    skus: source?.skus,
  });
  const issues = [];
  if (goodsProperties.length === 0) issues.push('source_properties_missing');
  issues.push(...preview.issues);
  if (issues.length > 0) {
    throw sourceEvidenceError([...new Set(issues)], {
      property_count: goodsProperties.length,
      preview_color_count: preview.plan.length,
    });
  }
  return {
    source: { ...source, goodsProperties },
    skuPreviewPlan: preview.plan,
  };
}

function propertyMappingError(mapping) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message: '商品属性无法与商家后台模板安全匹配',
    hint: '平台必填或重要属性缺失，或属性模板结构已变化；不会自动选择相近候选',
    detail: {
      issues: mapping.issues,
      mapped_property_count: mapping.plan.length,
      skipped_property_count: mapping.skippedCount,
    },
    exitCode: ExitCodes.BUSINESS,
  });
}

// 对外入口：内部流程（live / mock）结果统一投影为 v2 视图；warnings 单独返回供 runner 汇入 meta.warnings
export async function publishGoodsFromLink(ctx, goodsUrl, opts = {}) {
  const sourceGoodsId = parseGoodsUrl(goodsUrl);
  const { warnings = [], ...result } = await runPublishFlow(ctx, goodsUrl, opts);
  return { data: toPublishView(result, { sourceGoodsId, mallId: mallIdOf(ctx) }), warnings };
}

async function runPublishFlow(ctx, goodsUrl, opts = {}) {
  const goodsId = parseGoodsUrl(goodsUrl);
  const draftOnly = opts.draftOnly ?? true;
  const mockEnabled = ctx.runtime?.mode === 'fixture';
  if (mockEnabled) {
    const selectedTemplate = await resolvePublishCostTemplate(ctx, opts.costTemplateId ?? null);
    return buildMockPublishResult(ctx, goodsId, draftOnly, selectedTemplate.id);
  }

  const warnings = [];
  const log = ctx.log;
  const breaker = getSharedBreaker();
  const writeRateOptions = {
    tokensPerMinute: ctx.runtimeConfig?.writeRateTokensPerMinute,
  };
  const sourceFetcher = ctx.sourceFetcher ?? createSourceProductFetcher({
    sourceCache: ctx.sourceGoodsCache,
    scrapeCooldown: ctx.scrapeCooldown ?? ctx.runtime?.scrapeCooldown,
    sourceProxyEnv: ctx.runtime?.env?.sourceProxyEnv ?? {},
    scrapeSimulate: ctx.runtime?.env?.scrapeSimulate ?? true,
    browserPort: ctx.runtime?.ports?.browser,
    browserSession: ctx.browserSession,
    legacyBrowser: ctx.context?.browser?.(),
    sleep: ctx.runtime?.clock?.sleep,
    now: ctx.runtime?.clock?.now,
    log,
  });

  const acquisition = await sourceFetcher.prepare(goodsUrl);
  const selectedTemplate = await resolvePublishCostTemplate(ctx, opts.costTemplateId ?? null);

  let source = await breaker.wrap('scrape', () => acquisition.fetch({
    signal: ctx.signal,
    consumerAccount: ctx.config?.consumerAccount,
    warnings,
    browserSession: ctx.browserSession,
    legacyBrowser: ctx.context?.browser?.(),
  }));
  for (const warning of acquisition.warnings ?? []) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  const sourceEvidence = validateSourcePublishEvidence(source);
  source = sourceEvidence.source;
  const skuPreviewPlan = sourceEvidence.skuPreviewPlan;

  const categorySearchText = await breaker.wrap('category', async () => {
    const catId3 = source.catID3 || source.catID;
    log.info({ catId3 }, 'goods-publish: Phase B — resolving category');
    const category = await resolvePddCategory(catId3, source.catID1, source.catID2, {
      apiBase: ctx.runtimeConfig?.categoryApiBase,
      runtime: ctx.runtime,
    });
    return buildCategorySearchText(category);
  });
  log.info({ categorySearchText }, 'goods-publish: category search text');

  // NOTE: Image transform integration point (Phase C+).
  // transformImages() is available when PDD_IMAGE_TRANSFORM=1.
  // Full integration requires form-filler to accept pre-transformed file paths via source.carouselFiles.

  const draft = await withWriteRateControl('publish.create_draft', () =>
    breaker.wrap('create_draft', async () => {
      log.info('goods-publish: Phase C — UI category selection + draft creation');
      const result = await selectCategory(ctx.page, categorySearchText);
      await assertNoRiskControl(ctx.page, { phase: 'category' });
      return result;
    }), writeRateOptions
  );

  const template = await breaker.wrap('property_template', async () => {
    log.info('goods-publish: loading merchant property template');
    return runEndpoint(ctx.page, GOODS_PUBLISH_TEMPLATE, {
      cat_id: source.catID3 || source.catID,
      goods_commit_id: draft.goodsCommitId,
      goods_id: draft.goodsId,
    }, ctx);
  });
  let propertyMapping = buildPropertyPlan(source.goodsProperties, template);
  if (!propertyMapping.ok) throw propertyMappingError(propertyMapping);

  let pricingPlan = null;
  let uploadedSkuPreviewPlan = [];
  await withWriteRateControl('publish.fill_form', () =>
    breaker.wrap('fill_form', async () => {
      log.info({ ...draft }, 'goods-publish: Phase D — filling form');
      pricingPlan = buildPricingPlan(source);
      const pricingValidation = validatePricingPlan(pricingPlan);
      const fillResult = await fillGoodsForm(ctx.page, source, warnings, {
        pricingPlan,
        pricingValidation,
        propertyPlan: propertyMapping.plan,
        skuPreviewPlan,
      });
      uploadedSkuPreviewPlan = fillResult.uploadedSkuPreviewPlan;
      await assertNoRiskControl(ctx.page, { phase: 'form' });
    }), writeRateOptions
  );

  const mappedTemplatePids = new Set(
    propertyMapping.plan.map((property) => String(property.templatePid)),
  );
  let dynamicTemplate = template;
  let stable = false;
  for (let round = 0; round < 5; round += 1) {
    dynamicTemplate = await breaker.wrap('property_template_dynamic', async () =>
      readDynamicPropertyTemplate(ctx.page, dynamicTemplate)
    );
    if (dynamicTemplate?.ok !== true) {
      throw propertyMappingError({
        issues: dynamicTemplate?.issues ?? ['dynamic_property_template_invalid'],
        plan: propertyMapping.plan,
        skippedCount: propertyMapping.skippedCount,
      });
    }
    const dynamicMapping = buildPropertyPlan(source.goodsProperties, dynamicTemplate);
    if (!dynamicMapping.ok) throw propertyMappingError(dynamicMapping);
    const dependentPropertyPlan = dynamicMapping.plan.filter((property) =>
      !mappedTemplatePids.has(String(property.templatePid))
    );
    propertyMapping = dynamicMapping;
    if (dependentPropertyPlan.length === 0) {
      stable = true;
      break;
    }
    await withWriteRateControl('publish.fill_dependent_properties', () =>
      breaker.wrap('fill_dependent_properties', async () => {
        await fillGoodsProperties(ctx.page, dependentPropertyPlan);
        await assertNoRiskControl(ctx.page, { phase: 'form:dependent-properties' });
      }), writeRateOptions
    );
    for (const property of dependentPropertyPlan) {
      mappedTemplatePids.add(String(property.templatePid));
    }
  }
  if (!stable) {
    throw propertyMappingError({
      issues: ['dynamic_property_template_unstable'],
      plan: propertyMapping.plan,
      skippedCount: propertyMapping.skippedCount,
    });
  }

  await breaker.wrap('disable_size_chart', async () => {
    const result = await disableSizeChart(ctx.page);
    log.info({ changed: result.changed }, 'goods-publish: size chart disabled before draft save');
    await assertNoRiskControl(ctx.page, { phase: 'form:size-chart-disabled' });
  });
  await withWriteRateControl('publish.fill_full_count_discount', () =>
    breaker.wrap('fill_full_count_discount', async () => {
      await fillFullCountDiscount(ctx.page, ctx.runtimeConfig?.fullCountDiscountRate, log);
      await assertNoRiskControl(ctx.page, { phase: 'form:full-count-discount' });
    }), writeRateOptions
  );
  for (const warning of propertyMapping.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  await withWriteRateControl('publish.save_draft', () =>
    breaker.wrap('save_draft', async () => {
      log.info({ costTemplateId: selectedTemplate.id }, 'goods-publish: Phase E — saving draft');
      const saved = await clickSaveDraft(ctx.page, draft.goodsCommitId, {
        costTemplateId: selectedTemplate.id,
        expectedSkuPricing: pricingPlan?.skuPricing,
        expectedPropertyPlan: propertyMapping.plan,
        expectedSkuPreviewPlan: uploadedSkuPreviewPlan,
        expectedFullCountDiscountRate: ctx.runtimeConfig?.fullCountDiscountRate,
        strictPayload: true,
        strictVerify: true,
      });
      for (const warning of saved.verification?.warnings ?? []) {
        if (!warnings.includes(warning)) warnings.push(warning);
      }
    }), writeRateOptions
  );

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
      }), writeRateOptions
    );
    await assertNoRiskControl(ctx.page, { phase: 'submit:after' });
    submit = assertSubmitSucceeded(submitResult);
  }

  await acquisition.clearCache(warnings);

  return {
    goods_id: draft.goodsId,
    goods_commit_id: draft.goodsCommitId,
    status: draftOnly ? 'draft' : 'submitted',
    cost_template_id: selectedTemplate.id,
    source_title: source.goodsName,
    category_path: categorySearchText,
    property_mapping: {
      mapped_count: propertyMapping.plan.length,
      skipped_count: propertyMapping.skippedCount,
    },
    sku_preview_count: uploadedSkuPreviewPlan.length,
    image_transform: ctx.runtime?.env?.imageTransform ? 'enabled' : 'disabled',
    submit: submit ?? undefined,
    warnings,
  };
}
