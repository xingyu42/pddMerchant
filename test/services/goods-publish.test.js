// T0 characterization safety net around publishGoodsFromLink (goods-publish-deepening#01).
// Temporary direct-adapter vi.mock seams below will be replaced wholesale by an in-memory
// GoodsPublishPort + raw EndpointPort once goods-publish-deepening#04/#05 land.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it, vi } from 'vitest';
import { parseRuntimeEnv } from '../../src/runtime/env.js';

vi.mock('../../src/adapter/browser.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createConsumerContext: vi.fn(),
  };
});

vi.mock('../../src/adapter/goods-publish/category-resolver.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolvePddCategory: vi.fn(),
  };
});

vi.mock('../../src/adapter/goods-publish/dynamic-property-template.js', () => ({
  readDynamicPropertyTemplate: vi.fn(),
}));

vi.mock('../../src/adapter/goods-publish/form-filler.js', () => ({
  selectCategory: vi.fn(),
  fillGoodsForm: vi.fn(),
  fillGoodsProperties: vi.fn(),
  fillFullCountDiscount: vi.fn(),
  disableSizeChart: vi.fn(),
  clickSaveDraft: vi.fn(),
}));

vi.mock('../../src/adapter/goods-publish/qingguo-proxy.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    acquireQingguoProxyLease: vi.fn(),
  };
});

vi.mock('../../src/infra/rate-control.js', () => ({
  withWriteRateControl: vi.fn(async (_label, fn) => fn()),
}));

import { createConsumerContext } from '../../src/adapter/browser.js';
import { resolvePddCategory } from '../../src/adapter/goods-publish/category-resolver.js';
import { readDynamicPropertyTemplate } from '../../src/adapter/goods-publish/dynamic-property-template.js';
import {
  selectCategory,
  fillGoodsForm,
  fillGoodsProperties,
  fillFullCountDiscount,
  disableSizeChart,
  clickSaveDraft,
} from '../../src/adapter/goods-publish/form-filler.js';
import { acquireQingguoProxyLease } from '../../src/adapter/goods-publish/qingguo-proxy.js';
import { withWriteRateControl } from '../../src/infra/rate-control.js';
import {
  GOODS_PUBLISH_COST_TEMPLATE_LIST,
  GOODS_PUBLISH_TEMPLATE,
  GOODS_PUBLISH_SUBMIT,
} from '../../src/adapter/endpoints/goods-publish.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { getSharedBreaker } from '../../src/infra/circuit-breaker.js';
import { ExitCodes, PddCliError, scrapeCooldownActive } from '../../src/infra/errors.js';
import {
  DATA_DIR,
  GOODS_PUBLISH_SOURCE_CACHE_DIR,
  SCRAPE_COOLDOWN_PATH,
} from '../../src/infra/paths.js';
import { getSharedSessionHealth } from '../../src/infra/session-health.js';
import { PUBLISH_VIEW_FIELDS } from '../../src/services/views/goods-publish.js';
import { publishGoodsFromLink } from '../../src/services/goods-publish.js';

function createMemoryScrapeCooldown({
  threshold = 2,
  cooldownMs = 60_000,
  now = Date.now,
} = {}) {
  let consecutiveSoftBlock = 0;
  let cooldownUntil = 0;
  const calls = { check: 0, recordSoftBlock: 0, recordSuccess: 0 };

  return {
    calls,
    check() {
      calls.check += 1;
      const remaining = cooldownUntil - now();
      if (remaining > 0) {
        throw scrapeCooldownActive(remaining, { consecutive_soft_block: consecutiveSoftBlock });
      }
    },
    recordSoftBlock() {
      calls.recordSoftBlock += 1;
      consecutiveSoftBlock += 1;
      let cooldownTriggered = false;
      if (consecutiveSoftBlock >= threshold) {
        cooldownUntil = now() + cooldownMs;
        cooldownTriggered = true;
      }
      return {
        cooldownTriggered,
        cooldownUntil,
        cooldownRemainingMs: Math.max(0, cooldownUntil - now()),
        consecutiveSoftBlock,
      };
    },
    recordSuccess() {
      calls.recordSuccess += 1;
      consecutiveSoftBlock = 0;
      cooldownUntil = 0;
    },
    status() {
      return {
        consecutiveSoftBlock,
        cooldownUntil,
        cooldownRemainingMs: Math.max(0, cooldownUntil - now()),
      };
    },
    tripNow(remainingMs = cooldownMs) {
      consecutiveSoftBlock = threshold;
      cooldownUntil = now() + remainingMs;
    },
  };
}

function createMemorySourceCache(initialEntries = {}) {
  const store = new Map(
    Object.entries(initialEntries).map(([key, value]) => [String(key), structuredClone(value)]),
  );
  const calls = { read: [], write: [], remove: [] };
  const faults = { read: null, write: null, remove: null };

  return {
    calls,
    faults,
    async read(goodsId) {
      calls.read.push(String(goodsId));
      if (faults.read) throw faults.read;
      const hit = store.get(String(goodsId));
      return hit ? structuredClone(hit) : null;
    },
    async write(goodsId, source) {
      calls.write.push(String(goodsId));
      if (faults.write) throw faults.write;
      store.set(String(goodsId), structuredClone(source));
      return true;
    },
    async remove(goodsId) {
      calls.remove.push(String(goodsId));
      if (faults.remove) throw faults.remove;
      return store.delete(String(goodsId));
    },
    peek(goodsId) {
      const entry = store.get(String(goodsId));
      return entry ? structuredClone(entry) : null;
    },
  };
}

function seedConsumerAccount({
  identity = 'consumer-1001',
  displayName = 'Synthetic Consumer',
  cookies = [{ name: 'PDDAccessToken', value: 'synthetic-consumer-token', domain: '.yangkeduo.com', path: '/' }],
} = {}) {
  const account = insertAccount({ kind: 'consumer', identity, displayName }, { setDefault: true });
  saveAuthStateSnapshot({ cookies, origins: [] }, account.id);
  return account;
}

function makeExtractedSource(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Synthetic Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色\n黑色',
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    _fiberFound: true,
    _maskHint: false,
    _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456',
    _title: 'Synthetic Cotton Tee',
    _bodyLen: 800,
    _roots: 'app',
    _appWall: false,
    _decodedSkuSource: {
      goodsID: '123456',
      linePrice: '59',
      skuDimensions: [
        {
          name: '颜色',
          values: [
            { id: '1', text: '白色' },
            { id: '2', text: '黑色' },
          ],
        },
      ],
      skus: [
        {
          skuID: 'sku-w',
          groupPrice: '14.70',
          normalPrice: '25.80',
          quantity: 10,
          thumbUrl: 'https://img.pddpic.com/white.jpg',
          specValues: { 颜色: '白色' },
        },
        {
          skuID: 'sku-b',
          groupPrice: '16.00',
          normalPrice: '28.00',
          quantity: 0,
          thumbUrl: 'https://img.pddpic.com/black.jpg',
          specValues: { 颜色: '黑色' },
        },
      ],
      goodsProperties: [
        { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
      ],
      visitedObjects: 10,
    },
    ...overrides,
  };
}

function makeNormalizedCachedSource(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Synthetic Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    sourceReferencePriceCents: 5900,
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色\n黑色',
    skuDimensions: [
      {
        name: '颜色',
        values: [
          { id: '1', text: '白色' },
          { id: '2', text: '黑色' },
        ],
      },
    ],
    skus: [
      {
        sourceSkuId: 'sku-w',
        specValues: { 颜色: '白色' },
        sourcePriceCents: 1470,
        sourceNormalPriceCents: 2580,
        stock: 10,
        thumbUrl: 'https://img.pddpic.com/white.jpg',
      },
      {
        sourceSkuId: 'sku-b',
        specValues: { 颜色: '黑色' },
        sourcePriceCents: 1600,
        sourceNormalPriceCents: 2800,
        stock: 0,
        thumbUrl: 'https://img.pddpic.com/black.jpg',
      },
    ],
    goodsProperties: [
      { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
    ],
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    ...overrides,
  };
}

function makeRawProperty(id, pid, refPid, name, valueTexts, { required = true, important = false } = {}) {
  return {
    id,
    pid,
    ref_pid: refPid,
    name_alias: name,
    required,
    is_important: important,
    control_type: 1,
    value_type: 0,
    choose_max_num: 1,
    values: valueTexts.map((text, index) => ({ vid: id * 10 + index + 1, value: text })),
  };
}

function makeRawTemplate(properties = [makeRawProperty(1001, 2001, '101', '面料俗称', ['棉'])]) {
  return {
    id: 9001,
    modules: [
      {
        id: 8001,
        propertys: properties,
      },
    ],
  };
}

function toNormalizedTemplateProperty(raw, templateModuleId = 8001) {
  return {
    templateModuleId,
    templatePid: raw.id,
    pid: raw.pid,
    refPid: raw.ref_pid,
    name: raw.name_alias,
    required: raw.required,
    important: raw.is_important,
    controlType: raw.control_type,
    valueType: raw.value_type,
    chooseMaxNum: raw.choose_max_num,
    values: raw.values,
  };
}

function snapshotFile(filePath) {
  if (!existsSync(filePath)) return null;
  const stat = lstatSync(filePath);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}

function snapshotDir(dirPath) {
  if (!existsSync(dirPath)) return null;
  return readdirSync(dirPath)
    .sort()
    .map((name) => {
      const stat = lstatSync(join(dirPath, name));
      return { name, mtimeMs: stat.mtimeMs, size: stat.size };
    });
}

function captureRepoIsolationState(goodsId = '123456') {
  return {
    goodsId,
    dataDir: snapshotDir(DATA_DIR),
    cacheDir: snapshotDir(GOODS_PUBLISH_SOURCE_CACHE_DIR),
    cooldownFile: snapshotFile(SCRAPE_COOLDOWN_PATH),
    goodsCacheFile: snapshotFile(join(GOODS_PUBLISH_SOURCE_CACHE_DIR, `${goodsId}.json`)),
  };
}

function assertRepoIsolationUnchanged(before) {
  assert.deepEqual(snapshotDir(DATA_DIR), before.dataDir);
  assert.deepEqual(snapshotDir(GOODS_PUBLISH_SOURCE_CACHE_DIR), before.cacheDir);
  assert.deepEqual(snapshotFile(SCRAPE_COOLDOWN_PATH), before.cooldownFile);
  assert.deepEqual(
    snapshotFile(join(GOODS_PUBLISH_SOURCE_CACHE_DIR, `${before.goodsId}.json`)),
    before.goodsCacheFile,
  );
}

function makeFakePage({
  url = 'https://mms.pinduoduo.com/goods/goods_add/index',
  extracted = makeExtractedSource(),
  onGoto,
} = {}) {
  return {
    url: vi.fn(() => url),
    goto: vi.fn(async (targetUrl) => {
      if (onGoto) await onGoto(targetUrl);
    }),
    waitForResponse: vi.fn(async () => null),
    waitForSelector: vi.fn(async () => null),
    waitForTimeout: vi.fn(async () => {}),
    locator: vi.fn(() => ({ first: () => ({ isVisible: vi.fn(async () => false) }) })),
    evaluate: vi.fn(async () => structuredClone(typeof extracted === 'function' ? extracted() : extracted)),
  };
}

function makeFakeLogger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makePublishCtx({
  costTemplates = [{ id: 3001, name: 'Synthetic 包邮', free_province_need: null }],
  initialTemplate = makeRawTemplate(),
  submitResponse = { success: true, error_code: 1000000 },
  scrapeCooldown = createMemoryScrapeCooldown(),
  sourceGoodsCache = createMemorySourceCache(),
  signal,
  fullCountDiscountRate = 0.95,
  onExecute,
  env = {},
  runtime,
} = {}) {
  const merchantPage = makeFakePage();
  const fakeBrowser = { kind: 'synthetic-browser' };
  const execute = vi.fn(async (spec, params) => {
    if (onExecute) {
      const override = await onExecute(spec, params);
      if (override !== undefined) return override;
    }
    if (spec === GOODS_PUBLISH_COST_TEMPLATE_LIST) {
      return { data: spec.normalize({ cost_template_list: costTemplates }) };
    }
    if (spec === GOODS_PUBLISH_TEMPLATE) {
      return { data: spec.normalize(initialTemplate) };
    }
    if (spec === GOODS_PUBLISH_SUBMIT) {
      return { data: spec.normalize(submitResponse) };
    }
    throw new Error(`Unexpected endpoint spec: ${spec?.name}`);
  });

  return {
    page: merchantPage,
    context: { browser: () => fakeBrowser },
    mallCtx: { activeId: '900001', activeName: 'Synthetic Shop', malls: [] },
    client: { execute },
    scrapeCooldown,
    sourceGoodsCache,
    sessionHealth: getSharedSessionHealth(),
    runtimeConfig: {
      fullCountDiscountRate,
      writeRateTokensPerMinute: 12,
      categoryApiBase: 'https://category.invalid',
      scrapeSoftBlockThreshold: 2,
      scrapeSoftBlockCooldownMs: 60_000,
    },
    log: makeFakeLogger(),
    config: {},
    signal,
    runtime: runtime ?? {
      mode: 'live',
      env: parseRuntimeEnv({ PDD_SCRAPE_SIMULATE: '0', ...env }, { mode: 'live' }),
    },
  };
}

let consumerContexts;

beforeEach(() => {
  vi.clearAllMocks();
  getSharedBreaker().reset();
  getSharedSessionHealth().reset();
  consumerContexts = [];

  withWriteRateControl.mockImplementation(async (_label, fn) => fn());

  createConsumerContext.mockImplementation(async (_browser, options = {}) => {
    const page = makeFakePage({ url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456' });
    const entry = {
      options,
      page,
      context: { kind: 'synthetic-consumer-context' },
      close: vi.fn(async () => {}),
    };
    consumerContexts.push(entry);
    return entry;
  });

  resolvePddCategory.mockResolvedValue({
    root: '服饰',
    cates: ['服饰', '女装', 'T恤'],
    cat_id: 1003,
    cat_ids: [1001, 1002, 1003, null],
    cats: ['服饰', '女装', 'T恤', null],
  });

  selectCategory.mockResolvedValue({ goodsCommitId: '7001', goodsId: '5001' });

  fillGoodsForm.mockImplementation(async (_page, _source, _warnings, options) => ({
    uploadedSkuPreviewPlan: (options?.skuPreviewPlan ?? []).map((item, index) => ({
      merchantColor: item.merchantColor,
      uploadedImageUrl: `https://img.pddpic.com/uploaded-${index + 1}.jpg`,
    })),
  }));

  readDynamicPropertyTemplate.mockImplementation(async (_page, baseTemplate) => ({
    ok: true,
    issues: [],
    propertysTid: baseTemplate.propertysTid,
    properties: [...baseTemplate.properties],
  }));

  fillGoodsProperties.mockResolvedValue(undefined);
  disableSizeChart.mockResolvedValue({ changed: false, disabled: true });
  fillFullCountDiscount.mockResolvedValue({ rate: 0.95, displayValue: '9.5', payloadValue: 95 });
  clickSaveDraft.mockResolvedValue({
    success: true,
    payload_validation: { gallery_count: 1, goods_property_count: 1, sku_count: 2, sku_thumb_count: 2 },
    verification: { ok: true, issues: [], skipped: false, warnings: [] },
  });
  acquireQingguoProxyLease.mockImplementation(async () => {
    const attempt = acquireQingguoProxyLease.mock.calls.length;
    return {
      provider: 'qingguo',
      server: `http://198.51.100.${attempt}:42001`,
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: `fp:req0000${attempt}`,
    };
  });
});

const qingguoProxyEnv = {
  PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
  PDD_QINGGUO_AUTH_KEY: 'secret-qingguo-key',
};

describe('publishGoodsFromLink T0 characterization safety net', () => {
  it('completes a direct draft publish in isolation without touching repo data or tmp dirs', async () => {
    seedConsumerAccount();
    const ctx = makePublishCtx();
    const beforeRepoState = captureRepoIsolationState('123456');

    const result = await publishGoodsFromLink(ctx, 'https://mobile.yangkeduo.com/goods.html?goods_id=123456');

    assert.deepEqual(Object.keys(result.data).sort(), [...PUBLISH_VIEW_FIELDS].sort());
    assert.equal(result.data.goods_id, '5001');
    assert.equal(result.data.goods_commit_id, '7001');
    assert.equal(result.data.source_goods_id, '123456');
    assert.equal(result.data.status, '草稿');
    assert.equal(result.data.cost_template_id, '3001');
    assert.equal(result.data.category_path, '服饰 > 女装 > T恤');
    assert.deepEqual(result.data.property_mapping, { mapped_count: 1, skipped_count: 0 });
    assert.equal(result.data.sku_preview_count, 2);
    assert.deepEqual(result.warnings, []);
    assert.equal(ctx.scrapeCooldown.calls.recordSuccess, 1);
    assert.deepEqual(ctx.sourceGoodsCache.calls.write, ['123456']);
    assert.deepEqual(ctx.sourceGoodsCache.calls.remove, ['123456']);
    assert.equal(ctx.sourceGoodsCache.peek('123456'), null);
    assertRepoIsolationUnchanged(beforeRepoState);
  });

  it('snapshots non-empty directories with pre-existing files and detects created or modified entries', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pdd-publish-snapshot-'));
    try {
      const fakeDataDir = join(tempRoot, 'data');
      const fakeCacheDir = join(tempRoot, 'tmp', 'goods-publish-source-cache');
      mkdirSync(fakeDataDir, { recursive: true });
      mkdirSync(fakeCacheDir, { recursive: true });
      writeFileSync(join(fakeDataDir, 'pdd.db'), 'sqlite-bytes', 'utf8');
      writeFileSync(join(fakeDataDir, 'master.key'), 'key-bytes', 'utf8');

      const beforeData = snapshotDir(fakeDataDir);
      const beforeCache = snapshotDir(fakeCacheDir);
      const beforeCooldown = snapshotFile(join(fakeDataDir, 'scrape-cooldown.json'));
      const beforeGoodsCache = snapshotFile(join(fakeCacheDir, '123456.json'));

      assert.deepEqual(beforeData?.map((entry) => entry.name), ['master.key', 'pdd.db']);
      assert.deepEqual(beforeCache, []);
      assert.equal(beforeCooldown, null);
      assert.equal(beforeGoodsCache, null);
      assert.deepEqual(snapshotDir(fakeDataDir), beforeData);

      writeFileSync(join(fakeDataDir, 'scrape-cooldown.json'), '{"consecutiveSoftBlock":1}', 'utf8');
      writeFileSync(join(fakeCacheDir, '123456.json'), '{"version":4}', 'utf8');
      assert.notDeepEqual(snapshotDir(fakeDataDir), beforeData);
      assert.notDeepEqual(snapshotFile(join(fakeDataDir, 'scrape-cooldown.json')), beforeCooldown);
      assert.notDeepEqual(snapshotFile(join(fakeCacheDir, '123456.json')), beforeGoodsCache);

      const modifiedBefore = snapshotFile(join(fakeDataDir, 'pdd.db'));
      writeFileSync(join(fakeDataDir, 'pdd.db'), 'sqlite-bytes-modified', 'utf8');
      assert.notDeepEqual(snapshotFile(join(fakeDataDir, 'pdd.db')), modifiedBefore);
      assert.notDeepEqual(snapshotDir(fakeDataDir), beforeData);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  describe('Source Fetch Proxy retry and fail-closed contracts (L247-264)', () => {
    it('retries proxy infra failures with [500, 1000]ms backoff using fresh contexts and emits source_proxy_retry_recovered', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      seedConsumerAccount();

      const attemptTimes = [];
      acquireQingguoProxyLease
        .mockImplementationOnce(async () => {
          attemptTimes.push(Date.now());
          throw new PddCliError({
            code: 'E_PROXY_UNAVAILABLE',
            message: '青果代理暂时没有可用资源',
            exitCode: ExitCodes.NETWORK,
          });
        })
        .mockImplementationOnce(async () => {
          attemptTimes.push(Date.now());
          return {
            provider: 'qingguo',
            server: 'http://198.51.100.2:42001',
            expiresAt: Date.now() + 120_000,
            area: '330100',
            isp: '电信',
            requestIdHash: 'fp:req00002',
          };
        })
        .mockImplementationOnce(async () => {
          attemptTimes.push(Date.now());
          return {
            provider: 'qingguo',
            server: 'http://198.51.100.3:42001',
            expiresAt: Date.now() + 120_000,
            area: '330100',
            isp: '移动',
            requestIdHash: 'fp:req00003',
          };
        });

      createConsumerContext
        .mockImplementationOnce(async (_browser, options) => {
          const page = makeFakePage({
            onGoto: async () => { throw new Error('page.goto: net::ERR_PROXY_CONNECTION_FAILED'); },
          });
          const entry = { options, page, close: vi.fn(async () => {}) };
          consumerContexts.push(entry);
          return entry;
        })
        .mockImplementationOnce(async (_browser, options) => {
          const page = makeFakePage({
            url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456',
          });
          const entry = { options, page, close: vi.fn(async () => {}) };
          consumerContexts.push(entry);
          return entry;
        });

      const ctx = makePublishCtx({ env: qingguoProxyEnv });
      const pending = publishGoodsFromLink(ctx, '123456');

      await vi.advanceTimersByTimeAsync(499);
      assert.equal(attemptTimes.length, 1);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(attemptTimes.length, 2);

      await vi.advanceTimersByTimeAsync(999);
      assert.equal(attemptTimes.length, 2);
      await vi.advanceTimersByTimeAsync(1);
      assert.equal(attemptTimes.length, 3);

      const result = await pending;
      assert.equal(result.data.status, '草稿');
      assert.deepEqual(result.warnings, ['source_proxy_retry_recovered']);
      assert.deepEqual(
        attemptTimes.map((t) => t - attemptTimes[0]),
        [0, 500, 1500],
      );
      assert.equal(consumerContexts.length, 2);
      assert.equal(consumerContexts[0].options.proxy.server, 'http://198.51.100.2:42001');
      assert.equal(consumerContexts[1].options.proxy.server, 'http://198.51.100.3:42001');
      assert.equal(consumerContexts[0].close.mock.calls.length, 1);
      assert.equal(consumerContexts[1].close.mock.calls.length, 1);
    });

    it('exhausts 3 attempts on repeated proxy failures and fails closed without direct fallback', async () => {
      vi.useFakeTimers();
      seedConsumerAccount();

      createConsumerContext.mockImplementation(async (_browser, options) => {
        const page = makeFakePage({
          onGoto: async () => { throw new Error('TimeoutError: page.goto: Timeout 15000ms exceeded'); },
        });
        const entry = { options, page, close: vi.fn(async () => {}) };
        consumerContexts.push(entry);
        return entry;
      });

      const ctx = makePublishCtx({ env: qingguoProxyEnv });
      const pending = publishGoodsFromLink(ctx, '123456');
      const captured = pending.catch((err) => err);

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      const err = await captured;
      assert.ok(err instanceof PddCliError);
      assert.equal(err.code, 'E_PROXY_NETWORK');
      assert.equal(err.exitCode, ExitCodes.NETWORK);
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 3);
      assert.equal(consumerContexts.length, 3);
      assert.ok(consumerContexts.every((c) => Boolean(c.options.proxy?.server)));
      assert.ok(consumerContexts.every((c) => c.close.mock.calls.length === 1));
      assert.equal(JSON.stringify(err.detail).includes('198.51.100'), false);
      assert.equal(JSON.stringify(err.detail).includes('secret-qingguo-key'), false);
    });

    it.each([
      {
        label: 'ERR_TUNNEL_CONNECTION_FAILED (HTTP 407) maps to E_PROXY_AUTH',
        setup: () => {
          createConsumerContext.mockImplementation(async (_browser, options) => {
            const page = makeFakePage({
              onGoto: async () => { throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED'); },
            });
            const entry = { options, page, close: vi.fn(async () => {}) };
            consumerContexts.push(entry);
            return entry;
          });
        },
        expectedCode: 'E_PROXY_AUTH',
        expectedExit: ExitCodes.AUTH,
        expectedContexts: 1,
      },
      {
        label: 'E_PROXY_QUOTA stops immediately on attempt 1',
        setup: () => {
          acquireQingguoProxyLease.mockRejectedValueOnce(new PddCliError({
            code: 'E_PROXY_QUOTA',
            message: '青果代理余额不足或提取额度已耗尽',
            exitCode: ExitCodes.BUSINESS,
          }));
        },
        expectedCode: 'E_PROXY_QUOTA',
        expectedExit: ExitCodes.BUSINESS,
        expectedContexts: 0,
      },
      {
        label: 'E_PROXY_RATE_LIMIT stops immediately on attempt 1',
        setup: () => {
          acquireQingguoProxyLease.mockRejectedValueOnce(new PddCliError({
            code: 'E_PROXY_RATE_LIMIT',
            message: '青果代理提取接口请求过于频繁',
            exitCode: ExitCodes.RATE_LIMIT,
          }));
        },
        expectedCode: 'E_PROXY_RATE_LIMIT',
        expectedExit: ExitCodes.RATE_LIMIT,
        expectedContexts: 0,
      },
      {
        label: 'unclassified browser error maps to E_GENERAL and stops on attempt 1',
        setup: () => {
          createConsumerContext.mockImplementation(async (_browser, options) => {
            const page = makeFakePage({
              onGoto: async () => { throw new Error('unexpected internal frame crash'); },
            });
            const entry = { options, page, close: vi.fn(async () => {}) };
            consumerContexts.push(entry);
            return entry;
          });
        },
        expectedCode: 'E_GENERAL',
        expectedExit: ExitCodes.GENERAL,
        expectedContexts: 1,
      },
    ])('stops immediately without retry when $label', async ({
      setup,
      expectedCode,
      expectedExit,
      expectedContexts,
    }) => {
      seedConsumerAccount();
      setup();

      const ctx = makePublishCtx({ env: qingguoProxyEnv });
      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === expectedCode
          && err.exitCode === expectedExit,
      );

      assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
      assert.equal(consumerContexts.length, expectedContexts);
      if (expectedContexts === 1) assert.equal(consumerContexts[0].close.mock.calls.length, 1);
    });

    it('aborts proxy retry backoff immediately when ctx.signal aborts', async () => {
      vi.useFakeTimers();
      seedConsumerAccount();

      acquireQingguoProxyLease.mockRejectedValueOnce(new PddCliError({
        code: 'E_PROXY_UNAVAILABLE',
        message: 'unavailable',
        exitCode: ExitCodes.NETWORK,
      }));

      const controller = new AbortController();
      const ctx = makePublishCtx({ signal: controller.signal, env: qingguoProxyEnv });
      const pending = publishGoodsFromLink(ctx, '123456');
      const captured = pending.catch((err) => err);

      await vi.advanceTimersByTimeAsync(100);
      controller.abort();

      const err = await captured;
      assert.ok(err instanceof PddCliError);
      assert.equal(err.code, 'E_TIMEOUT');
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
    });

    it('rejects invalid proxy config before cost template call on cache miss, and skips cooldown/proxy on cache hit', async () => {
      const invalidProxyEnv = { PDD_SOURCE_PROXY_PROVIDER: 'qingguo', PDD_QINGGUO_AUTH_KEY: '' };
      const missCtx = makePublishCtx({ env: invalidProxyEnv });
      await assert.rejects(
        publishGoodsFromLink(missCtx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
      );
      assert.equal(missCtx.client.execute.mock.calls.length, 0);
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 0);

      const hitCooldown = createMemoryScrapeCooldown();
      hitCooldown.tripNow(30_000);
      const hitCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const hitCtx = makePublishCtx({ scrapeCooldown: hitCooldown, sourceGoodsCache: hitCache, env: invalidProxyEnv });

      const result = await publishGoodsFromLink(hitCtx, '123456');
      assert.equal(result.data.status, '草稿');
      assert.equal(hitCooldown.calls.check, 0);
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 0);
      assert.equal(consumerContexts.length, 0);
    });

    it('forwards normalized PDD_QINGGUO_AREA to proxy lease acquisition and rejects malformed area before cost templates', async () => {
      seedConsumerAccount();

      const ctx = makePublishCtx({ env: { ...qingguoProxyEnv, PDD_QINGGUO_AREA: '330100, 440300' } });
      await publishGoodsFromLink(ctx, '123456');
      assert.equal(acquireQingguoProxyLease.mock.calls[0][0].area, '330100,440300');

      const invalidAreaCtx = makePublishCtx({ env: { ...qingguoProxyEnv, PDD_QINGGUO_AREA: 'bad-area' } });
      await assert.rejects(
        publishGoodsFromLink(invalidAreaCtx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE',
      );
      assert.equal(invalidAreaCtx.client.execute.mock.calls.length, 0);
    });
  });

  describe('empty-shell classification and immediate stop (source-scraper + goods-publish)', () => {
    it('classifies _fiberFound=false & _appWall=true as E_RATE_LIMIT, records cooldown, preserves consumer auth, and stops proxy rotation', async () => {
      const consumer = seedConsumerAccount();
      const cooldown = createMemoryScrapeCooldown({ threshold: 2, cooldownMs: 60_000 });
      const sourceCache = createMemorySourceCache();

      createConsumerContext.mockImplementation(async (_browser, options) => {
        const page = makeFakePage({
          url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
          extracted: {
            goodsID: '123456',
            goodsName: '拼多多',
            catID: null,
            catID1: null,
            catID2: null,
            catID3: null,
            price: null,
            carousel: [],
            skuText: '',
            properties: '',
            detailImgs: [],
            _fiberFound: false,
            _maskHint: true,
            _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456',
            _title: '拼多多',
            _bodyLen: 2336,
            _roots: 'none',
            _appWall: true,
            _decodedSkuSource: null,
          },
        });
        const entry = { options, page, close: vi.fn(async () => {}) };
        consumerContexts.push(entry);
        return entry;
      });

      const firstCtx = makePublishCtx({ scrapeCooldown: cooldown, sourceGoodsCache: sourceCache, env: qingguoProxyEnv });
      const beforeRepoState = captureRepoIsolationState('123456');
      await assert.rejects(
        publishGoodsFromLink(firstCtx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.exitCode === ExitCodes.RATE_LIMIT
          && err.detail?.reason === 'empty_shell'
          && err.detail?.cooldown_triggered === false,
      );

      assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
      assert.equal(consumerContexts.length, 1);
      assert.equal(consumerContexts[0].close.mock.calls.length, 1);
      assert.equal(cooldown.calls.recordSoftBlock, 1);
      assert.equal(cooldown.status().consecutiveSoftBlock, 1);
      assert.equal(loadAuthState(consumer.id).exists, true);
      assert.equal(sourceCache.peek('123456'), null);

      // Simulate a second process sharing the persistent scrapeCooldown state.
      getSharedBreaker().reset();
      const secondCtx = makePublishCtx({ scrapeCooldown: cooldown, sourceGoodsCache: sourceCache, env: qingguoProxyEnv });
      await assert.rejects(
        publishGoodsFromLink(secondCtx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'empty_shell'
          && err.detail?.cooldown_triggered === true,
      );
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 2);
      assert.equal(cooldown.status().consecutiveSoftBlock, 2);
      assert.ok(cooldown.status().cooldownRemainingMs > 0);
      assert.equal(loadAuthState(consumer.id).exists, true);

      // Third process hits active scrapeCooldown before cost-template or proxy lease.
      getSharedBreaker().reset();
      const thirdCtx = makePublishCtx({ scrapeCooldown: cooldown, sourceGoodsCache: sourceCache, env: qingguoProxyEnv });
      await assert.rejects(
        publishGoodsFromLink(thirdCtx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'ip_soft_block'
          && err.detail?.cooldown_triggered === true,
      );
      assert.equal(thirdCtx.client.execute.mock.calls.length, 0);
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 2);
      assertRepoIsolationUnchanged(beforeRepoState);
    });
  });

  describe('consumer account degradation auth cleanup (L188-200)', () => {
    it.each([
      {
        label: 'app_redirect_placeholder (_maskHint=true)',
        reason: 'app_redirect_placeholder',
        extracted: {
          goodsID: '123456',
          goodsName: 'Synthetic Tee',
          catID: 1003,
          catID1: 1001,
          catID2: 1002,
          catID3: 1003,
          price: null,
          carousel: ['https://img.pddpic.com/c.jpg'],
          skuText: '颜色\n白色',
          properties: '',
          detailImgs: [],
          _fiberFound: true,
          _maskHint: true,
          _appWall: false,
          _decodedSkuSource: null,
        },
      },
      {
        label: 'price_masked (price=0)',
        reason: 'price_masked',
        extracted: {
          goodsID: '123456',
          goodsName: 'Synthetic Tee',
          catID: 1003,
          catID1: 1001,
          catID2: 1002,
          catID3: 1003,
          price: '0',
          carousel: ['https://img.pddpic.com/c.jpg'],
          skuText: '颜色\n白色',
          properties: '',
          detailImgs: [],
          _fiberFound: true,
          _maskHint: false,
          _appWall: false,
          _decodedSkuSource: null,
        },
      },
      {
        label: 'sku_missing (empty skuText and no decoded SKUs)',
        reason: 'sku_missing',
        extracted: {
          goodsID: '123456',
          goodsName: 'Synthetic Tee',
          catID: 1003,
          catID1: 1001,
          catID2: 1002,
          catID3: 1003,
          price: '19.90',
          carousel: ['https://img.pddpic.com/c.jpg'],
          skuText: '',
          properties: '',
          detailImgs: [],
          _fiberFound: true,
          _maskHint: false,
          _appWall: false,
          _decodedSkuSource: null,
        },
      },
    ])('deletes consumer auth, skips cooldown, strips query params, and stops proxy rotation on $label', async ({
      reason,
      extracted,
    }) => {
      const consumer = seedConsumerAccount();
      assert.equal(loadAuthState(consumer.id).exists, true);

      createConsumerContext.mockImplementation(async (_browser, options) => {
        const page = makeFakePage({
          url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN_TOKEN',
          extracted,
        });
        const entry = { options, page, close: vi.fn(async () => {}) };
        consumerContexts.push(entry);
        return entry;
      });

      const cooldown = createMemoryScrapeCooldown({ threshold: 2, cooldownMs: 60_000 });
      const sourceCache = createMemorySourceCache();
      const ctx = makePublishCtx({ scrapeCooldown: cooldown, sourceGoodsCache: sourceCache, env: qingguoProxyEnv });

      let caught;
      try {
        await publishGoodsFromLink(ctx, '123456');
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof PddCliError);
      assert.equal(caught.code, 'E_RISK_CONTROL_SOFT');
      assert.equal(caught.exitCode, ExitCodes.RATE_LIMIT);
      assert.equal(caught.detail.reason, reason);
      assert.equal(caught.detail.path, '/goods.html');
      assert.equal(caught.detail.consumer_account_degraded, true);
      assert.equal(caught.detail.consumer_auth_removed, true);
      assert.equal(caught.detail.consumer_auth_existed, true);
      assert.match(caught.hint, /pdd login --consumer/);
      assert.equal(JSON.stringify(caught.detail).includes('SECRET_UIN_TOKEN'), false);
      assert.equal(loadAuthState(consumer.id).exists, false);
      assert.equal(cooldown.calls.recordSoftBlock, 0);
      assert.equal(cooldown.status().consecutiveSoftBlock, 0);
      assert.equal(cooldown.status().cooldownUntil, 0);
      assert.equal(acquireQingguoProxyLease.mock.calls.length, 1);
      assert.equal(consumerContexts.length, 1);
      assert.equal(consumerContexts[0].close.mock.calls.length, 1);
      assert.equal(sourceCache.peek('123456'), null);
    });
  });

  describe('5-round same-page dynamic property convergence (L468-505)', () => {
    it('always inspects dynamic property template once even with zero skipped initial properties', async () => {
      seedConsumerAccount();
      const ctx = makePublishCtx();

      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(result.data.status, '草稿');
      assert.equal(readDynamicPropertyTemplate.mock.calls.length, 1);
      assert.equal(fillGoodsProperties.mock.calls.length, 0);
    });

    it('converges across 4 dependent property rounds plus stabilization check and sends full converged plan to save', async () => {
      const cached = makeNormalizedCachedSource({
        goodsProperties: [
          { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
          { name: '材质', values: ['棉'], refPid: '102', referenceId: '2' },
          { name: '成分含量', values: ['100%棉'], refPid: '103', referenceId: '3' },
          { name: '风格', values: ['休闲'], refPid: '104', referenceId: '4' },
          { name: '领型', values: ['圆领'], refPid: '105', referenceId: '5' },
        ],
      });
      const sourceCache = createMemorySourceCache({ 123456: cached });

      const dynamicByRound = [
        makeRawProperty(1002, 2002, '102', '材质', ['棉']),
        makeRawProperty(1003, 2003, '103', '成分含量', ['100%棉']),
        makeRawProperty(1004, 2004, '104', '风格', ['休闲']),
        makeRawProperty(1005, 2005, '105', '领型', ['圆领']),
      ];

      let round = 0;
      readDynamicPropertyTemplate.mockImplementation(async (_page, baseTemplate) => {
        const added = dynamicByRound[round];
        round += 1;
        if (!added) {
          return {
            ok: true,
            issues: [],
            propertysTid: baseTemplate.propertysTid,
            properties: [...baseTemplate.properties],
          };
        }
        return {
          ok: true,
          issues: [],
          propertysTid: baseTemplate.propertysTid,
          properties: [
            ...baseTemplate.properties,
            toNormalizedTemplateProperty(added),
          ],
        };
      });

      const ctx = makePublishCtx({ sourceGoodsCache: sourceCache });
      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(readDynamicPropertyTemplate.mock.calls.length, 5);
      assert.equal(fillGoodsProperties.mock.calls.length, 4);
      assert.deepEqual(
        fillGoodsProperties.mock.calls.map(([, plan]) => plan.map((item) => item.name)),
        [['材质'], ['成分含量'], ['风格'], ['领型']],
      );

      const savedOptions = clickSaveDraft.mock.calls[0][2];
      assert.deepEqual(
        savedOptions.expectedPropertyPlan.map((item) => item.name),
        ['面料俗称', '材质', '成分含量', '风格', '领型'],
      );
      assert.deepEqual(result.data.property_mapping, { mapped_count: 5, skipped_count: 0 });
      assert.deepEqual(result.warnings, []);
    });

    it('fails with dynamic_property_template_unstable after 5 non-converging rounds before size-chart or save', async () => {
      const cached = makeNormalizedCachedSource({
        goodsProperties: [
          { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
          { name: '材质', values: ['棉'], refPid: '102', referenceId: '2' },
          { name: '成分含量', values: ['100%棉'], refPid: '103', referenceId: '3' },
          { name: '风格', values: ['休闲'], refPid: '104', referenceId: '4' },
          { name: '领型', values: ['圆领'], refPid: '105', referenceId: '5' },
          { name: '袖长', values: ['短袖'], refPid: '106', referenceId: '6' },
        ],
      });
      const sourceCache = createMemorySourceCache({ 123456: cached });

      const dynamicByRound = [
        makeRawProperty(1002, 2002, '102', '材质', ['棉']),
        makeRawProperty(1003, 2003, '103', '成分含量', ['100%棉']),
        makeRawProperty(1004, 2004, '104', '风格', ['休闲']),
        makeRawProperty(1005, 2005, '105', '领型', ['圆领']),
        makeRawProperty(1006, 2006, '106', '袖长', ['短袖']),
      ];

      let round = 0;
      readDynamicPropertyTemplate.mockImplementation(async (_page, baseTemplate) => {
        const added = dynamicByRound[round++];
        return {
          ok: true,
          issues: [],
          propertysTid: baseTemplate.propertysTid,
          properties: [
            ...baseTemplate.properties,
            toNormalizedTemplateProperty(added),
          ],
        };
      });

      const ctx = makePublishCtx({ sourceGoodsCache: sourceCache });
      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.exitCode === ExitCodes.BUSINESS
          && err.detail?.issues?.includes('dynamic_property_template_unstable'),
      );

      assert.equal(readDynamicPropertyTemplate.mock.calls.length, 5);
      assert.equal(fillGoodsProperties.mock.calls.length, 5);
      assert.equal(disableSizeChart.mock.calls.length, 0);
      assert.equal(fillFullCountDiscount.mock.calls.length, 0);
      assert.equal(clickSaveDraft.mock.calls.length, 0);
      assert.notEqual(sourceCache.peek('123456'), null);
    });

    it('fails closed on dynamic_property_template_invalid before size-chart or save', async () => {
      const invalidCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      readDynamicPropertyTemplate.mockResolvedValueOnce({
        ok: false,
        issues: ['dynamic_property_template_invalid'],
        propertysTid: 9001,
        properties: [],
      });

      await assert.rejects(
        publishGoodsFromLink(makePublishCtx({ sourceGoodsCache: invalidCache }), '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('dynamic_property_template_invalid'),
      );
      assert.equal(disableSizeChart.mock.calls.length, 0);
      assert.equal(clickSaveDraft.mock.calls.length, 0);
      assert.notEqual(invalidCache.peek('123456'), null);
    });

    it('fails closed on an unmapped newly revealed required property before size-chart or save', async () => {
      const missingReqCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      readDynamicPropertyTemplate.mockResolvedValueOnce({
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
          {
            templateModuleId: 8001,
            templatePid: 1099,
            pid: 2099,
            refPid: '199',
            name: '必填新属性',
            required: true,
            important: false,
            controlType: 1,
            valueType: 0,
            chooseMaxNum: 1,
            values: [{ vid: 10991, value: 'A' }],
          },
        ],
      });

      await assert.rejects(
        publishGoodsFromLink(makePublishCtx({ sourceGoodsCache: missingReqCache }), '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('required_property_unmapped'),
      );
      assert.equal(disableSizeChart.mock.calls.length, 0);
      assert.equal(clickSaveDraft.mock.calls.length, 0);
      assert.notEqual(missingReqCache.peek('123456'), null);
    });

    it('deduplicates property_mapping_partial warning when an optional property remains skipped', async () => {
      const partialCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({
          goodsProperties: [
            { name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' },
            { name: '可选属性', values: ['不存在的值'], refPid: '999', referenceId: '9' },
          ],
        }),
      });
      const partialResult = await publishGoodsFromLink(
        makePublishCtx({ sourceGoodsCache: partialCache }),
        '123456',
      );
      assert.deepEqual(partialResult.data.property_mapping, { mapped_count: 1, skipped_count: 1 });
      assert.deepEqual(partialResult.warnings, ['property_mapping_partial']);
    });

    it('stops before fillGoodsForm when initial template has an unmapped important property', async () => {
      const cache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const ctx = makePublishCtx({
        sourceGoodsCache: cache,
        initialTemplate: makeRawTemplate([
          makeRawProperty(1001, 2001, '101', '面料俗称', ['棉']),
          makeRawProperty(1002, 2002, '102', '重要属性', ['值'], { required: false, important: true }),
        ]),
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('important_property_unmapped'),
      );
      assert.equal(fillGoodsForm.mock.calls.length, 0);
      assert.equal(clickSaveDraft.mock.calls.length, 0);
    });
  });

  describe('strict outbound payload check (L522-538) and deferred v4 cache cleanup (L556)', () => {
    it('enforces save-phase ordering and strict payload expectations, keeping draftOnly safe from submit', async () => {
      const order = [];
      fillGoodsForm.mockImplementation(async (_page, _source, _warnings, options) => {
        order.push('fillGoodsForm');
        return {
          uploadedSkuPreviewPlan: options.skuPreviewPlan.map((item, idx) => ({
            merchantColor: item.merchantColor,
            uploadedImageUrl: `https://img.pddpic.com/uploaded-${idx + 1}.jpg`,
          })),
        };
      });
      readDynamicPropertyTemplate.mockImplementation(async (_page, baseTemplate) => {
        order.push('readDynamicPropertyTemplate');
        return { ok: true, issues: [], propertysTid: baseTemplate.propertysTid, properties: [...baseTemplate.properties] };
      });
      disableSizeChart.mockImplementation(async () => {
        order.push('disableSizeChart');
        return { changed: true, disabled: true };
      });
      fillFullCountDiscount.mockImplementation(async (_page, rate) => {
        order.push('fillFullCountDiscount');
        return { rate, displayValue: '8.8', payloadValue: 88 };
      });
      clickSaveDraft.mockImplementation(async () => {
        order.push('clickSaveDraft');
        return {
          success: true,
          verification: { ok: true, issues: [], skipped: true, warnings: ['draft_verification_unavailable'] },
        };
      });

      const sourceCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const ctx = makePublishCtx({
        costTemplates: [
          { id: 3001, name: 'Template A' },
          { id: 3002, name: 'Template B' },
        ],
        sourceGoodsCache: sourceCache,
        fullCountDiscountRate: 0.88,
      });

      const result = await publishGoodsFromLink(ctx, '123456', { draftOnly: true, costTemplateId: '3002' });

      assert.deepEqual(order, [
        'fillGoodsForm',
        'readDynamicPropertyTemplate',
        'disableSizeChart',
        'fillFullCountDiscount',
        'clickSaveDraft',
      ]);
      assert.deepEqual(fillFullCountDiscount.mock.calls[0].slice(0, 2), [ctx.page, 0.88]);
      const [savePage, saveCommitId, saveOpts] = clickSaveDraft.mock.calls[0];
      assert.equal(savePage, ctx.page);
      assert.equal(saveCommitId, '7001');
      assert.equal(saveOpts.costTemplateId, 3002);
      assert.equal(saveOpts.strictPayload, true);
      assert.equal(saveOpts.strictVerify, true);
      assert.equal(saveOpts.expectedFullCountDiscountRate, 0.88);
      assert.deepEqual(saveOpts.expectedSkuPricing, [
        {
          sourceSkuId: 'sku-w',
          specValues: { 颜色: '白色' },
          sourcePriceCents: 1470,
          groupPrice: '14.70',
          singlePrice: '25.80',
          stock: 10,
        },
        {
          sourceSkuId: 'sku-b',
          specValues: { 颜色: '黑色' },
          sourcePriceCents: 1600,
          groupPrice: '16.00',
          singlePrice: '28.00',
          stock: 0,
        },
      ]);
      assert.deepEqual(saveOpts.expectedSkuPreviewPlan, [
        { merchantColor: '白色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-1.jpg' },
        { merchantColor: '黑色', uploadedImageUrl: 'https://img.pddpic.com/uploaded-2.jpg' },
      ]);

      assert.equal(result.data.status, '草稿');
      assert.equal(result.data.cost_template_id, '3002');
      assert.deepEqual(result.warnings, ['draft_verification_unavailable']);
      assert.equal(
        ctx.client.execute.mock.calls.some(([spec]) => spec === GOODS_PUBLISH_SUBMIT),
        false,
      );
      assert.equal(sourceCache.peek('123456'), null);
    });

    it('retains v4 cache when strict save payload fails, reuses cache on retry without scraping, and clears cache after draft success', async () => {
      seedConsumerAccount();
      const sourceCache = createMemorySourceCache();

      clickSaveDraft.mockRejectedValueOnce(new PddCliError({
        code: 'E_BUSINESS',
        message: '保存草稿请求校验失败: goods_property_mismatch',
        detail: { issues: ['goods_property_mismatch'] },
        exitCode: ExitCodes.BUSINESS,
      }));

      const failCtx = makePublishCtx({ sourceGoodsCache: sourceCache });
      const beforeRepoState = captureRepoIsolationState('123456');
      await assert.rejects(
        publishGoodsFromLink(failCtx, '123456', { draftOnly: false }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('goods_property_mismatch'),
      );

      assert.equal(
        failCtx.client.execute.mock.calls.some(([spec]) => spec === GOODS_PUBLISH_SUBMIT),
        false,
      );
      assert.notEqual(sourceCache.peek('123456'), null);
      assert.deepEqual(sourceCache.calls.remove, []);

      createConsumerContext.mockClear();
      clickSaveDraft.mockResolvedValueOnce({
        success: true,
        verification: { ok: true, issues: [], skipped: false, warnings: [] },
      });

      const retryCtx = makePublishCtx({ sourceGoodsCache: sourceCache });
      const retryResult = await publishGoodsFromLink(retryCtx, '123456', { draftOnly: true });

      assert.equal(retryResult.data.status, '草稿');
      assert.equal(createConsumerContext.mock.calls.length, 0);
      assert.deepEqual(sourceCache.calls.remove, ['123456']);
      assert.equal(sourceCache.peek('123456'), null);
      assertRepoIsolationUnchanged(beforeRepoState);
    });

    it('retains v4 cache if --confirm submit is rejected and clears cache only after submit succeeds', async () => {
      const sourceCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });

      const rejectedCtx = makePublishCtx({
        sourceGoodsCache: sourceCache,
        onExecute: async (spec) => {
          if (spec === GOODS_PUBLISH_SUBMIT) {
            return { data: { success: false, raw: { error_code: 9876 } } };
          }
          return undefined;
        },
      });

      await assert.rejects(
        publishGoodsFromLink(rejectedCtx, '123456', { draftOnly: false }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.hint === '保存草稿已完成，但提交发布被平台拒绝'
          && err.detail?.errorCode === 9876,
      );
      assert.notEqual(sourceCache.peek('123456'), null);
      assert.deepEqual(sourceCache.calls.remove, []);

      const successCtx = makePublishCtx({ sourceGoodsCache: sourceCache });
      const submitted = await publishGoodsFromLink(successCtx, '123456', { draftOnly: false });

      assert.equal(submitted.data.status, '已提交');
      assert.equal(
        successCtx.client.execute.mock.calls.filter(([spec]) => spec === GOODS_PUBLISH_SUBMIT).length,
        1,
      );
      assert.deepEqual(sourceCache.calls.remove, ['123456']);
      assert.equal(sourceCache.peek('123456'), null);
    });

    it('tolerates source cache read/write errors and emits source_cache_cleanup_failed without reversing publish success', async () => {
      seedConsumerAccount();
      const sourceCache = createMemorySourceCache();
      sourceCache.faults.read = new Error('ENOENT-or-read-error');
      sourceCache.faults.write = new Error('ENOSPC');
      sourceCache.faults.remove = new Error('EACCES');

      const ctx = makePublishCtx({ sourceGoodsCache: sourceCache });
      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(result.data.status, '草稿');
      assert.deepEqual(result.warnings, ['source_cache_cleanup_failed']);
      assert.deepEqual(sourceCache.calls.read, ['123456']);
      assert.deepEqual(sourceCache.calls.write, ['123456']);
      assert.deepEqual(sourceCache.calls.remove, ['123456']);
    });

    it('stops pre-draft evidence or cost-template errors before category resolution and draft creation', async () => {
      const noTemplateCtx = makePublishCtx({ costTemplates: [] });
      await assert.rejects(
        publishGoodsFromLink(noTemplateCtx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_BUSINESS',
      );
      assert.equal(createConsumerContext.mock.calls.length, 0);

      const badTemplateCtx = makePublishCtx({ costTemplates: [{ id: 3001, name: 'A' }] });
      await assert.rejects(
        publishGoodsFromLink(badTemplateCtx, '123456', { costTemplateId: '9999' }),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE',
      );
      assert.equal(createConsumerContext.mock.calls.length, 0);

      const missingPropsCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({ goodsProperties: [] }),
      });
      await assert.rejects(
        publishGoodsFromLink(makePublishCtx({ sourceGoodsCache: missingPropsCache }), '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('source_properties_missing'),
      );
      assert.equal(resolvePddCategory.mock.calls.length, 0);
      assert.equal(selectCategory.mock.calls.length, 0);

      const missingColorCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({
          skuDimensions: [{ name: '尺码', values: [{ id: '1', text: 'M' }] }],
          skus: [
            {
              sourceSkuId: 'sku-m',
              specValues: { 尺码: 'M' },
              sourcePriceCents: 1470,
              sourceNormalPriceCents: 2580,
              stock: 5,
              thumbUrl: 'https://img.pddpic.com/m.jpg',
            },
          ],
        }),
      });
      await assert.rejects(
        publishGoodsFromLink(makePublishCtx({ sourceGoodsCache: missingColorCache }), '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('sku_preview_color_dimension_missing'),
      );
      assert.equal(resolvePddCategory.mock.calls.length, 0);
      assert.equal(selectCategory.mock.calls.length, 0);
    });

    it('stops invalid pricing plan and invalid fullCountDiscountRate before category resolution and draft creation', async () => {
      const badRefCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({ sourceReferencePriceCents: 2800 }),
      });
      await assert.rejects(
        publishGoodsFromLink(makePublishCtx({ sourceGoodsCache: badRefCache }), '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('pricing_plan_invalid'),
      );
      assert.equal(resolvePddCategory.mock.calls.length, 0);
      assert.equal(selectCategory.mock.calls.length, 0);

      const validCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource(),
      });
      await assert.rejects(
        publishGoodsFromLink(
          makePublishCtx({ sourceGoodsCache: validCache, fullCountDiscountRate: 0.49 }),
          '123456',
        ),
        (err) => err instanceof PddCliError && err.code === 'E_CONFIG_INVALID',
      );
      assert.equal(resolvePddCategory.mock.calls.length, 0);
      assert.equal(selectCategory.mock.calls.length, 0);
    });
  });
});
