import { resolvePddCategory, buildCategorySearchText } from '../../adapter/goods-publish/category-resolver.js';
import { createLiveMerchantDraftEditor } from '../../adapter/goods-publish/merchant-draft-editor.js';
import { createSourceProductFetcher } from './source-product-fetcher.js';
import { convergeDynamicProperties } from './draft-planner.js';
import { prepareEditPayload, verifyDraftDetail } from './draft-guard.js';

function createCompatCategoryResolver({ runtime } = {}) {
  return Object.freeze({
    async resolve(catIds, { apiBase, signal } = {}) {
      const catId3 = catIds?.catId3 ?? catIds?.catID3 ?? catIds?.catID;
      const catId1 = catIds?.catId1 ?? catIds?.catID1;
      const catId2 = catIds?.catId2 ?? catIds?.catID2;
      const category = await resolvePddCategory(catId3, catId1, catId2, { apiBase, runtime, signal });
      return {
        ...category,
        searchText: buildCategorySearchText(category),
      };
    },
  });
}

/**
 * Fallback GoodsPublishPort builder when caller ctx omits runtime.ports.goodsPublish.
 */
export function createCompatGoodsPublishPort(ctx = {}) {
  const clock = ctx.runtime?.clock ?? ctx.clock;
  const sourceFetcher = ctx.sourceFetcher ?? createSourceProductFetcher({
    sourceCache: ctx.sourceGoodsCache,
    scrapeCooldown: ctx.scrapeCooldown ?? ctx.runtime?.scrapeCooldown,
    sourceProxyEnv: ctx.runtime?.env?.sourceProxyEnv ?? {},
    scrapeSimulate: ctx.runtime?.env?.scrapeSimulate ?? true,
    browserPort: ctx.runtime?.ports?.browser,
    browserSession: ctx.browserSession,
    legacyBrowser: ctx.context?.browser?.(),
    sleep: clock?.sleep,
    now: clock?.now,
    log: ctx.log,
  });

  const categoryResolver = createCompatCategoryResolver({ runtime: ctx.runtime });

  const draftEditor = createLiveMerchantDraftEditor({
    endpoint: ctx.client,
    writeRateTokensPerMinute: ctx.runtimeConfig?.writeRateTokensPerMinute ?? 20,
    mode: ctx.runtime?.mode ?? 'live',
    clock,
    log: ctx.log,
    convergeDynamic: convergeDynamicProperties,
    preparePayload: prepareEditPayload,
    verifyDetail: verifyDraftDetail,
  });

  return Object.freeze({ sourceFetcher, categoryResolver, draftEditor });
}
