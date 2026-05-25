import { createConsumerContext } from '../adapter/browser.js';
import { CONSUMER_AUTH_STATE_PATH } from '../infra/paths.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getSharedBreaker } from '../infra/circuit-breaker.js';
import { parseGoodsUrl, scrapeSourceGoods } from '../adapter/goods-publish/source-scraper.js';
import { resolvePddCategory, buildCategorySearchText } from '../adapter/goods-publish/category-resolver.js';
import { selectCategory, fillGoodsForm, clickSaveDraft } from '../adapter/goods-publish/form-filler.js';
import { isMockEnabled, loadFixture } from '../adapter/mock-dispatcher.js';
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_PUBLISH_COST_TEMPLATE_LIST } from '../adapter/endpoints/goods-publish.js';
import { withWriteRateControl } from '../infra/rate-control.js';
import { assertNoRiskControl } from '../adapter/goods-publish/risk-detector.js';
import { rewriteTitle } from './title-rewriter.js';
import { transformImages } from './image-transform.js';

// NOTE: Sub-modules in ./goods-publish/ (payload-builder, property-matcher, sku-mapper)
// are Phase 2 (API-based publish path). Currently unused — the active path uses UI automation.
// Do NOT remove: they have test coverage and will be integrated when PDD exposes a stable API.

export async function listCostTemplates(ctx) {
  const result = await runEndpoint(ctx.page, GOODS_PUBLISH_COST_TEMPLATE_LIST, {}, ctx);
  const templates = result.templates ?? [];
  return templates.map(t => ({
    id: t.id ?? t.cost_template_id ?? t.costTemplateId ?? null,
    name: t.name ?? t.costTemplateName ?? '',
    free_province_need: t.free_province_need ?? null,
  }));
}

export async function publishGoodsFromLink(ctx, goodsUrl, opts = {}) {
  const goodsId = parseGoodsUrl(goodsUrl);
  const draftOnly = opts.draftOnly ?? true;

  if (!draftOnly) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--confirm (自动提交) 暂未实现，当前仅支持创建草稿',
      hint: '去除 --confirm 参数，商品将保存为草稿状态',
      exitCode: ExitCodes.USAGE,
    });
  }

  if (isMockEnabled()) return loadFixture('goods-publish/publish-result.json');
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
      await fillGoodsForm(ctx.page, sourceForForm, warnings);
      await assertNoRiskControl(ctx.page, { phase: 'form' });
    })
  );

  await withWriteRateControl('publish.save_draft', () =>
    breaker.wrap('save_draft', async () => {
      log.info('goods-publish: Phase E — saving draft');
      await clickSaveDraft(ctx.page, draft.goodsCommitId);
    })
  ).catch(err => {
    if (err?.exitCode === ExitCodes.RATE_LIMIT || err?.exitCode === ExitCodes.AUTH) throw err;
    log.warn({ err: err?.message }, 'goods-publish: save draft failed');
    warnings.push('save_draft_failed');
  });

  return {
    goods_id: draft.goodsId,
    goods_commit_id: draft.goodsCommitId,
    status: 'draft',
    source_title: source.goodsName,
    category_path: categorySearchText,
    rewritten_title: sourceForForm.goodsName !== source.goodsName ? sourceForForm.goodsName : undefined,
    image_transform: process.env.PDD_IMAGE_TRANSFORM === '1' ? 'enabled' : 'disabled',
    warnings,
  };
}
