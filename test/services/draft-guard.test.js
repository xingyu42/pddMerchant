import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import {
  validateDraftEditPayload,
  prepareEditPayload,
  normalizeDraftDetailResponse,
  verifyDraftDetail,
} from '../../src/services/goods-publish/draft-guard.js';

function makeValidPropertyPlan() {
  return [
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
    {
      templateModuleId: 8001,
      templatePid: 1002,
      pid: 2002,
      refPid: '',
      name: '货号',
      required: false,
      important: false,
      controlType: 0,
      valueType: 0,
      chooseMaxNum: 1,
      values: [{ vid: null, value: 'TEE-2026' }],
    },
  ];
}

function makeValidSkuPricing() {
  return [
    {
      sourceSkuId: 'sku-w-110',
      specValues: { 颜色: '白色', 尺码: '110cm' },
      sourcePriceCents: 1470,
      groupPrice: '14.70',
      singlePrice: '25.80',
      stock: 10,
    },
    {
      sourceSkuId: 'sku-b-110',
      specValues: { 颜色: '黑色', 尺码: '110cm' },
      sourcePriceCents: 1600,
      groupPrice: '16.00',
      singlePrice: '28.00',
      stock: 0,
    },
  ];
}

function makeValidPreviewPlan() {
  return [
    { merchantColor: '白色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-white.jpg?token=SECRET_IMG' },
    { merchantColor: '黑色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-black.jpg?token=SECRET_IMG' },
  ];
}

function makeValidEditBody(overrides = {}) {
  return {
    goods_name: 'Pure Cotton Tee',
    gallery: [{ url: 'https://img.pddpic.com/carousel-1.jpg?uin=SECRET_UIN' }],
    cost_template_id: 3001,
    two_pieces_discount: 88,
    goods_properties: [
      { template_module_id: 8001, template_pid: 1001, pid: 2001, vid: 10011, value: 'formatted-label' },
      { template_module_id: 8001, template_pid: 1002, pid: 2002, value: 'TEE-2026' },
    ],
    skus: [
      {
        spec: [{ spec_value: '白色' }, { spec_value: '110' }],
        multi_price: 1470,
        price: 2580,
        quantity_delta: 10,
        thumb_url: 'https://img.pddpic.com/uploaded-white.jpg?token=SECRET_IMG',
      },
      {
        spec: [{ spec_value: '黑色' }, { spec_value: '110' }],
        multi_price: 1600,
        price: 2800,
        quantity_delta: 0,
        thumb_url: 'https://img.pddpic.com/uploaded-black.jpg?token=SECRET_IMG',
      },
    ],
    ...overrides,
  };
}

function makeValidationOptions(overrides = {}) {
  return {
    expectedCostTemplateId: 3001,
    expectedFullCountDiscountRate: 0.88,
    expectedPropertyPlan: makeValidPropertyPlan(),
    expectedSkuPricing: makeValidSkuPricing(),
    expectedSkuPreviewPlan: makeValidPreviewPlan(),
    ...overrides,
  };
}

describe('draft-guard', () => {
  describe('validateDraftEditPayload & prepareEditPayload', () => {
    it('injects cost_template_id and accepts valid payload including enumerated vid-only match, cm normalization, and stock=0', () => {
      const body = makeValidEditBody();
      delete body.cost_template_id;
      const prepared = prepareEditPayload(JSON.stringify(body), {
        ...makeValidationOptions(),
        costTemplateId: 3001,
        strictPayload: true,
      });
      assert.equal(prepared.body.cost_template_id, 3001);
      assert.equal(prepared.validation.ok, true);
      assert.deepEqual(prepared.validation.issues, []);
      assert.deepEqual(prepared.validation.summary, {
        gallery_count: 1,
        goods_property_count: 2,
        goods_property_expected_value_count: 2,
        goods_property_expected_enumerated_value_count: 1,
        goods_property_matched_value_count: 2,
        sku_count: 2,
        sku_thumb_count: 2,
      });
    });

    it.each([
      { label: 'empty string body', rawBody: '', expectedFragment: '为空' },
      { label: 'null body', rawBody: null, expectedFragment: '为空' },
      { label: 'malformed JSON with secret URL', rawBody: '{https://img.pddpic.com/secret.jpg?uin=RAW_SECRET', expectedFragment: '不是 JSON' },
    ])('rejects $label with E_BUSINESS without leaking raw payload or URLs', ({ rawBody, expectedFragment }) => {
      let caught;
      try {
        prepareEditPayload(rawBody, { costTemplateId: 3001, strictPayload: true });
      } catch (err) {
        caught = err;
      }
      assert.ok(caught instanceof PddCliError);
      assert.equal(caught.code, 'E_BUSINESS');
      assert.equal(caught.exitCode, ExitCodes.BUSINESS);
      assert.ok(caught.message.includes(expectedFragment));
      assert.equal(caught.message.includes('RAW_SECRET'), false);
      assert.equal(JSON.stringify(caught.detail).includes('RAW_SECRET'), false);
    });

    it.each([
      { label: 'title_empty', patchBody: { goods_name: '   ' }, expectedIssue: 'title_empty' },
      { label: 'no_images', patchBody: { gallery: [] }, expectedIssue: 'no_images' },
      { label: 'no_cost_template', patchBody: { cost_template_id: '' }, patchOpts: { expectedCostTemplateId: null }, expectedIssue: 'no_cost_template' },
      { label: 'cost_template_mismatch', patchBody: { cost_template_id: 9999 }, expectedIssue: 'cost_template_mismatch' },
      { label: 'full_count_discount_missing', patchBody: { two_pieces_discount: null }, expectedIssue: 'full_count_discount_missing' },
      { label: 'full_count_discount_mismatch', patchBody: { two_pieces_discount: 95 }, expectedIssue: 'full_count_discount_mismatch' },
      { label: 'no_skus', patchBody: { skus: [] }, expectedIssue: 'no_skus' },
      {
        label: 'sku_group_price_invalid',
        patchBody: { skus: [{ ...makeValidEditBody().skus[0], multi_price: 0 }, makeValidEditBody().skus[1]] },
        expectedIssue: 'sku_group_price_invalid',
      },
      {
        label: 'sku_single_price_invalid',
        patchBody: { skus: [{ ...makeValidEditBody().skus[0], price: -10 }, makeValidEditBody().skus[1]] },
        expectedIssue: 'sku_single_price_invalid',
      },
      {
        label: 'sku_stock_missing',
        patchBody: { skus: [{ ...makeValidEditBody().skus[0], quantity_delta: -1 }, makeValidEditBody().skus[1]] },
        expectedIssue: 'sku_stock_missing',
      },
      { label: 'goods_properties_missing', patchBody: { goods_properties: [] }, expectedIssue: 'goods_properties_missing' },
      {
        label: 'goods_property_mismatch on enumerated vid',
        patchBody: {
          goods_properties: [
            { template_module_id: 8001, template_pid: 1001, pid: 2001, vid: 99999, value: '棉' },
            { template_module_id: 8001, template_pid: 1002, pid: 2002, value: 'TEE-2026' },
          ],
        },
        expectedIssue: 'goods_property_mismatch',
      },
      {
        label: 'goods_property_mismatch on free-input text',
        patchBody: {
          goods_properties: [
            { template_module_id: 8001, template_pid: 1001, pid: 2001, vid: 10011, value: '棉' },
            { template_module_id: 8001, template_pid: 1002, pid: 2002, value: 'WRONG-SKU' },
          ],
        },
        expectedIssue: 'goods_property_mismatch',
      },
      {
        label: 'sku_combination_count_mismatch',
        patchBody: { skus: [makeValidEditBody().skus[0]] },
        expectedIssue: 'sku_combination_count_mismatch',
      },
      {
        label: 'sku_combination_mismatch',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], spec: [{ spec_value: '红色' }, { spec_value: '110' }] },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_combination_mismatch',
      },
      {
        label: 'sku_group_price_mismatch',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], multi_price: 1500 },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_group_price_mismatch',
      },
      {
        label: 'sku_single_price_mismatch',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], price: 2590 },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_single_price_mismatch',
      },
      {
        label: 'sku_stock_mismatch',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], quantity_delta: 9 },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_stock_mismatch',
      },
      {
        label: 'sku_thumb_url_missing',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], thumb_url: '' },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_thumb_url_missing',
      },
      {
        label: 'sku_thumb_url_mismatch (canonical bypass rejected)',
        patchBody: {
          skus: [
            { ...makeValidEditBody().skus[0], thumb_url: 'https://img.pddpic.com/reloaded-canonical.jpg' },
            makeValidEditBody().skus[1],
          ],
        },
        expectedIssue: 'sku_thumb_url_mismatch',
      },
    ])('detects outbound issue $label and redacts URLs/secrets from thrown error', ({ patchBody, patchOpts, expectedIssue }) => {
      const body = makeValidEditBody(patchBody);
      const opts = makeValidationOptions(patchOpts);
      const checked = validateDraftEditPayload(body, opts);
      assert.equal(checked.ok, false);
      assert.ok(checked.issues.includes(expectedIssue), JSON.stringify(checked.issues));

      let caught;
      try {
        prepareEditPayload(JSON.stringify(body), {
          ...opts,
          costTemplateId: body.cost_template_id,
          strictPayload: true,
        });
      } catch (err) {
        caught = err;
      }
      if (expectedIssue !== 'no_cost_template') {
        assert.ok(caught instanceof PddCliError);
        assert.equal(caught.code, 'E_BUSINESS');
        assert.ok(caught.detail.issues.includes(expectedIssue));
        const serialized = JSON.stringify({ message: caught.message, hint: caught.hint, detail: caught.detail });
        assert.equal(serialized.includes('SECRET_IMG'), false);
        assert.equal(serialized.includes('SECRET_UIN'), false);
        assert.equal(serialized.includes('https://img.pddpic.com'), false);
      }
    });
  });

  describe('normalizeDraftDetailResponse & verifyDraftDetail', () => {
    it.each([
      {
        label: 'result wrapper',
        response: { http_status: 200, http_ok: true, payload: { success: true, error_code: 1000000, result: { goods_name: 'Tee', cost_template_id: 3001, gallery: ['a'], two_pieces_discount: 88 } } },
        expectedPath: 'result',
      },
      {
        label: 'result.data wrapper',
        response: { success: true, result: { data: { goodsName: 'Tee', costTemplateId: 3001, gallery: ['a'] } } },
        expectedPath: 'result.data',
      },
      {
        label: 'data wrapper',
        response: { data: { goods_name: 'Tee', cost_template_id: 3001, gallery: ['a'] } },
        expectedPath: 'data',
      },
      {
        label: 'data.result wrapper',
        response: { data: { result: { goods_name: 'Tee', cost_template_id: 3001, gallery: ['a'] } } },
        expectedPath: 'data.result',
      },
      {
        label: 'flat root object',
        response: { goods_name: 'Tee', cost_template_id: 3001, gallery: ['a'] },
        expectedPath: 'root',
      },
    ])('normalizes available draft detail shape ($label) and tolerates omitted two_pieces_discount', ({ response, expectedPath }) => {
      const normalized = normalizeDraftDetailResponse(response);
      assert.equal(normalized.available, true);
      assert.equal(normalized.observation.candidate_path, expectedPath);

      const verified = verifyDraftDetail(response, {
        goodsCommitId: '7001',
        expectedCostTemplateId: 3001,
        expectedFullCountDiscountRate: 0.88,
        strictVerify: true,
      });
      assert.equal(verified.ok, true);
      assert.equal(verified.skipped, false);
      assert.deepEqual(verified.warnings, []);
    });

    it.each([
      {
        label: 'HTTP failure',
        response: { http_status: 500, http_ok: false, payload: { result: null } },
        expectedReason: 'http_failure',
      },
      {
        label: 'business failure (success=false)',
        response: { http_status: 200, http_ok: true, payload: { success: false, error_code: 40001, result: null } },
        expectedReason: 'business_failure',
      },
      {
        label: 'null result',
        response: { http_status: 200, http_ok: true, payload: { success: true, error_code: 1000000, result: null } },
        expectedReason: 'result_unavailable',
      },
      {
        label: 'transport error',
        response: new Error('network timeout'),
        expectedReason: 'transport_error',
      },
    ])('degrades $label to draft_verification_unavailable without false field-empty issues even under strictVerify', ({ response, expectedReason }) => {
      const verified = verifyDraftDetail(response, {
        goodsCommitId: '7001',
        expectedCostTemplateId: 3001,
        expectedFullCountDiscountRate: 0.88,
        strictVerify: true,
      });
      assert.equal(verified.ok, true);
      assert.equal(verified.skipped, true);
      assert.deepEqual(verified.issues, []);
      assert.deepEqual(verified.warnings, ['draft_verification_unavailable']);
      assert.equal(verified.observation.reason, expectedReason);
    });

    it.each([
      {
        label: 'confirmed title_empty',
        detail: { goods_name: '', cost_template_id: 3001, gallery: ['a'] },
        expectedIssue: 'title_empty',
      },
      {
        label: 'confirmed no_cost_template',
        detail: { goods_name: 'Tee', cost_template_id: null, gallery: ['a'] },
        expectedIssue: 'no_cost_template',
      },
      {
        label: 'confirmed cost_template_mismatch',
        detail: { goods_name: 'Tee', cost_template_id: 9999, gallery: ['a'] },
        expectedIssue: 'cost_template_mismatch',
      },
      {
        label: 'confirmed full_count_discount_mismatch',
        detail: { goods_name: 'Tee', cost_template_id: 3001, gallery: ['a'], two_pieces_discount: 95 },
        expectedIssue: 'full_count_discount_mismatch',
      },
      {
        label: 'confirmed no_images',
        detail: { goods_name: 'Tee', cost_template_id: 3001, gallery: [] },
        expectedIssue: 'no_images',
      },
    ])('rejects $label with E_BUSINESS under strictVerify', ({ detail, expectedIssue }) => {
      const response = { success: true, error_code: 1000000, result: detail };
      const nonStrict = verifyDraftDetail(response, {
        goodsCommitId: '7001',
        expectedCostTemplateId: 3001,
        expectedFullCountDiscountRate: 0.88,
        strictVerify: false,
      });
      assert.equal(nonStrict.ok, false);
      assert.ok(nonStrict.issues.includes(expectedIssue));

      assert.throws(
        () => verifyDraftDetail(response, {
          goodsCommitId: '7001',
          expectedCostTemplateId: 3001,
          expectedFullCountDiscountRate: 0.88,
          strictVerify: true,
        }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.exitCode === ExitCodes.BUSINESS
          && err.detail?.goods_commit_id === '7001'
          && err.detail?.issues?.includes(expectedIssue),
      );
    });
  });
});
