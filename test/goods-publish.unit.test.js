import { vi, describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGoodsUrl, validateScrapedData, parseSkuText, isPriceMasked } from '../src/adapter/goods-publish/source-scraper.js';
import { mapPublishBusinessError } from '../src/adapter/endpoints/goods-publish.js';
import { PddCliError, ExitCodes } from '../src/infra/errors.js';
import { defaultSourceGoodsCache } from '../src/services/goods-publish-source-cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixtures');

function loadFixture(rel) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, rel), 'utf8'));
}

// ---------------------------------------------------------------------------
// parseGoodsUrl
// ---------------------------------------------------------------------------
describe('parseGoodsUrl', () => {
  it('extracts goods_id from numeric string or known URL formats', () => {
    const cases = [
      ['918867803697', '918867803697'],
      ['https://mobile.yangkeduo.com/goods.html?goods_id=12345', '12345'],
      ['https://mobile.yangkeduo.com/goods1.html?goods_id=99999&refer_page_name=search_result', '99999'],
      ['https://yangkeduo.com/goods.html?goods_id=55555', '55555'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(parseGoodsUrl(input), expected);
    }
  });

  it('throws E_USAGE for invalid/empty/null input', () => {
    for (const input of ['not-a-valid-thing', '', null]) {
      assert.throws(
        () => parseGoodsUrl(input),
        (e) => e.code === 'E_USAGE'
      );
    }
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
    sourceReferencePriceCents: 1599,
    skuDimensions: [],
    skus: [{
      sourceSkuId: 'sku-1',
      specValues: {},
      sourcePriceCents: 822,
      sourceNormalPriceCents: 899,
      stock: 10,
    }],
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

  it('throws E_RATE_LIMIT (反爬空壳墙) when fiber missing and appWall hit', () => {
    assert.throws(
      () => validateScrapedData({ ...validData, _fiberFound: false, _appWall: true }),
      (e) => e.code === 'E_RATE_LIMIT'
    );
  });

  it('does NOT treat normal data as anti-scrape shell (no fiber/appWall fields)', () => {
    assert.doesNotThrow(() => validateScrapedData(validData));
  });

  it('fails closed when structured SKU data is unavailable', () => {
    assert.throws(
      () => validateScrapedData({
        goodsName: '商品',
        catID3: '15000',
        carousel: ['https://x.com/a.jpg'],
      }),
      (error) => error.code === 'E_SOURCE_SKU_UNAVAILABLE',
    );
  });
});

// ---------------------------------------------------------------------------
// isPriceMasked (软风控脱敏判定)
// ---------------------------------------------------------------------------
describe('isPriceMasked', () => {
  it('detects masked vs valid price representations', () => {
    const cases = [
      [null, true],
      [undefined, true],
      ['', true],
      ['   ', true],
      ['--', true],
      ['¥**', true],
      ['打开App查看', true],
      ['0', true],
      ['0.00', true],
      ['8.22', false],
      ['10', false],
      ['0.01', false],
    ];
    for (const [input, expected] of cases) {
      assert.equal(isPriceMasked(input), expected);
    }
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
// mapPublishBusinessError
// ---------------------------------------------------------------------------
describe('mapPublishBusinessError', () => {
  it('maps error_code to the expected error code and exit code', () => {
    const cases = [
      [{ error_code: 54001 }, 'E_RATE_LIMIT', 4],
      [{ error_code: 1000 }, 'E_USAGE', 2],
      [{ error_code: 99999 }, 'E_BUSINESS', 6],
      [{ errorCode: 54001 }, 'E_RATE_LIMIT', 4],
    ];
    for (const [input, code, exitCode] of cases) {
      const err = mapPublishBusinessError(input);
      assert.equal(err.code, code);
      assert.equal(err.exitCode, exitCode);
    }
  });

  it('returns null for success/absent error codes', () => {
    for (const input of [{ error_code: 0 }, null, { error_code: 1000000 }]) {
      assert.equal(mapPublishBusinessError(input), null);
    }
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

const sourceCacheMockState = {
  entries: new Map(),
  readError: null,
  writeError: null,
  removeError: null,
  readCalls: [],
  writeCalls: [],
  removeCalls: [],
};

vi.mock('../src/adapter/browser.js', () => ({
  evaluateInMainWorld: vi.fn((page, pageFunction, arg) =>
    page.evaluate(pageFunction, arg, false)),
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

vi.mock('../src/adapter/auth-state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    deleteAuthState: vi.fn(async () => ({ removed: true, existed: true })),
  };
});

const sourceScraperMockState = vi.hoisted(() => ({ outcomes: [] }));

vi.mock('../src/adapter/goods-publish/source-scraper.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    scrapeSourceGoods: vi.fn(async () => {
      const outcome = sourceScraperMockState.outcomes.shift();
      if (outcome?.error) throw outcome.error;
      return outcome?.value ?? {
        goodsName: '测试商品',
        catID3: '15000',
        catID1: '100',
        catID2: '200',
        carousel: ['https://img.pddpic.com/test.jpg'],
        price: '8.22',
        skuText: '颜色分类\n红色',
        properties: '品牌: 无品牌',
        detailImages: [],
      };
    }),
  };
});

const sourceProxyMockState = vi.hoisted(() => ({ outcomes: [] }));

vi.mock('../src/adapter/goods-publish/qingguo-proxy.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    acquireQingguoProxyLease: vi.fn(async () => {
      const outcome = sourceProxyMockState.outcomes.shift();
      if (outcome?.error) throw outcome.error;
      return outcome?.value ?? {
        provider: 'qingguo',
        server: 'http://127.0.0.1:8000',
        expiresAt: Date.now() + 60_000,
        area: '广东',
        isp: '电信',
        requestIdHash: 'fp:12345678',
      };
    }),
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

vi.mock('../src/infra/rate-control.js', () => ({
  withWriteRateControl: vi.fn(async (_label, fn) => fn()),
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

function resetSourceProxyMocks() {
  sourceScraperMockState.outcomes = [];
  sourceProxyMockState.outcomes = [];
}

function resetSourceCacheMocks() {
  sourceCacheMockState.entries.clear();
  sourceCacheMockState.readError = null;
  sourceCacheMockState.writeError = null;
  sourceCacheMockState.removeError = null;
  sourceCacheMockState.readCalls = [];
  sourceCacheMockState.writeCalls = [];
  sourceCacheMockState.removeCalls = [];
}

function installSourceCacheMocks() {
  vi.spyOn(defaultSourceGoodsCache, 'read').mockImplementation(async (goodsId) => {
    sourceCacheMockState.readCalls.push(String(goodsId));
    if (sourceCacheMockState.readError) throw sourceCacheMockState.readError;
    return sourceCacheMockState.entries.get(String(goodsId)) ?? null;
  });
  vi.spyOn(defaultSourceGoodsCache, 'write').mockImplementation(async (goodsId, source) => {
    sourceCacheMockState.writeCalls.push(String(goodsId));
    if (sourceCacheMockState.writeError) throw sourceCacheMockState.writeError;
    sourceCacheMockState.entries.set(String(goodsId), source);
    return true;
  });
  vi.spyOn(defaultSourceGoodsCache, 'remove').mockImplementation(async (goodsId) => {
    sourceCacheMockState.removeCalls.push(String(goodsId));
    if (sourceCacheMockState.removeError) throw sourceCacheMockState.removeError;
    return sourceCacheMockState.entries.delete(String(goodsId));
  });
}

function cachedSourceData(overrides = {}) {
  return {
    goodsID: '918867803697',
    goodsName: '缓存商品',
    catID3: '15000',
    catID1: '100',
    catID2: '200',
    carousel: ['https://img.pddpic.com/cached.jpg'],
    price: '8.22',
    skuText: '颜色分类\n红色',
    properties: '品牌: 缓存品牌',
    detailImgs: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetSourceCacheMocks();
  installSourceCacheMocks();
});

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
  it('classifies a business failure as verification unavailable', async () => {
    const { normalizeDraftDetailResponse } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const normalized = normalizeDraftDetailResponse({
      http_status: 200,
      http_ok: true,
      payload: {
        success: false,
        error_code: 2000000,
        error_msg: '网络繁忙，请不要频繁操作',
        result: null,
      },
    });

    assert.equal(normalized.available, false);
    assert.equal(normalized.observation.error_code, 2000000);
    assert.equal(normalized.observation.result_type, 'null');
    assert.deepEqual(normalized.observation.field_keys, []);
  });

  it('normalizes a successful nested detail payload before field validation', async () => {
    const { normalizeDraftDetailResponse } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const normalized = normalizeDraftDetailResponse({
      http_status: 200,
      http_ok: true,
      payload: {
        success: true,
        result: {
          data: {
            goods_name: '测试商品',
            cost_template_id: 544142245494784,
            gallery: ['x'],
          },
        },
      },
    });

    assert.equal(normalized.available, true);
    assert.equal(normalized.observation.candidate_path, 'result.data');
    assert.deepEqual(normalized.data, {
      goods_name: '测试商品',
      cost_template_id: 544142245494784,
      gallery: ['x'],
    });
  });

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

  it('aborts the save request before transmission when strict SKU payload validation fails', async () => {
    const { clickSaveDraft } = await vi.importActual('../src/adapter/goods-publish/form-filler.js');
    const routed = [];
    let continued = false;
    let aborted = false;
    let unrouted = false;
    const page = {
      waitForSelector: async () => ({
        click: async () => {
          await routed[0].handler({
            request: () => ({
              postData: () => JSON.stringify({
                goods_name: '测试商品',
                gallery: ['image'],
                skus: [{ spec: '红色,90', multi_price: 1, price: 1890, quantity_delta: 7 }],
              }),
            }),
            continue: async () => { continued = true; },
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
    };

    await assert.rejects(
      () => clickSaveDraft(page, 'abc789', {
        costTemplateId: 544142245494784,
        strictPayload: true,
        expectedSkuPricing: [{
          sourceSkuId: 'sku-red-90',
          specValues: { 颜色分类: '红色', 身高: '90' },
          groupPrice: '16.90',
          singlePrice: '18.90',
          stock: 7,
        }],
      }),
      (err) => {
        assert.equal(err.code, 'E_BUSINESS');
        assert.ok(err.detail.issues.includes('sku_group_price_mismatch'));
        return true;
      },
    );
    assert.equal(continued, false);
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

  it('propagates draft verification unavailability through the warnings channel', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    formFillerMockState.saveShouldThrow = false;
    formFillerMockState.saveVerification = {
      ok: true,
      issues: [],
      skipped: true,
      warnings: ['draft_verification_unavailable'],
    };
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    const result = await publishGoodsFromLink(mockCtx, '918867803697');

    assert.deepEqual(result.warnings, ['draft_verification_unavailable']);
  });
});

describe('publishGoodsFromLink: temporary source cache', () => {
  function mockContext(overrides = {}) {
    return {
      page: {},
      context: { browser: () => ({}) },
      log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetEndpointMock();
    resetFormFillerMock();
    resetSourceProxyMocks();
  });

  it('uses a cache hit before cooldown, proxy acquisition, or consumer context creation', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { createConsumerContext } = await import('../src/adapter/browser.js');
    const { scrapeSourceGoods } = await import('../src/adapter/goods-publish/source-scraper.js');
    const { acquireQingguoProxyLease } = await import('../src/adapter/goods-publish/qingguo-proxy.js');
    sourceCacheMockState.entries.set('918867803697', cachedSourceData());
    formFillerMockState.saveShouldThrow = false;
    let cooldownChecks = 0;
    const ctx = mockContext({
      scrapeCooldown: {
        check() {
          cooldownChecks += 1;
          throw new Error('cache hit must bypass cooldown');
        },
      },
    });

    const result = await publishGoodsFromLink(ctx, '918867803697');

    assert.equal(result.source_title, '缓存商品');
    assert.equal(cooldownChecks, 0);
    assert.equal(createConsumerContext.mock.calls.length, 0);
    assert.equal(scrapeSourceGoods.mock.calls.length, 0);
    assert.equal(acquireQingguoProxyLease.mock.calls.length, 0);
    assert.deepEqual(sourceCacheMockState.readCalls, ['918867803697']);
    assert.deepEqual(sourceCacheMockState.removeCalls, ['918867803697']);
    assert.equal(sourceCacheMockState.entries.has('918867803697'), false);
  });

  it('keeps a live scrape after downstream failure, then reuses and clears it on retry success', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { scrapeSourceGoods } = await import('../src/adapter/goods-publish/source-scraper.js');
    const ctx = mockContext();

    await assert.rejects(
      () => publishGoodsFromLink(ctx, '918867803697'),
      (error) => error.code === 'E_BUSINESS',
    );
    assert.deepEqual(sourceCacheMockState.writeCalls, ['918867803697']);
    assert.deepEqual(sourceCacheMockState.removeCalls, []);
    assert.equal(sourceCacheMockState.entries.has('918867803697'), true);

    formFillerMockState.saveShouldThrow = false;
    const result = await publishGoodsFromLink(ctx, '918867803697');

    assert.equal(result.status, 'draft');
    assert.equal(scrapeSourceGoods.mock.calls.length, 1);
    assert.deepEqual(sourceCacheMockState.readCalls, ['918867803697', '918867803697']);
    assert.deepEqual(sourceCacheMockState.removeCalls, ['918867803697']);
    assert.equal(sourceCacheMockState.entries.has('918867803697'), false);
  });

  it('continues the current publish when cache read and write both fail', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    sourceCacheMockState.readError = Object.assign(new Error('read failed'), { code: 'EIO' });
    sourceCacheMockState.writeError = Object.assign(new Error('write failed'), { code: 'EACCES' });
    formFillerMockState.saveShouldThrow = false;

    const result = await publishGoodsFromLink(mockContext(), '918867803697');

    assert.equal(result.status, 'draft');
    assert.deepEqual(sourceCacheMockState.readCalls, ['918867803697']);
    assert.deepEqual(sourceCacheMockState.writeCalls, ['918867803697']);
    assert.equal(result.warnings.includes('source_cache_cleanup_failed'), false);
  });

  it('clears cached data only after a confirmed submit succeeds', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    sourceCacheMockState.entries.set('918867803697', cachedSourceData());
    formFillerMockState.saveShouldThrow = false;

    const result = await publishGoodsFromLink(mockContext(), '918867803697', { draftOnly: false });

    assert.equal(result.status, 'submitted');
    assert.ok(endpointMockState.calls.includes('goods.publish.submit'));
    assert.deepEqual(sourceCacheMockState.removeCalls, ['918867803697']);
  });

  it('reports cleanup failure without changing a successful publish result', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    sourceCacheMockState.entries.set('918867803697', cachedSourceData());
    sourceCacheMockState.removeError = Object.assign(new Error('cleanup failed'), { code: 'EACCES' });
    formFillerMockState.saveShouldThrow = false;

    const result = await publishGoodsFromLink(mockContext(), '918867803697');

    assert.equal(result.status, 'draft');
    assert.ok(result.warnings.includes('source_cache_cleanup_failed'));
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

describe('publishGoodsFromLink: Qingguo source proxy retries', () => {
  const envNames = [
    'PDD_SOURCE_PROXY_PROVIDER',
    'PDD_QINGGUO_AUTH_KEY',
    'PDD_CONSUMER_AUTH_STATE_PATH',
    'PDD_TITLE_REWRITE',
  ];
  let previousEnv;

  beforeEach(() => {
    previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    process.env.PDD_SOURCE_PROXY_PROVIDER = 'qingguo';
    process.env.PDD_QINGGUO_AUTH_KEY = 'test-auth-key';
    process.env.PDD_CONSUMER_AUTH_STATE_PATH = 'test-consumer-auth-state.json';
    process.env.PDD_TITLE_REWRITE = '0';
    vi.clearAllMocks();
    resetEndpointMock();
    resetFormFillerMock();
    resetSourceProxyMocks();
    formFillerMockState.saveShouldThrow = false;
  });

  afterEach(() => {
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  });

  it('uses a fresh proxy context and reports recovery after a proxy-network retry', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { createConsumerContext } = await import('../src/adapter/browser.js');
    const { scrapeSourceGoods } = await import('../src/adapter/goods-publish/source-scraper.js');
    sourceProxyMockState.outcomes = [
      { value: {
        provider: 'qingguo', server: 'http://127.0.0.1:8001',
        expiresAt: Date.now() + 60_000, area: '广东', isp: '电信', requestIdHash: 'fp:11111111',
      } },
      { value: {
        provider: 'qingguo', server: 'http://127.0.0.1:8002',
        expiresAt: Date.now() + 60_000, area: '浙江', isp: '联通', requestIdHash: 'fp:22222222',
      } },
    ];
    sourceScraperMockState.outcomes = [{
      error: new PddCliError({
        code: 'E_PROXY_NETWORK',
        message: '代理连接失败',
        exitCode: ExitCodes.NETWORK,
      }),
    }];
    const cooldownCalls = [];
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: {
        check() {},
        recordSoftBlock(signal) { cooldownCalls.push(signal); return { cooldownTriggered: false, cooldownRemainingMs: 0 }; },
        recordSuccess() {},
      },
    };

    const result = await publishGoodsFromLink(mockCtx, '918867803697');

    assert.ok(result.warnings.includes('source_proxy_retry_recovered'));
    assert.equal(createConsumerContext.mock.calls.length, 2);
    assert.deepEqual(createConsumerContext.mock.calls[0][1].proxy, { server: 'http://127.0.0.1:8001' });
    assert.deepEqual(createConsumerContext.mock.calls[1][1].proxy, { server: 'http://127.0.0.1:8002' });
    assert.equal(cooldownCalls.length, 0);
  });

  it('maps Chromium tunnel failure to proxy auth and stops after one lease', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { acquireQingguoProxyLease } = await import('../src/adapter/goods-publish/qingguo-proxy.js');
    sourceScraperMockState.outcomes = [{
      error: new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED'),
    }];
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: { check() {}, recordSoftBlock() {}, recordSuccess() {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697'),
      (err) => err.code === 'E_PROXY_AUTH' && err.exitCode === ExitCodes.AUTH,
    );
    assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
  });

  it('deletes consumer auth and stops after the first account-degradation signal', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { deleteAuthState } = await import('../src/adapter/auth-state.js');
    const { acquireQingguoProxyLease } = await import('../src/adapter/goods-publish/qingguo-proxy.js');
    sourceScraperMockState.outcomes = [{
      error: new PddCliError({
        code: 'E_RISK_CONTROL_SOFT',
        message: '价格脱敏',
        detail: { type: 'desensitized', reason: 'price_masked', skuEmpty: true },
        exitCode: ExitCodes.RATE_LIMIT,
      }),
    }];
    const cooldownCalls = [];
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: {
        check() {},
        recordSoftBlock(signal) {
          cooldownCalls.push(signal);
          return { cooldownTriggered: true, cooldownRemainingMs: 7_200_000 };
        },
        recordSuccess() {},
      },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697'),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.detail.consumer_account_degraded, true);
        assert.equal(err.detail.consumer_auth_removed, true);
        assert.match(err.hint, /更换账号/);
        return true;
      },
    );
    assert.equal(cooldownCalls.length, 0);
    assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
    assert.equal(deleteAuthState.mock.calls.length, 1);
    assert.equal(deleteAuthState.mock.calls[0][0], 'test-consumer-auth-state.json');
  });

  it('keeps consumer auth when the source page is an IP-degraded empty shell', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { deleteAuthState } = await import('../src/adapter/auth-state.js');
    const { acquireQingguoProxyLease } = await import('../src/adapter/goods-publish/qingguo-proxy.js');
    sourceScraperMockState.outcomes = [{
      error: new PddCliError({
        code: 'E_RATE_LIMIT',
        message: '源商品页返回反爬空壳',
        detail: { reason: 'empty_shell' },
        exitCode: ExitCodes.RATE_LIMIT,
      }),
    }];
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: { check() {}, recordSoftBlock() {}, recordSuccess() {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697'),
      (err) => err.code === 'E_RATE_LIMIT' && err.detail.reason === 'empty_shell',
    );
    assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
    assert.equal(deleteAuthState.mock.calls.length, 0);
  });

  it('fails closed when degraded consumer auth cannot be deleted', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { deleteAuthState } = await import('../src/adapter/auth-state.js');
    deleteAuthState.mockRejectedValueOnce(new PddCliError({
      code: 'E_AUTH_STATE_DELETE_FAILED',
      message: '删除登录凭据失败',
      exitCode: ExitCodes.AUTH,
    }));
    sourceScraperMockState.outcomes = [{
      error: new PddCliError({
        code: 'E_RISK_CONTROL_SOFT',
        message: 'SKU 缺失',
        detail: { type: 'desensitized', reason: 'sku_missing' },
        exitCode: ExitCodes.RATE_LIMIT,
      }),
    }];
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      scrapeCooldown: { check() {}, recordSoftBlock() {}, recordSuccess() {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697'),
      (err) => err.code === 'E_AUTH_STATE_DELETE_FAILED',
    );
    assert.equal(deleteAuthState.mock.calls.length, 1);
  });

  it('rejects incomplete proxy config before cost-template or proxy requests', async () => {
    const { publishGoodsFromLink } = await import('../src/services/goods-publish.js');
    const { acquireQingguoProxyLease } = await import('../src/adapter/goods-publish/qingguo-proxy.js');
    delete process.env.PDD_QINGGUO_AUTH_KEY;
    const mockCtx = {
      page: {},
      context: { browser: () => ({}) },
      log: { info: () => {}, warn: () => {}, debug: () => {} },
    };

    await assert.rejects(
      () => publishGoodsFromLink(mockCtx, '918867803697'),
      (err) => err.code === 'E_USAGE',
    );
    assert.equal(endpointMockState.calls.length, 0);
    assert.equal(acquireQingguoProxyLease.mock.calls.length, 0);
  });
});
