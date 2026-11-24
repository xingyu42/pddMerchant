import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { publishGoodsFromLink } from '../../src/services/goods-publish.js';
import { PUBLISH_VIEW_FIELDS } from '../../src/services/views/goods-publish.js';
import { GOODS_PUBLISH_COST_TEMPLATE_LIST } from '../../src/adapter/endpoints/goods-publish.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';

function makeNormalizedSource() {
  return {
    goodsID: '123456',
    goodsName: 'Synthetic Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    sourceReferencePriceCents: 5900,
    carousel: ['https://img.pddpic.com/c-1.jpg'],
    skuText: '颜色\n白色',
    skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
    skus: [
      {
        sourceSkuId: 'sku-w',
        specValues: { 颜色: '白色' },
        sourcePriceCents: 1470,
        sourceNormalPriceCents: 2580,
        stock: 10,
        thumbUrl: 'https://img.pddpic.com/white.jpg',
      },
    ],
    goodsProperties: [{ name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' }],
    properties: '',
    detailImgs: ['https://img.pddpic.com/d-1.jpg'],
  };
}

function makeTemplate() {
  return {
    ok: true,
    issues: [],
    propertysTid: 9001,
    properties: [
      {
        templateModuleId: 8001,
        templatePid: 1001,
        pid: 2001,
        refPid: '101',
        name: '面料俗称',
        required: true,
        important: false,
        controlType: 1,
        valueType: 0,
        chooseMaxNum: 1,
        values: [{ vid: 10011, value: '棉' }],
      },
    ],
  };
}

function makeInMemoryGoodsPublishPort({ cacheHit = false, overrides = {} } = {}) {
  const clearCache = vi.fn(async () => {});
  return {
    clearCache,
    port: {
      sourceFetcher: {
        prepare: vi.fn(async () => ({
          goodsId: '123456',
          cacheHit,
          warnings: [],
          fetch: vi.fn(async () => makeNormalizedSource()),
          clearCache,
        })),
        ...overrides.sourceFetcher,
      },
      categoryResolver: {
        resolve: vi.fn(async () => ({
          root: '服饰',
          cates: ['服饰', '女装', 'T恤'],
          cat_id: 1003,
          cat_ids: [1001, 1002, 1003, null],
          cats: ['服饰', '女装', 'T恤', null],
          searchText: '服饰 > 女装 > T恤',
        })),
        ...overrides.categoryResolver,
      },
      draftEditor: {
        openDraft: vi.fn(async () => ({
          draft: { goodsCommitId: '7001', goodsId: '5001' },
          initialTemplate: makeTemplate(),
        })),
        populateAndSaveDraft: vi.fn(async ({ initialPropertyPlan, warnings }) => {
          warnings.push('draft_verification_unavailable');
          return {
            propertyMapping: initialPropertyPlan,
            uploadedSkuPreviewPlan: [{ merchantColor: '白色', uploadedImageUrl: 'https://img.pddpic.com/u-1.jpg' }],
            warnings,
          };
        }),
        submitDraft: vi.fn(async () => ({ success: true })),
        ...overrides.draftEditor,
      },
    },
  };
}

describe('publishGoodsFromLink via GoodsPublishPort seam', () => {
  it('completes draft and --confirm publish passing only opaque ctx.page token with zero Playwright page calls', async () => {
    const opaquePage = Object.freeze({ opaqueToken: 'merchant-page-token' });
    const transport = createMemoryEndpointTransport({
      responses: {
        [GOODS_PUBLISH_COST_TEMPLATE_LIST.name]: { cost_template_list: [{ id: 3001, name: '包邮' }] },
      },
    });
    const { port, clearCache } = makeInMemoryGoodsPublishPort({ cacheHit: false });
    const ctx = createTestCtx({
      transport,
      page: opaquePage,
      mallId: '900001',
      runtimeConfig: { fullCountDiscountRate: 0.95, categoryApiBase: 'https://category.invalid' },
      runtime: {
        mode: 'live',
        env: { imageTransform: false },
        ports: { goodsPublish: port },
      },
    });

    const draftResult = await publishGoodsFromLink(ctx, '123456', { draftOnly: true });
    assert.deepEqual(Object.keys(draftResult.data).sort(), [...PUBLISH_VIEW_FIELDS].sort());
    assert.equal(draftResult.data.status, '草稿');
    assert.deepEqual(draftResult.warnings, ['draft_verification_unavailable']);
    assert.equal(port.draftEditor.submitDraft.mock.calls.length, 0);
    assert.equal(clearCache.mock.calls.length, 1);
    assert.equal(transport.calls[0].page, opaquePage);

    const submittedResult = await publishGoodsFromLink(ctx, '123456', { draftOnly: false });
    assert.equal(submittedResult.data.status, '已提交');
    assert.equal(port.draftEditor.submitDraft.mock.calls.length, 1);
    assert.equal(port.draftEditor.submitDraft.mock.calls[0][1].page, opaquePage);
  });

  it('attaches redacted detail.stage and detail.source_cached on thrown PddCliErrors and strips sensitive fields', async () => {
    const transport = createMemoryEndpointTransport({
      responses: {
        [GOODS_PUBLISH_COST_TEMPLATE_LIST.name]: { cost_template_list: [{ id: 3001, name: '包邮' }] },
      },
    });
    const { port: cacheHitPort } = makeInMemoryGoodsPublishPort({
      cacheHit: true,
      overrides: {
        draftEditor: {
          openDraft: vi.fn(async () => {
            throw new PddCliError({
              code: 'E_BUSINESS',
              message: '开草稿失败',
              detail: {
                url: 'https://mms.pinduoduo.com/goods/category?uin=SECRET_UIN&token=abc',
                proxy: 'http://198.51.100.9:42001',
                authKey: 'secret-auth-key',
                imageUrl: 'https://img.pddpic.com/secret.jpg',
                __reactFiber$xyz: { stateNode: {} },
                issue: 'category_not_found',
              },
              exitCode: ExitCodes.BUSINESS,
            });
          }),
        },
      },
    });

    const ctx = createTestCtx({
      transport,
      page: { opaqueToken: 'p' },
      mallId: '900001',
      runtimeConfig: { fullCountDiscountRate: 0.95 },
      runtime: { mode: 'live', env: {}, ports: { goodsPublish: cacheHitPort } },
    });

    let caught;
    try {
      await publishGoodsFromLink(ctx, '123456');
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof PddCliError);
    assert.equal(caught.detail.stage, 'open_draft');
    assert.equal(caught.detail.source_cached, true);
    assert.equal(caught.detail.issue, 'category_not_found');
    assert.equal(caught.detail.url, '/goods/category');
    const serialized = JSON.stringify(caught.detail);
    assert.equal(serialized.includes('SECRET_UIN'), false);
    assert.equal(serialized.includes('198.51.100.9'), false);
    assert.equal(serialized.includes('secret-auth-key'), false);
    assert.equal(serialized.includes('img.pddpic.com/secret.jpg'), false);
    assert.equal(serialized.includes('__reactFiber'), false);
  });

  it('records source_cached=false when scrape_source or submit_draft fails on cache miss', async () => {
    const transport = createMemoryEndpointTransport({
      responses: {
        [GOODS_PUBLISH_COST_TEMPLATE_LIST.name]: { cost_template_list: [{ id: 3001, name: '包邮' }] },
      },
    });
    const { port: missPort } = makeInMemoryGoodsPublishPort({
      cacheHit: false,
      overrides: {
        draftEditor: {
          submitDraft: vi.fn(async () => {
            throw new PddCliError({
              code: 'E_BUSINESS',
              message: '提交被拒',
              hint: '保存草稿已完成，但提交发布被平台拒绝',
              detail: { errorCode: 9876 },
              exitCode: ExitCodes.BUSINESS,
            });
          }),
        },
      },
    });

    const ctx = createTestCtx({
      transport,
      page: { opaqueToken: 'p' },
      mallId: '900001',
      runtimeConfig: { fullCountDiscountRate: 0.95 },
      runtime: { mode: 'live', env: {}, ports: { goodsPublish: missPort } },
    });

    await assert.rejects(
      publishGoodsFromLink(ctx, '123456', { draftOnly: false }),
      (err) => err instanceof PddCliError
        && err.detail?.stage === 'submit_draft'
        && err.detail?.source_cached === false
        && err.detail?.errorCode === 9876,
    );
  });
});
