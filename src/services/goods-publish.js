import { PddCliError, ExitCodes } from '../infra/errors.js';
import { redactRecursive } from '../infra/logger.js';
import { appendUniqueWarnings } from '../infra/output.js';
import { parseGoodsUrl } from './goods-publish/source-normalizer.js';
import {
  planPreDraftPublish,
  buildInitialPropertyPlan,
  propertyMappingError,
} from './goods-publish/draft-planner.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import {
  GOODS_PUBLISH_COST_TEMPLATE_LIST,
} from '../adapter/endpoints/goods-publish.js';
import { toCostTemplateView } from './views/goods.js';
import { toPublishView } from './views/goods-publish.js';
import { mallIdOf } from './views/_shared.js';

const STRIPPED_DETAIL_KEYS = new Set([
  'proxy',
  'server',
  'authKey',
  'auth_key',
  'imageUrl',
  'image_url',
  'sourceImageUrl',
  'source_image_url',
  'uploadedImageUrl',
  'uploaded_image_url',
  'thumbUrl',
  'thumb_url',
  'carousel',
  'detailImgs',
  'detail_imgs',
  'react',
  'rawReact',
  'reactFiber',
  'rawTemplate',
  'raw_template',
]);

const URL_PATH_KEYS = new Set(['url', 'pageUrl', 'page_url']);

function stripUrlQuery(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return rawUrl;
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl.split('?')[0].split('#')[0];
  }
}

function sanitizeDetailValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDetailValue(item, seen));

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (STRIPPED_DETAIL_KEYS.has(key) || key.startsWith('__react')) continue;
    out[key] = URL_PATH_KEYS.has(key) ? stripUrlQuery(entry) : sanitizeDetailValue(entry, seen);
  }
  return out;
}

function attachPublishErrorDetail(err, { stage, sourceCached }) {
  if (!(err instanceof PddCliError)) return err;
  const existing = err.detail && typeof err.detail === 'object' && !Array.isArray(err.detail)
    ? err.detail
    : {};
  const cleaned = sanitizeDetailValue(existing);
  err.detail = redactRecursive({
    ...cleaned,
    stage: cleaned.stage ?? stage,
    source_cached: typeof cleaned.source_cached === 'boolean' ? cleaned.source_cached : Boolean(sourceCached),
  });
  return err;
}

async function runPublishStage(stage, getSourceCached, fn) {
  try {
    return await fn();
  } catch (err) {
    throw attachPublishErrorDetail(err, { stage, sourceCached: getSourceCached() });
  }
}

async function listCostTemplates(ctx) {
  const result = await runEndpoint(ctx.page, GOODS_PUBLISH_COST_TEMPLATE_LIST, {}, ctx);
  const templates = result.templates ?? [];
  return templates.map((template) => ({
    id: template.id ?? template.cost_template_id ?? template.costTemplateId ?? null,
    name: template.name ?? template.costTemplateName ?? '',
    free_province_need: template.free_province_need ?? null,
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
  const templates = (await listCostTemplates(ctx))
    .filter((template) => template.id != null && String(template.id) !== '');
  if (templates.length === 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: '未找到可用运费模板',
      hint: '请先在商家后台创建至少一个运费模板后重试',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  if (requestedId == null || String(requestedId).trim() === '') return templates[0];
  const selected = templates.find((template) => String(template.id ?? '') === String(requestedId));
  if (selected) return selected;

  throw new PddCliError({
    code: 'E_USAGE',
    message: `运费模板不存在: ${requestedId}`,
    hint: '运行 pdd goods templates 查看可用运费模板 ID',
    detail: { cost_template_id: requestedId },
    exitCode: ExitCodes.USAGE,
  });
}

function resolveGoodsPublishPort(ctx) {
  const port = ctx.goodsPublish ?? ctx.runtime?.ports?.goodsPublish;
  if (port?.sourceFetcher && port?.categoryResolver && port?.draftEditor) {
    return port;
  }
  throw new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: 'publishGoodsFromLink: GoodsPublishPort is required',
    hint: '请通过命令运行时或 ctx.goodsPublish 注入 GoodsPublishPort 实例',
    detail: { source: 'runtime', reason: 'goods_publish_port_missing' },
    exitCode: ExitCodes.GENERAL,
  });
}

function categoryTextOf(category) {
  if (typeof category?.searchText === 'string' && category.searchText) return category.searchText;
  const cates = category?.cates || category?.cats || [];
  return Array.isArray(cates) ? cates.filter(Boolean).join(' > ') : '';
}

async function prepareAndFetchSource({
  ctx,
  goodsUrl,
  costTemplateId = null,
  sourceFetcher,
  warnings,
  getSourceCached,
  setSourceCached,
}) {
  const acquisition = await runPublishStage('prepare_source', getSourceCached, async () => {
    const prepared = await sourceFetcher.prepare(goodsUrl, { log: ctx.log });
    setSourceCached(Boolean(prepared?.cacheHit));
    return prepared;
  });

  const selectedTemplate = await runPublishStage('cost_template', getSourceCached, () =>
    resolvePublishCostTemplate(ctx, costTemplateId),
  );

  const source = await runPublishStage('scrape_source', getSourceCached, async () => {
    const fetched = await acquisition.fetch({
      signal: ctx.signal,
      consumerAccount: ctx.config?.consumerAccount,
      warnings,
      browserSession: ctx.browserSession,
      log: ctx.log,
    });
    appendUniqueWarnings(warnings, acquisition.warnings);
    return fetched;
  });

  return { acquisition, selectedTemplate, source };
}

async function createAndPopulateDraft({
  ctx,
  draftEditor,
  categorySearchText,
  preDraftPlan,
  selectedTemplate,
  warnings,
  getSourceCached,
}) {
  const { source } = preDraftPlan;
  const { draft, initialTemplate } = await runPublishStage('open_draft', getSourceCached, () =>
    draftEditor.openDraft({
      categorySearchText,
      catId: source.catID3 || source.catID,
      page: ctx.page,
      client: ctx.client,
      signal: ctx.signal,
      deadlineAt: ctx.deadlineAt,
      clock: ctx.runtime?.clock ?? ctx.clock,
      log: ctx.log,
    }),
  );

  const initialPropertyPlan = await runPublishStage('plan_initial_properties', getSourceCached, () => {
    const mapping = buildInitialPropertyPlan(source.goodsProperties, initialTemplate);
    if (!mapping.ok) throw propertyMappingError(mapping);
    return mapping;
  });

  const savedDraft = await runPublishStage('populate_and_save_draft', getSourceCached, () =>
    draftEditor.populateAndSaveDraft({
      draft,
      plan: {
        source,
        costTemplateId: selectedTemplate.id,
        pricingPlan: preDraftPlan.pricingPlan,
        pricingValidation: preDraftPlan.pricingValidation,
        skuPreviewPlan: preDraftPlan.skuPreviewPlan,
        fullCountDiscountRate: ctx.runtimeConfig?.fullCountDiscountRate,
      },
      initialTemplate,
      initialPropertyPlan,
      page: ctx.page,
      signal: ctx.signal,
      warnings,
      log: ctx.log,
    }),
  );

  appendUniqueWarnings(warnings, savedDraft.warnings);
  return {
    draft,
    propertyMapping: savedDraft.propertyMapping ?? initialPropertyPlan,
    uploadedSkuPreviewPlan: savedDraft.uploadedSkuPreviewPlan ?? [],
  };
}

// 对外入口：内部流程（live / mock）结果统一投影为 v2 视图；warnings 单独返回供 runner 汇入 meta.warnings
export async function publishGoodsFromLink(ctx, goodsUrl, opts = {}) {
  const sourceGoodsId = await runPublishStage('parse_url', () => false, () => parseGoodsUrl(goodsUrl));
  const { warnings = [], ...result } = await runPublishFlow(ctx, goodsUrl, opts);
  return { data: toPublishView(result, { sourceGoodsId, mallId: mallIdOf(ctx) }), warnings };
}

async function runPublishFlow(ctx, goodsUrl, opts = {}) {
  const draftOnly = opts.draftOnly ?? true;
  const warnings = [];
  let sourceCached = false;
  const getSourceCached = () => sourceCached;
  const { sourceFetcher, categoryResolver, draftEditor } = resolveGoodsPublishPort(ctx);

  const { acquisition, selectedTemplate, source: fetchedSource } = await prepareAndFetchSource({
    ctx,
    goodsUrl,
    costTemplateId: opts.costTemplateId ?? null,
    sourceFetcher,
    warnings,
    getSourceCached,
    setSourceCached: (value) => { sourceCached = value; },
  });

  const preDraftPlan = await runPublishStage('plan_pre_draft', getSourceCached, () =>
    planPreDraftPublish(fetchedSource, {
      fullCountDiscountRate: ctx.runtimeConfig?.fullCountDiscountRate,
    }),
  );

  const category = await runPublishStage('resolve_category', getSourceCached, () => {
    const catId3 = preDraftPlan.source.catID3 || preDraftPlan.source.catID;
    ctx.log?.info?.({ catId3 }, 'goods-publish: Phase B — resolving category');
    return categoryResolver.resolve(
      { catId1: preDraftPlan.source.catID1, catId2: preDraftPlan.source.catID2, catId3 },
      { signal: ctx.signal, apiBase: ctx.runtimeConfig?.categoryApiBase, log: ctx.log },
    );
  });
  const categorySearchText = categoryTextOf(category);
  ctx.log?.info?.({ categorySearchText }, 'goods-publish: category search text');

  const { draft, propertyMapping, uploadedSkuPreviewPlan } = await createAndPopulateDraft({
    ctx,
    draftEditor,
    categorySearchText,
    preDraftPlan,
    selectedTemplate,
    warnings,
    getSourceCached,
  });

  const submit = draftOnly
    ? null
    : await runPublishStage('submit_draft', getSourceCached, () =>
        draftEditor.submitDraft(draft, {
          page: ctx.page,
          client: ctx.client,
          signal: ctx.signal,
          deadlineAt: ctx.deadlineAt,
          clock: ctx.runtime?.clock ?? ctx.clock,
          log: ctx.log,
        }),
      );

  await acquisition.clearCache(warnings, ctx.log);

  return {
    goods_id: draft.goodsId,
    goods_commit_id: draft.goodsCommitId,
    status: draftOnly ? 'draft' : 'submitted',
    cost_template_id: selectedTemplate.id,
    source_title: preDraftPlan.source.goodsName,
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
