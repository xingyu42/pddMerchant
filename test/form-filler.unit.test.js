import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import {
  countSkuCombinations,
  fillPrices,
  mapSkuTableColumns,
  matchSkuPricingToTableRows,
  parseProperties,
  normalizeCategoryText,
  pickCategoryOptionIndex,
  validateDraftEditPayload,
} from '../src/adapter/goods-publish/form-filler.js';

describe('countSkuCombinations', () => {
  it('counts the Cartesian product of SKU dimensions', () => {
    assert.equal(countSkuCombinations([
      { name: '颜色', values: ['白', '黑'] },
      { name: '尺码', values: ['S', 'M', 'L'] },
    ]), 6);
  });

  it('treats no dimensions as a single SKU', () => {
    assert.equal(countSkuCombinations([]), 1);
  });
});

describe('mapSkuTableColumns', () => {
  it('locates stock and prices by header meaning instead of global input order', () => {
    assert.deepEqual(
      mapSkuTableColumns(['颜色分类', '身高', '*库存', '*拼单价(元)', '*单买价(元)', '规格编码']),
      { stock: 2, groupPrice: 3, singlePrice: 4 },
    );
  });
});

describe('validateDraftEditPayload', () => {
  const expectedSkuPricing = [{
    sourceSkuId: 'sku-red-90',
    specValues: { 颜色分类: '红色', 身高: '90cm' },
    groupPrice: '16.90',
    singlePrice: '18.90',
    stock: 7,
  }];
  const expectedPropertyPlan = [{
    templatePid: 471217,
    templateModuleId: 72984,
    pid: 7,
    controlType: 1,
    values: [{ vid: 100, value: '棉' }],
  }];
  const expectedSkuPreviewPlan = [{
    merchantColor: '红色',
    uploadedImageUrl: 'https://img.pddpic.com/uploaded-red.jpg',
  }];

  it('accepts a complete payload whose SKU values match the source plan', () => {
    const result = validateDraftEditPayload({
      goods_name: '测试商品',
      gallery: ['image'],
      cost_template_id: 123,
      goods_properties: [{
        template_pid: 471217,
        template_module_id: 72984,
        pid: 7,
        vid: 100,
        value: '平台格式化显示文本',
      }],
      skus: [{
        spec: '红色,90',
        multi_price: 1690,
        price: 1890,
        quantity_delta: 7,
        thumb_url: 'https://img.pddpic.com/uploaded-red.jpg',
      }],
    }, {
      expectedCostTemplateId: 123,
      expectedSkuPricing,
      expectedPropertyPlan,
      expectedSkuPreviewPlan,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.summary, {
      gallery_count: 1,
      goods_property_count: 1,
      goods_property_expected_value_count: 1,
      goods_property_expected_enumerated_value_count: 1,
      goods_property_matched_value_count: 1,
      sku_count: 1,
      sku_thumb_count: 1,
    });
  });

  it('still requires text for non-enumerated properties', () => {
    const result = validateDraftEditPayload({
      goods_name: '测试商品',
      gallery: ['image'],
      cost_template_id: 123,
      goods_properties: [{
        template_pid: 471218,
        template_module_id: 72984,
        pid: 8,
        vid: 0,
        value: '',
      }],
      skus: [{ spec: '红色,90', multi_price: 1690, price: 1890, quantity_delta: 7 }],
    }, {
      expectedPropertyPlan: [{
        templatePid: 471218,
        templateModuleId: 72984,
        pid: 8,
        controlType: 0,
        values: [{ vid: 0, value: '货号-001' }],
      }],
    });

    assert.ok(result.issues.includes('goods_property_mismatch'));
  });

  it('rejects zero prices, missing stock, and mismatched source combinations', () => {
    const result = validateDraftEditPayload({
      goods_name: '测试商品',
      gallery: ['image'],
      cost_template_id: 123,
      skus: [{ spec: '蓝色,100', multi_price: 0, price: 0 }],
    }, { expectedCostTemplateId: 123, expectedSkuPricing });

    assert.equal(result.ok, false);
    assert.ok(result.issues.includes('sku_group_price_invalid'));
    assert.ok(result.issues.includes('sku_single_price_invalid'));
    assert.ok(result.issues.includes('sku_stock_missing'));
    assert.ok(result.issues.includes('sku_combination_mismatch'));
  });

  it('rejects missing/mismatched properties and SKU preview images', () => {
    const result = validateDraftEditPayload({
      goods_name: '测试商品',
      gallery: ['image'],
      cost_template_id: 123,
      goods_properties: [],
      skus: [{
        spec: '红色,90',
        multi_price: 1690,
        price: 1890,
        quantity_delta: 7,
        thumb_url: 'https://img.pddpic.com/wrong.jpg',
      }],
    }, {
      expectedCostTemplateId: 123,
      expectedSkuPricing,
      expectedPropertyPlan,
      expectedSkuPreviewPlan,
    });

    assert.equal(result.ok, false);
    assert.ok(result.issues.includes('goods_properties_missing'));
    assert.ok(result.issues.includes('goods_property_mismatch'));
    assert.ok(result.issues.includes('sku_thumb_url_mismatch'));
  });

  it('rejects an empty SKU thumb without exposing its expected URL in issues', () => {
    const result = validateDraftEditPayload({
      goods_name: '测试商品',
      gallery: ['image'],
      cost_template_id: 123,
      goods_properties: [{
        template_pid: 471217,
        template_module_id: 72984,
        pid: 7,
        vid: 100,
        value: '棉',
      }],
      skus: [{ spec: '红色,90', multi_price: 1690, price: 1890, quantity_delta: 7, thumb_url: '' }],
    }, { expectedSkuPricing, expectedPropertyPlan, expectedSkuPreviewPlan });

    assert.ok(result.issues.includes('sku_thumb_url_missing'));
    assert.equal(JSON.stringify(result).includes('uploaded-red.jpg'), false);
  });

});

describe('matchSkuPricingToTableRows', () => {
  it('matches multi-SKU rows by visible spec values instead of array order', () => {
    const rows = [
      { texts: ['蓝色', '100', '', '', ''] },
      { texts: ['红色', '90', '', '', ''] },
    ];
    const pricing = [
      { specValues: { 颜色分类: '红色', 身高: '90cm' } },
      { specValues: { 颜色分类: '蓝色', 身高: '100cm' } },
    ];

    assert.deepEqual(matchSkuPricingToTableRows(rows, pricing), {
      ok: true,
      issue: null,
      rowIndexes: [1, 0],
    });
  });

  it('fails closed when a source combination cannot be matched uniquely', () => {
    const result = matchSkuPricingToTableRows(
      [{ texts: ['红色', '90'] }, { texts: ['红色', '90'] }],
      [{ specValues: { 颜色分类: '红色', 身高: '90' } }, { specValues: { 颜色分类: '蓝色', 身高: '100' } }],
    );

    assert.equal(result.ok, false);
    assert.equal(result.issue, 'sku_combination_mismatch');
  });
});

describe('fillPrices single-SKU form contract', () => {
  it('fills stock, group price, single price, and market price through input.fill()', async () => {
    const values = new Map();
    const fills = [];
    let activeFills = 0;
    let maxConcurrentFills = 0;
    const inputAt = (cellIndex) => ({
      count: async () => 1,
      fill: async (value) => {
        activeFills += 1;
        maxConcurrentFills = Math.max(maxConcurrentFills, activeFills);
        await Promise.resolve();
        // The live merchant input normalizes decimal text such as 19.30 -> 19.3;
        // readback must compare the numeric value, not formatting alone.
        values.set(cellIndex, cellIndex === 1 ? String(Number(value)) : String(value));
        fills.push([cellIndex, String(value)]);
        activeFills -= 1;
      },
      inputValue: async () => values.get(cellIndex) ?? '',
    });
    const row = {
      locator: () => ({
        nth: (cellIndex) => ({
          locator: () => ({ first: () => inputAt(cellIndex) }),
        }),
      }),
    };
    const rows = {
      count: async () => 1,
      evaluateAll: async () => [{
        texts: ['', '', ''],
        domCellIndexes: [0, 1, 2],
      }],
      nth: () => row,
    };
    const table = {
      innerText: async () => '库存 拼单价 单买价',
      locator: (selector) => {
        if (selector === 'thead th') return { allInnerTexts: async () => ['库存', '拼单价(元)', '单买价(元)'] };
        if (selector === 'tbody tr') return rows;
        throw new Error(`unexpected table selector: ${selector}`);
      },
    };
    const tables = { count: async () => 1, nth: () => table };
    let marketPrice = '';
    const marketInput = {
      fill: async (value) => { marketPrice = String(value); },
    };
    const page = {
      locator: (selector) => {
        if (selector === '[class*="TB_outerWrapper"]') return { count: async () => 0 };
        if (selector === 'table') return tables;
        throw new Error(`unexpected page selector: ${selector}`);
      },
      waitForSelector: async () => marketInput,
      $: async () => null,
    };
    const pricingPlan = {
      marketPrice: '34.20',
      skuPricing: [{
        sourceSkuId: 'single-sku',
        specValues: {},
        stock: 0,
        groupPrice: '19.30',
        singlePrice: '21.85',
      }],
    };
    const warnings = [];

    await fillPrices(page, {
      pricingPlan,
      pricingValidation: { ok: true, errors: [], warnings: [] },
    }, warnings, { info: () => {} });

    assert.deepEqual(fills, [[0, '0'], [1, '19.30'], [2, '21.85']]);
    assert.equal(maxConcurrentFills, 1);
    assert.equal(marketPrice, '34.20');
    assert.deepEqual(warnings, []);
  });
});

// ---------------------------------------------------------------------------
// parseProperties（商品属性解析）
// ---------------------------------------------------------------------------
describe('parseProperties', () => {
  it('extracts "name：value" pairs (fullwidth colon)', () => {
    const result = parseProperties('材质：纯棉\n适用年龄：3-6岁');
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { name: '材质', value: '纯棉' });
    assert.deepEqual(result[1], { name: '适用年龄', value: '3-6岁' });
  });

  it('extracts "name: value" pairs (halfwidth colon)', () => {
    const result = parseProperties('品牌: 无品牌');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { name: '品牌', value: '无品牌' });
  });

  it('returns empty array for empty / null / non-string', () => {
    assert.deepEqual(parseProperties(''), []);
    assert.deepEqual(parseProperties(null), []);
    assert.deepEqual(parseProperties(undefined), []);
    assert.deepEqual(parseProperties(123), []);
  });

  it('deduplicates by property name (first wins)', () => {
    const result = parseProperties('材质：纯棉，材质：涤纶');
    assert.equal(result.length, 1);
    assert.equal(result[0].value, '纯棉');
  });

  it('stops value at punctuation boundary', () => {
    const result = parseProperties('材质：纯棉，其他无关文字');
    assert.equal(result[0].value, '纯棉');
  });

  it('ignores lines without a colon separator', () => {
    const result = parseProperties('这是一段没有分隔符的描述文字');
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// normalizeCategoryText / pickCategoryOptionIndex（回归保护）
// ---------------------------------------------------------------------------
describe('normalizeCategoryText', () => {
  it('strips whitespace and normalizes fullwidth ＞ to >', () => {
    assert.equal(normalizeCategoryText(' 女装 ＞ 连衣裙 '), '女装>连衣裙');
  });
});

describe('pickCategoryOptionIndex', () => {
  it('prefers exact full-path match', () => {
    const opts = ['女装 > 连衣裙', '童装 > 连衣裙'];
    assert.equal(pickCategoryOptionIndex(opts, '童装 > 连衣裙'), 1);
  });

  it('returns -1 on ambiguous leaf-only match', () => {
    const opts = ['女装 > 连衣裙', '童装 > 连衣裙'];
    assert.equal(pickCategoryOptionIndex(opts, '连衣裙'), -1);
  });

  it('accepts unique suffix match', () => {
    const opts = ['女装 > 半身裙', '童装 > 连衣裙'];
    assert.equal(pickCategoryOptionIndex(opts, '连衣裙'), 1);
  });
});
