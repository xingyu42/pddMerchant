import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import {
  createLiveDraftSession,
  createLiveMerchantDraftEditor,
} from '../../src/adapter/goods-publish/merchant-draft-editor.js';
import { GOODS_PUBLISH_SUBMIT, GOODS_PUBLISH_TEMPLATE } from '../../src/adapter/endpoints/goods-publish.js';
import { convergeDynamicProperties } from '../../src/services/goods-publish/draft-planner.js';
import { prepareEditPayload, verifyDraftDetail } from '../../src/services/goods-publish/draft-guard.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';
import { captchaDetected, ExitCodes, PddCliError } from '../../src/infra/errors.js';

function makeInitialTemplate() {
  return {
    id: 9001,
    modules: [
      {
        id: 8001,
        propertys: [
          {
            id: 1001,
            pid: 2001,
            ref_pid: '101',
            name_alias: '面料俗称',
            required: true,
            is_important: false,
            control_type: 1,
            value_type: 0,
            choose_max_num: 1,
            values: [{ vid: 10011, value: '棉' }],
          },
        ],
      },
    ],
  };
}

describe('MerchantDraftEditorPort (LiveMerchantDraftEditor + DraftSession)', () => {
  it('openDraft selects category, checks risk control, loads initialTemplate via EndpointPort, and returns { draft, initialTemplate }', async () => {
    const order = [];
    const { client } = createTestCtx({
      responses: {
        [GOODS_PUBLISH_TEMPLATE.name]: makeInitialTemplate(),
      },
    });
    const fakePage = { token: 'opaque-merchant-page' };

    const editor = createLiveMerchantDraftEditor({
      endpoint: client,
      throttleEnabled: false,
      openCategoryDraft: async (page, searchText) => {
        order.push('openCategoryDraft');
        assert.equal(page, fakePage);
        assert.equal(searchText, '服饰 > 女装 > T恤');
        return { goodsCommitId: '7001', goodsId: '5001' };
      },
      checkRisk: async (page, { phase }) => {
        order.push(`risk:${phase}`);
        assert.equal(page, fakePage);
      },
    });

    const opened = await editor.openDraft({
      categorySearchText: '服饰 > 女装 > T恤',
      catId: 1003,
      page: fakePage,
    });

    assert.deepEqual(opened.draft, { goodsCommitId: '7001', goodsId: '5001' });
    assert.equal(opened.initialTemplate.ok, true);
    assert.equal(opened.initialTemplate.propertysTid, 9001);
    assert.deepEqual(order, ['openCategoryDraft', 'risk:category']);
  });

  it('populateAndSaveDraft drives declarative DraftSession through 5-round convergence, size-chart, discount, and save guards', async () => {
    const order = [];
    const session = {
      fillBaseAndMedia: vi.fn(async () => {
        order.push('fillBaseAndMedia');
        return {
          uploadedSkuPreviewPlan: [{ merchantColor: '白色', uploadedImageUrl: 'https://img.pddpic.com/w.jpg' }],
        };
      }),
      readDynamicTemplate: vi.fn(async (currentTemplate) => {
        order.push('readDynamicTemplate');
        if (session.readDynamicTemplate.mock.calls.length === 1) {
          return {
            ok: true,
            issues: [],
            propertysTid: currentTemplate.propertysTid,
            properties: [
              ...currentTemplate.properties,
              {
                templateModuleId: 8001,
                templatePid: 1002,
                pid: 2002,
                refPid: '102',
                name: '材质',
                required: true,
                important: false,
                controlType: 1,
                valueType: 0,
                chooseMaxNum: 1,
                values: [{ vid: 10021, value: '棉' }],
              },
            ],
          };
        }
        return currentTemplate;
      }),
      fillDependentProperties: vi.fn(async (addedPlan) => {
        order.push(`fillDependent:${addedPlan.map((item) => item.name).join(',')}`);
      }),
      disableSizeChart: vi.fn(async () => {
        order.push('disableSizeChart');
        return { changed: true, disabled: true };
      }),
      fillFullCountDiscount: vi.fn(async (rate) => {
        order.push(`fillFullCountDiscount:${rate}`);
        return { rate, displayValue: '8.8', payloadValue: 88 };
      }),
      saveDraft: vi.fn(async (saveOpts) => {
        order.push('saveDraft');
        assert.equal(saveOpts.strictPayload, true);
        assert.equal(saveOpts.strictVerify, true);
        assert.equal(typeof saveOpts.prepareEditPayload, 'function');
        assert.equal(typeof saveOpts.verifyDraftDetail, 'function');
        assert.deepEqual(saveOpts.expectedPropertyPlan.map((p) => p.name), ['面料俗称', '材质']);
        return {
          success: true,
          verification: { ok: true, issues: [], skipped: true, warnings: ['draft_verification_unavailable'] },
        };
      }),
      checkRiskControl: vi.fn(async (phase) => {
        order.push(`risk:${phase}`);
      }),
    };

    const editor = createLiveMerchantDraftEditor({
      throttleEnabled: false,
      createDraftSession: () => session,
      convergeDynamic: convergeDynamicProperties,
      preparePayload: prepareEditPayload,
      verifyDetail: verifyDraftDetail,
    });

    const initialTemplate = {
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
    const initialPropertyPlan = {
      ok: true,
      issues: [],
      warnings: [],
      skippedCount: 0,
      propertysTid: 9001,
      plan: [...initialTemplate.properties],
    };

    const result = await editor.populateAndSaveDraft({
      draft: { goodsCommitId: '7001', goodsId: '5001' },
      plan: {
        source: {
          goodsProperties: [
            { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
            { name: '材质', values: ['棉'], refPid: '102', referenceId: '2' },
          ],
        },
        costTemplateId: 3001,
        pricingPlan: { skuPricing: [] },
        pricingValidation: { ok: true, warnings: [] },
        skuPreviewPlan: [],
        fullCountDiscountRate: 0.88,
      },
      initialTemplate,
      initialPropertyPlan,
    });

    assert.deepEqual(order, [
      'fillBaseAndMedia',
      'risk:form',
      'readDynamicTemplate',
      'fillDependent:材质',
      'risk:form:dependent-properties',
      'readDynamicTemplate',
      'disableSizeChart',
      'risk:form:size-chart-disabled',
      'fillFullCountDiscount:0.88',
      'risk:form:full-count-discount',
      'saveDraft',
    ]);
    assert.deepEqual(result.warnings, ['draft_verification_unavailable']);
    assert.equal(result.propertyMapping.plan.length, 2);
  });

  it('submitDraft runs pre/post risk checks, abortable write throttle, and EndpointPort with draft-saved-submit-rejected hint', async () => {
    const order = [];
    const transport = createMemoryEndpointTransport({
      responses: {
        [GOODS_PUBLISH_SUBMIT.name]: { success: true, error_code: 1000000 },
      },
    });
    const { client } = createTestCtx({ transport });
    const fakePage = { token: 'opaque-page' };

    const editor = createLiveMerchantDraftEditor({
      endpoint: client,
      throttleEnabled: false,
      checkRisk: async (_page, { phase }) => {
        order.push(`risk:${phase}`);
      },
    });

    const res = await editor.submitDraft({ goodsCommitId: '7001', goodsId: '5001' }, { page: fakePage });
    assert.deepEqual(res, { success: true });
    assert.deepEqual(order, ['risk:submit:before', 'risk:submit:after']);
    assert.equal(transport.calls.length, 1);
    assert.deepEqual(transport.calls[0].params, { goods_commit_id: '7001', goods_id: '5001' });

    // Submit error uses endpoints/goods-publish.js errorMapper hint and skips submit:after
    order.length = 0;
    transport.set(GOODS_PUBLISH_SUBMIT.name, { success: false, error_code: 9876 });
    await assert.rejects(
      editor.submitDraft({ goodsCommitId: '7001', goodsId: '5001' }, { page: fakePage }),
      (err) => err instanceof PddCliError
        && err.code === 'E_BUSINESS'
        && err.hint === '保存草稿已完成，但提交发布被平台拒绝'
        && err.detail?.errorCode === 9876,
    );
    assert.deepEqual(order, ['risk:submit:before']);

    // Pre-submit risk control stops submission before EndpointPort
    const blockedEditor = createLiveMerchantDraftEditor({
      endpoint: client,
      throttleEnabled: false,
      checkRisk: async () => { throw captchaDetected({ phase: 'submit:before' }); },
    });
    transport.reset();
    await assert.rejects(
      blockedEditor.submitDraft({ goodsCommitId: '7001', goodsId: '5001' }, { page: fakePage }),
      { code: 'E_CAPTCHA_DOM' },
    );
    assert.equal(transport.calls.length, 0);

    // Post-submit risk control still detects and throws after EndpointPort call
    const postBlockedEditor = createLiveMerchantDraftEditor({
      endpoint: client,
      throttleEnabled: false,
      checkRisk: async (_page, { phase }) => {
        if (phase === 'submit:after') throw captchaDetected({ phase });
      },
    });
    transport.set(GOODS_PUBLISH_SUBMIT.name, { success: true, error_code: 1000000 });
    await assert.rejects(
      postBlockedEditor.submitDraft({ goodsCommitId: '7001', goodsId: '5001' }, { page: fakePage }),
      (err) => err instanceof PddCliError && err.code === 'E_CAPTCHA_DOM' && err.detail?.phase === 'submit:after',
    );
    assert.equal(transport.calls.length, 1);
  });

  it('submitDraft write throttle interrupts wait immediately on AbortSignal', async () => {
    vi.useFakeTimers();
    const transport = createMemoryEndpointTransport({
      responses: { [GOODS_PUBLISH_SUBMIT.name]: { success: true } },
    });
    const { client } = createTestCtx({ transport });
    const editor = createLiveMerchantDraftEditor({
      endpoint: client,
      throttleEnabled: true,
      writeRateTokensPerMinute: 12,
      checkRisk: async () => {},
    });

    const controller = new AbortController();
    const pending = editor.submitDraft(
      { goodsCommitId: '7001', goodsId: '5001' },
      { page: {}, signal: controller.signal },
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    await assert.rejects(
      pending,
      (err) => err instanceof PddCliError && err.code === 'E_TIMEOUT' && err.exitCode === ExitCodes.NETWORK,
    );
    assert.equal(transport.calls.length, 0);
  });

  it('createLiveDraftSession delegates form operations and risk checks cleanly to page adapters', async () => {
    const calls = [];
    const fakePage = { token: 'p' };
    const session = createLiveDraftSession({
      page: fakePage,
      draft: { goodsCommitId: '7001', goodsId: '5001' },
      fillForm: async (page, source, warnings, opts) => {
        calls.push(['fillForm', page, source.goodsName, warnings.length, opts.propertyPlan.length]);
        return { uploadedSkuPreviewPlan: [] };
      },
      readDynamicTemplate: async (page, tpl) => {
        calls.push(['readDynamicTemplate', page, tpl.propertysTid]);
        return tpl;
      },
      fillProperties: async (page, plan) => { calls.push(['fillProperties', page, plan.length]); },
      disableChart: async (page) => { calls.push(['disableChart', page]); return { changed: false, disabled: true }; },
      fillDiscount: async (page, rate) => { calls.push(['fillDiscount', page, rate]); return { rate }; },
      saveDraftRequest: async (page, commitId) => { calls.push(['saveDraft', page, commitId]); return { success: true }; },
      checkRisk: async (page, { phase }) => { calls.push(['checkRisk', page, phase]); },
    });

    await session.fillBaseAndMedia({
      source: { goodsName: 'Tee' },
      pricingPlan: {},
      pricingValidation: { ok: true, warnings: [] },
      propertyPlan: [{}],
      skuPreviewPlan: [],
      warnings: [],
    });
    await session.readDynamicTemplate({ propertysTid: 9001 });
    await session.fillDependentProperties([{}]);
    await session.disableSizeChart();
    await session.fillFullCountDiscount(0.95);
    await session.saveDraft({});
    await session.checkRiskControl('form');

    assert.deepEqual(calls, [
      ['fillForm', fakePage, 'Tee', 0, 1],
      ['readDynamicTemplate', fakePage, 9001],
      ['fillProperties', fakePage, 1],
      ['disableChart', fakePage],
      ['fillDiscount', fakePage, 0.95],
      ['saveDraft', fakePage, '7001'],
      ['checkRisk', fakePage, 'form'],
    ]);
  });
});
