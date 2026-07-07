import { vi, describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGoodsUrl, validateScrapedData, parseSkuText, isPriceMasked } from '../src/adapter/goods-publish/source-scraper.js';
import {
  normalizePropertyText,
  parsePropertiesText,
  matchGoodsProperties,
} from '../src/services/goods-publish/property-matcher.js';
import {
  buildGoodsEditPayload,
  buildDecorationPayload,
} from '../src/services/goods-publish/payload-builder.js';
import { mapSourceSkus } from '../src/services/goods-publish/sku-mapper.js';
import { mapPublishBusinessError } from '../src/adapter/endpoints/goods-publish.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');

function loadFixture(rel) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, rel), 'utf8'));
}

// ---------------------------------------------------------------------------
// parseGoodsUrl
// ---------------------------------------------------------------------------
describe('parseGoodsUrl', () => {
  it('accepts pure numeric string', () => {
    assert.equal(parseGoodsUrl('918867803697'), '918867803697');
  });

  it('extracts goods_id from full mobile URL', () => {
    assert.equal(
      parseGoodsUrl('https://mobile.yangkeduo.com/goods.html?goods_id=12345'),
      '12345'
    );
  });

  it('extracts goods_id from goods1.html format', () => {
    assert.equal(
      parseGoodsUrl('https://mobile.yangkeduo.com/goods1.html?goods_id=99999&refer_page_name=search_result'),
      '99999'
    );
  });

  it('extracts goods_id from yangkeduo.com domain', () => {
    assert.equal(
      parseGoodsUrl('https://yangkeduo.com/goods.html?goods_id=55555'),
      '55555'
    );
  });

  it('throws E_USAGE for invalid string', () => {
    assert.throws(
      () => parseGoodsUrl('not-a-valid-thing'),
      (e) => e.code === 'E_USAGE'
    );
  });

  it('throws E_USAGE for empty string', () => {
    assert.throws(
      () => parseGoodsUrl(''),
      (e) => e.code === 'E_USAGE'
    );
  });

  it('throws E_USAGE for null', () => {
    assert.throws(
      () => parseGoodsUrl(null),
      (e) => e.code === 'E_USAGE'
    );
  });
});

// ---------------------------------------------------------------------------
// validateScrapedData
// ---------------------------------------------------------------------------
describe('validateScrapedData', () => {
  const validData = {
    goodsName: '汪汪队衣服',
    catID3: '15000',
    carousel: ['https://img.pddpic.com/test.jpg'],
  };

  it('passes with complete data', () => {
    assert.doesNotThrow(() => validateScrapedData(validData));
  });

  it('throws E_BUSINESS when goodsName is missing', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, goodsName: '' }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when both catID and catID3 are missing', () => {
    assert.throws(
      () => validateScrapedData({ goodsName: '商品', carousel: ['https://x.com/a.jpg'] }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when carousel is empty array', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, carousel: [] }),
      (e) => e.code === 'E_BUSINESS'
    );
  });

  it('throws E_BUSINESS when carousel is not array', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, carousel: null }),
      (e) => e.code === 'E_BUSINESS'
    );
  });
});

// ---------------------------------------------------------------------------
// isPriceMasked (软风控脱敏判定)
// ---------------------------------------------------------------------------
describe('isPriceMasked', () => {
  it('treats null as masked', () => {
    assert.equal(isPriceMasked(null), true);
  });

  it('treats undefined as masked', () => {
    assert.equal(isPriceMasked(undefined), true);
  });

  it('treats empty / whitespace string as masked', () => {
    assert.equal(isPriceMasked(''), true);
    assert.equal(isPriceMasked('   '), true);
  });

  it('treats non-numeric placeholder as masked', () => {
    assert.equal(isPriceMasked('--'), true);
    assert.equal(isPriceMasked('¥**'), true);
    assert.equal(isPriceMasked('打开App查看'), true);
  });

  it('treats zero / non-positive price as masked (¥0 占位)', () => {
    assert.equal(isPriceMasked('0'), true);
    assert.equal(isPriceMasked('0.00'), true);
  });

  it('accepts valid positive numeric price strings', () => {
    assert.equal(isPriceMasked('8.22'), false);
    assert.equal(isPriceMasked('10'), false);
    assert.equal(isPriceMasked('0.01'), false);
  });
});

// ---------------------------------------------------------------------------
// normalizePropertyText
// ---------------------------------------------------------------------------
describe('normalizePropertyText', () => {
  it('strips slashes and spaces', () => {
    assert.equal(normalizePropertyText('面料/材质'), '面料材质');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(normalizePropertyText('  重要面料俗称  '), '重要面料俗称');
  });

  it('returns empty string for null', () => {
    assert.equal(normalizePropertyText(null), '');
  });

  it('lowercases ASCII chars', () => {
    assert.equal(normalizePropertyText('Brand'), 'brand');
  });
});

// ---------------------------------------------------------------------------
// parsePropertiesText
// ---------------------------------------------------------------------------
describe('parsePropertiesText', () => {
  it('parses two key:value pairs separated by newline', () => {
    const result = parsePropertiesText('品牌: 无品牌\n面料/材质: 棉');
    assert.equal(result.length, 2);
    assert.equal(result[0].key, '品牌');
    assert.deepEqual(result[0].values, ['无品牌']);
    assert.equal(result[1].key, '面料/材质');
    assert.deepEqual(result[1].values, ['棉']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parsePropertiesText(''), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parsePropertiesText(null), []);
  });

  it('parses multi-value property separated by comma', () => {
    const result = parsePropertiesText('流行元素: 印花，条纹');
    assert.equal(result.length, 1);
    assert.equal(result[0].key, '流行元素');
    assert.deepEqual(result[0].values, ['印花', '条纹']);
  });

  it('skips lines without colon separator', () => {
    const result = parsePropertiesText('no colon here\n品牌: test');
    assert.equal(result.length, 1);
    assert.equal(result[0].key, '品牌');
  });
});

// ---------------------------------------------------------------------------
// matchGoodsProperties
// ---------------------------------------------------------------------------
describe('matchGoodsProperties', () => {
  const templateFixture = loadFixture('endpoints/goods.publish.template.json');
  const sourceFixture = loadFixture('goods-publish/source.json');

  it('returns matched and unmatched arrays', () => {
    const { matched, unmatched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    assert.ok(Array.isArray(matched), 'matched should be array');
    assert.ok(Array.isArray(unmatched), 'unmatched should be array');
  });

  it('matches at least one property from source', () => {
    const { matched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    assert.ok(matched.length > 0, `expected some matched props, got ${matched.length}`);
  });

  it('matched items contain required fields', () => {
    const { matched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    for (const m of matched) {
      assert.ok('vid' in m, 'matched item should have vid');
      assert.ok('pid' in m, 'matched item should have pid');
    }
  });

  it('unmatched items include required flag', () => {
    const { unmatched } = matchGoodsProperties(
      sourceFixture.properties,
      templateFixture.modules
    );
    for (const u of unmatched) {
      assert.ok('required' in u, 'unmatched item should have required flag');
      assert.ok('name' in u, 'unmatched item should have name');
    }
  });

  it('throws when templateModules is not array', () => {
    assert.throws(
      () => matchGoodsProperties('品牌: 无品牌', null),
      (e) => e.code === 'E_PROPERTY_MATCH_INVALID_INPUT'
    );
  });
});

// ---------------------------------------------------------------------------
// buildGoodsEditPayload
// ---------------------------------------------------------------------------
describe('buildGoodsEditPayload', () => {
  const draft = { goods_id: 953009364304, goods_commit_id: '191512609758' };
  const scraped = loadFixture('goods-publish/source.json');
  const category = loadFixture('goods-publish/category.json');
  const matched = { matched: [], unmatched: [] };

  it('constructs valid payload structure', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, 544142245494784);
    assert.equal(payload.goods_id, draft.goods_id);
    assert.equal(payload.goods_commit_id, draft.goods_commit_id);
    assert.equal(payload.goods_name, scraped.goodsName);
    assert.ok(Array.isArray(payload.skus), 'skus should be array');
    assert.ok(typeof payload.groups === 'object', 'groups should be object');
  });

  it('converts price string to cents correctly', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, null);
    assert.equal(payload.skus[0].price, 822, 'price 8.22 should become 822 cents');
    assert.equal(payload.groups.single_price, 822);
  });

  it('passes goods_id and goods_commit_id through', () => {
    const payload = buildGoodsEditPayload(draft, scraped, matched, category, null);
    assert.equal(payload.goods_id, 953009364304);
    assert.equal(payload.goods_commit_id, '191512609758');
  });

  it('throws when draft is missing goods_id', () => {
    assert.throws(
      () => buildGoodsEditPayload({ goods_commit_id: '123' }, scraped, matched, category, null),
      (e) => e.code === 'E_PAYLOAD_INVALID_DRAFT'
    );
  });

  it('throws when draft is missing goods_commit_id', () => {
    assert.throws(
      () => buildGoodsEditPayload({ goods_id: 123 }, scraped, matched, category, null),
      (e) => e.code === 'E_PAYLOAD_INVALID_DRAFT'
    );
  });
});

// ---------------------------------------------------------------------------
// buildDecorationPayload
// ---------------------------------------------------------------------------
describe('buildDecorationPayload', () => {
  it('builds floor_list with image type elements', () => {
    const urls = ['https://img.pddpic.com/test-detail-1.jpg', 'https://img.pddpic.com/test-detail-2.jpg'];
    const payload = buildDecorationPayload('191512609758', 953009364304, urls);
    assert.equal(payload.floor_list.length, 2);
    assert.equal(payload.floor_list[0].type, 'image');
    assert.ok(Array.isArray(payload.floor_list[0].content_list));
    assert.equal(payload.floor_list[0].content_list[0].img_url, urls[0]);
  });

  it('returns empty floor_list for empty URL array', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, []);
    assert.deepEqual(payload.floor_list, []);
  });

  it('returns empty floor_list for null URLs', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, null);
    assert.deepEqual(payload.floor_list, []);
  });

  it('passes goods_commit_id and goods_id correctly', () => {
    const payload = buildDecorationPayload('191512609758', 953009364304, []);
    assert.equal(payload.goods_commit_id, '191512609758');
    assert.equal(payload.goods_id, 953009364304);
  });
});

// ---------------------------------------------------------------------------
// parseSkuText
// ---------------------------------------------------------------------------
describe('parseSkuText', () => {
  it('parses two-dimension text into structured array', () => {
    const result = parseSkuText('颜色分类\n白色\n黑色\n尺码\nS\nM\nL');
    assert.equal(result.length, 2);
    assert.equal(result[0].name, '颜色分类');
    assert.deepEqual(result[0].values, ['白色', '黑色']);
    assert.equal(result[1].name, '尺码');
    assert.deepEqual(result[1].values, ['S', 'M', 'L']);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseSkuText(''), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parseSkuText(null), []);
  });

  it('filters noise lines (prices, sales counts)', () => {
    const result = parseSkuText('颜色分类\n白色\n¥8.22\n已售1000\n黑色');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].values, ['白色', '黑色']);
  });

  it('single dimension produces one-element array', () => {
    const result = parseSkuText('颜色\n红色\n蓝色');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '颜色');
    assert.deepEqual(result[0].values, ['红色', '蓝色']);
  });

  it('ignores text before first dimension header', () => {
    const result = parseSkuText('一些无关文字\n请选择\n颜色分类\n白色');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].values, ['白色']);
  });

  it('omits dimension with zero values after noise filtering', () => {
    const result = parseSkuText('颜色分类\n¥9.99\n尺码\nS\nM');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '尺码');
  });
});

// ---------------------------------------------------------------------------
// mapSourceSkus
// ---------------------------------------------------------------------------
describe('mapSourceSkus', () => {
  it('returns default single SKU for empty array', () => {
    const { skus } = mapSourceSkus([], '8.22');
    assert.equal(skus.length, 1);
    assert.equal(skus[0].spec, '');
  });

  it('returns default single SKU for null', () => {
    const { skus } = mapSourceSkus(null, '8.22');
    assert.equal(skus.length, 1);
  });

  it('maps single dimension to multiple SKUs', () => {
    const specs = [{ name: '颜色分类', values: ['白色', '黑色'] }];
    const { skus } = mapSourceSkus(specs, '8.22');
    assert.equal(skus.length, 2);
    assert.equal(skus[0].spec, '颜色分类:白色');
    assert.equal(skus[1].spec, '颜色分类:黑色');
  });

  it('builds Cartesian product for two dimensions', () => {
    const specs = [
      { name: '颜色分类', values: ['白色', '黑色'] },
      { name: '尺码', values: ['S', 'M', 'L'] },
    ];
    const { skus } = mapSourceSkus(specs, '8.22');
    assert.equal(skus.length, 6);
    assert.equal(skus[0].spec, '颜色分类:白色 尺码:S');
    assert.equal(skus[5].spec, '颜色分类:黑色 尺码:L');
  });

  it('converts price to cents', () => {
    const specs = [{ name: '颜色', values: ['白色', '黑色'] }];
    const { skus, groups } = mapSourceSkus(specs, '8.22');
    assert.equal(skus[0].price, 822);
    assert.equal(groups.single_price, 822);
  });

  it('all SKUs share same price', () => {
    const specs = [{ name: '颜色', values: ['白', '黑', '红'] }];
    const { skus } = mapSourceSkus(specs, '10.00');
    for (const sku of skus) {
      assert.equal(sku.price, 1000);
    }
  });

  it('single value single dimension returns default SKU', () => {
    const specs = [{ name: '颜色', values: ['白色'] }];
    const { skus } = mapSourceSkus(specs, '5.00');
    assert.equal(skus.length, 1);
    assert.equal(skus[0].spec, '');
  });
});

// ---------------------------------------------------------------------------
// mapPublishBusinessError
// ---------------------------------------------------------------------------
describe('mapPublishBusinessError', () => {
  it('returns E_RATE_LIMIT for error_code 54001', () => {
    const err = mapPublishBusinessError({ error_code: 54001 });
    assert.equal(err.code, 'E_RATE_LIMIT');
    assert.equal(err.exitCode, 4);
  });

  it('returns E_USAGE for error_code 1000', () => {
    const err = mapPublishBusinessError({ error_code: 1000 });
    assert.equal(err.code, 'E_USAGE');
    assert.equal(err.exitCode, 2);
  });

  it('returns E_BUSINESS for generic non-zero error_code', () => {
    const err = mapPublishBusinessError({ error_code: 99999 });
    assert.equal(err.code, 'E_BUSINESS');
    assert.equal(err.exitCode, 6);
  });

  it('returns null for error_code 0 (success)', () => {
    assert.equal(mapPublishBusinessError({ error_code: 0 }), null);
  });

  it('returns null for null input', () => {
    assert.equal(mapPublishBusinessError(null), null);
  });

  it('also reads errorCode camelCase field', () => {
    const err = mapPublishBusinessError({ errorCode: 54001 });
    assert.equal(err.code, 'E_RATE_LIMIT');
  });

  it('returns null for error_code 1000000', () => {
    assert.equal(mapPublishBusinessError({ error_code: 1000000 }), null);
  });
});

// ---------------------------------------------------------------------------
// publishGoodsFromLink: save draft strict failure path
// ---------------------------------------------------------------------------
vi.mock('../src/adapter/mock-dispatcher.js', () => ({
  isMockEnabled: () => false,
  loadFixture: () => ({}),
  mockLaunchBrowser: vi.fn(),
  mockCloseBrowser: vi.fn(),
}));

vi.mock('../src/adapter/browser.js', () => ({
  createConsumerContext: vi.fn(async () => ({
    page: {},
    context: {},
    close: async () => {},
  })),
  launchBrowser: vi.fn(async () => ({
    browser: { close: async () => {} },
    context: {},
    page: {},
  })),
  closeBrowser: vi.fn(async () => {}),
}));

vi.mock('../src/adapter/goods-publish/source-scraper.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    scrapeSourceGoods: vi.fn(async () => ({
      goodsName: '测试商品',
      catID3: '15000',
      catID1: '100',
      catID2: '200',
      carousel: ['https://img.pddpic.com/test.jpg'],
      price: '8.22',
      properties: '品牌: 无品牌',
      detailImages: [],
    })),
  };
});

vi.mock('../src/adapter/goods-publish/category-resolver.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolvePddCategory: vi.fn(async () => ({
      root: '服饰',
      cates: ['服饰', '童装', '上衣'],
      cat_id: 15000,
      cat_ids: [100, 200, 15000, null],
      cats: ['服饰', '童装', '上衣', null],
    })),
    buildCategorySearchText: vi.fn(() => '服饰 > 童装 > 上衣'),
  };
});

const formFillerMockState = vi.hoisted(() => ({
  saveShouldThrow: true,
  saveVerification: { ok: true, issues: [], skipped: false },
  saveCalls: [],
  selectCalls: 0,
  fillCalls: 0,
}));

vi.mock('../src/adapter/goods-publish/form-filler.js', () => ({
  selectCategory: vi.fn(async () => {
    formFillerMockState.selectCalls += 1;
    return { goodsId: '123456', goodsCommitId: 'abc789' };
  }),
  fillGoodsForm: vi.fn(async () => {
    formFillerMockState.fillCalls += 1;
  }),
  clickSaveDraft: vi.fn(async (_page, _goodsCommitId, options = {}) => {
    formFillerMockState.saveCalls.push(options);
    if (formFillerMockState.saveShouldThrow) throw new Error('保存草稿按钮超时');
    if (options.strictVerify && formFillerMockState.saveVerification.ok === false) {
      const err = new Error('草稿校验失败');
      err.code = 'E_BUSINESS';
      err.exitCode = 6;
      throw err;
    }
    return { success: true, verification: formFillerMockState.saveVerification };
  }),
}));

vi.mock('../src/infra/circuit-breaker.js', () => ({
  getSharedBreaker: () => ({
    wrap: (name, fn) => fn(),
  }),
  CircuitBreaker: class { wrap(name, fn) { return fn(); } },
  _resetSharedBreaker: () => {},
}));

// scrape-cooldown 在服务层早短路被调用（getSharedScrapeCooldown().check()）；
// 单测里 stub 为 no-op，隔离磁盘状态，避免真实冷却态导致偶发失败。
vi.mock('../src/infra/scrape-cooldown.js', () => ({
  getSharedScrapeCooldown: () => ({
    check() {},
    recordSoftBlock: () => ({ cooldownTriggered: false, cooldownRemainingMs: 0 }),
    recordSuccess() {},
  }),
  createScrapeCooldown: () => ({ check() {}, recordSoftBlock: () => ({}), recordSuccess() {} }),
  _resetSharedScrapeCooldown: () => {},
}));

const endpointMockState = vi.hoisted(() => ({
  response: {
    templates: [{ id: 544142245494784, name: '全国包邮', free_province_need: 0 }],
  },
  calls: [],
}));

vi.mock('../src/adapter/run-endpoint.js', () => ({
  runEndpoint: vi.fn(async (_page, meta) => {
    endpointMockState.calls.push(meta?.name);
    if (meta?.name === 'goods.publish.submit') return { success: true };
    return endpointMockState.response;
  }),
}));

function resetEndpointMock() {
  endpointMockState.response = {
    templates: [{ id: 544142245494784, name: '全国包邮', free_province_need: 0 }],
  };
  endpointMockState.calls = [];
}

function resetFormFillerMock() {
  formFillerMockState.saveShouldThrow = true;
  formFillerMockState.saveVerification = { ok: true, issues: [], skipped: false };
  formFillerMockState.saveCalls = [];
  formFillerMockState.selectCalls = 0;
  formFillerMockState.fillCalls = 0;
}

describe('resolvePublishCostTemplate', () => {
  beforeEach(() => {
    resetEndpointMock();
  });

  it('selects the first template when no explicit id is provided', async () => {
    const { resolvePublishCostTemplate } = await import('../src/services/goods-publish.js');
    endpointMockState.response = {
      templates: [
        { id: 1001, name: '默认模板' },
        { id: 1002, name: '备用模板' },
      ],
    };

    const selected = await resolvePublishCostTemplate({ page: {} });

    assert.equal(selected.id, 1001);
  });

  it('matches explicit template ids across number and string inputs', async () => {
    const { resolvePublishCostTemplate } = await import('../src/services/goods-publish.js');
    endpointMockState.response = {
      templates: [{ id: 544142245494784, name: '全国包邮' }],
    };

    const selected = await resolvePublishCostTemplate({ page: {} }, '544142245494784');

    assert.equal(selected.id, 544142245494784);
  });

  it('throws E_USAGE when explicit template is unavailable', async () => {
    const { resolvePublishCostTemplate } = await import('../src/services/goods-publish.js');

    await assert.rejects(
      () => resolvePublishCostTemplate({ page: {} }, '999'),
      (err) => {
        assert.equal(err.code, 'E_USAGE');
        assert.equal(err.exitCode, 2);
        return true;
      },
    );
  });

  it('throws E_BUSINESS when no templates are available', async () => {
    const { resolvePublishCostTemplate } = await import('../src/services/goods-publish.js');
    endpointMockState.response = { templates: [] };

    await assert.rejects(
      () => resolvePublishCostTemplate({ page: {} }),
      (err) => {
        assert.equal(err.code, 'E_BUSINESS');
        assert.equal(err.exitCode, 6);
        return true;
      },
    );
  });
});

describe('save draft cost template injection', () => {
  it('writes cost_template_id into the edit request body', async () => {
    const { injectCostTemplateIntoEditBody } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const injected = JSON.parse(injectCostTemplateIntoEditBody('{"goods_id":123}', 544142245494784));

    assert.equal(injected.goods_id, 123);
    assert.equal(injected.cost_template_id, 544142245494784);
  });

  it('fails structurally when the edit request body is missing', async () => {
    const { injectCostTemplateIntoEditBody } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');

    assert.throws(
      () => injectCostTemplateIntoEditBody('', 544142245494784),
      (err) => err.code === 'E_BUSINESS',
    );
  });

  it('cleans up the route handler after save injection', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const routed = [];
    let continued = null;
    let unrouted = false;
    const page = {
      waitForSelector: async () => ({
        click: async () => {
          await routed[0].handler({
            request: () => ({ postData: () => '{"goods_id":123}' }),
            continue: async (options) => { continued = options; },
            abort: async () => {},
          });
        },
      }),
      $: async () => null,
      route: async (pattern, handler) => { routed.push({ pattern, handler }); },
      unroute: async (_pattern, handler) => {
        unrouted = routed.some(item => item.handler === handler);
      },
      waitForResponse: async (predicate) => {
        assert.equal(predicate({ url: () => 'https://mms.pinduoduo.com/foo/action/edit' }), false);
        assert.equal(
          predicate({ url: () => 'https://mms.pinduoduo.com/glide/mms/goodsCommit/action/edit' }),
          true,
        );
        return { json: async () => ({ success: true }) };
      },
      evaluate: async () => ({ result: { goods_name: '测试商品', cost_template_id: 544142245494784, gallery: ['x'] } }),
    };

    await clickSaveDraft(page, 'abc789', { costTemplateId: 544142245494784 });

    assert.equal(JSON.parse(continued.postData).cost_template_id, 544142245494784);
    assert.equal(unrouted, true);
  });

  it('fails when save response arrives but template injection never happens', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    let unrouted = false;
    const page = {
      waitForSelector: async () => ({ click: async () => {} }),
      $: async () => null,
      route: async () => {},
      unroute: async () => { unrouted = true; },
      waitForResponse: async () => ({ json: async () => ({ success: true }) }),
      evaluate: async () => ({ result: { goods_name: '测试商品', cost_template_id: 544142245494784, gallery: ['x'] } }),
    };

    await assert.rejects(
      () => clickSaveDraft(page, 'abc789', { costTemplateId: 544142245494784 }),
      (err) => err.code === 'E_BUSINESS',
    );
    assert.equal(unrouted, true);
  });

  it('maps save action failures without injection to E_BUSINESS', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    let unrouted = false;
    const page = {
      waitForSelector: async () => ({ click: async () => {} }),
      $: async () => null,
      route: async () => {},
      unroute: async () => { unrouted = true; },
      waitForResponse: async () => { throw new Error('timeout waiting for save'); },
      evaluate: async () => ({ result: { goods_name: '测试商品', cost_template_id: 544142245494784, gallery: ['x'] } }),
    };

    await assert.rejects(
      () => clickSaveDraft(page, 'abc789', { costTemplateId: 544142245494784 }),
      (err) => {
        assert.equal(err.code, 'E_BUSINESS');
        assert.match(err.message, /未捕获到保存草稿请求/);
        return true;
      },
    );
    assert.equal(unrouted, true);
  });

  it('cleans up the route handler when body injection fails', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const routed = [];
    let aborted = false;
    let unrouted = false;
    const page = {
      waitForSelector: async () => ({
        click: async () => {
          await routed[0].handler({
            request: () => ({ postData: () => '' }),
            continue: async () => {},
            abort: async () => { aborted = true; },
          });
        },
      }),
      $: async () => null,
      route: async (pattern, handler) => { routed.push({ pattern, handler }); },
      unroute: async (_pattern, handler) => {
        unrouted = routed.some(item => item.handler === handler);
      },
      waitForResponse: async () => new Promise(() => {}),
      evaluate: async () => ({ result: { goods_name: '测试商品', cost_template_id: 544142245494784, gallery: ['x'] } }),
    };

    await assert.rejects(
      () => clickSaveDraft(page, 'abc789', { costTemplateId: 544142245494784 }),
      (err) => err.code === 'E_BUSINESS',
    );
    assert.equal(aborted, true);
    assert.equal(unrouted, true);
  });

  it('strict verification fails when saved draft misses required fields', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const routed = [];
    const page = {
      waitForSelector: async () => ({
        click: async () => {
          await routed[0].handler({
            request: () => ({ postData: () => '{"goods_id":123}' }),
            continue: async () => {},
            abort: async () => {},
          });
        },
      }),
      $: async () => null,
      route: async (pattern, handler) => { routed.push({ pattern, handler }); },
      unroute: async () => {},
      waitForResponse: async () => ({ json: async () => ({ success: true }) }),
      evaluate: async () => ({ result: { goods_name: '测试商品', gallery: ['x'] } }),
    };

    await assert.rejects(
      () => clickSaveDraft(page, 'abc789', { costTemplateId: 544142245494784, strictVerify: true }),
      (err) => {
        assert.equal(err.code, 'E_BUSINESS');
        assert.ok(err.detail.issues.includes('no_cost_template'));
        return true;
      },
    );
  });
});

describe('publishGoodsFromLink: save draft failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEndpointMock();
    resetFormFillerMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when clickSaveDraft throws in draft-only mode', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: {
        info: () => {},
        warn: () => {},
        debug: () => {},
      },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697', { draftOnly: true }),
      (err) => {
        assert.equal(err.code, 'E_BUSINESS');
        assert.equal(err.exitCode, 6);
        return true;
      },
    );
  });

  it('result still contains source_title and category_path', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    formFillerMockState.saveShouldThrow = false;
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    const result = await publishGoodsFromLink(mockCtx, '918867803697');

    assert.equal(result.source_title, '测试商品');
    assert.equal(result.category_path, '服饰 > 童装 > 上衣');
    assert.equal(formFillerMockState.saveCalls[0].strictVerify, true);
  });
});

describe('publishGoodsFromLink: IP 软封早短路', () => {
  it('cooldown active → 抛 E_RATE_LIMIT(ip_soft_block) 且在开浏览器前短路（注入 ctx.scrapeCooldown）', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    resetEndpointMock();
    let browserCalls = 0;
    const mockCtx = {
      page: {},
      context: { browser: () => { browserCalls += 1; return {}; } },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: {
        check() {
          const err = new Error('IP 软风控冷却中');
          err.code = 'E_RATE_LIMIT';
          err.exitCode = 4;
          err.detail = { reason: 'ip_soft_block', cooldown_triggered: true };
          throw err;
        },
        recordSoftBlock: () => ({}),
        recordSuccess: () => {},
      },
    };
    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697', { draftOnly: true }),
      (err) => {
        assert.equal(err.code, 'E_RATE_LIMIT');
        assert.equal(err.detail.reason, 'ip_soft_block');
        return true;
      },
    );
    assert.equal(browserCalls, 0, 'cooldown gate MUST short-circuit before opening browser/context');
    assert.equal(endpointMockState.calls.length, 0, 'cooldown gate MUST short-circuit before cost-template endpoint calls');
  });
});

describe('publishGoodsFromLink: confirmed submit path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEndpointMock();
    resetFormFillerMock();
  });

  it('submits after a successful draft save', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    formFillerMockState.saveShouldThrow = false;
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    const result = await publishGoodsFromLink(mockCtx, '918867803697', { draftOnly: false });

    assert.equal(result.status, 'submitted');
    assert.equal(result.cost_template_id, 544142245494784);
    assert.deepEqual(result.submit, { success: true });
    assert.ok(endpointMockState.calls.includes('goods.publish.submit'));
    assert.equal(formFillerMockState.saveCalls[0].strictVerify, true);
  });

  it('does not call submit when strict draft verification fails', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    formFillerMockState.saveShouldThrow = false;
    formFillerMockState.saveVerification = { ok: false, issues: ['no_cost_template'], skipped: false };
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697', { draftOnly: false }),
      (err) => err.code === 'E_BUSINESS',
    );
    assert.equal(endpointMockState.calls.includes('goods.publish.submit'), false);
  });

  it('does not call submit when confirmed draft save fails', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697', { draftOnly: false }),
      (err) => err.code === 'E_BUSINESS',
    );
    assert.equal(endpointMockState.calls.includes('goods.publish.submit'), false);
  });
});
