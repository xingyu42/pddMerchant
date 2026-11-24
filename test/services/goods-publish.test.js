// Integration suite for publishGoodsFromLink via in-memory GoodsPublishPort + real EndpointPort (ctx.client),
// replacing all T0 direct-adapter vi.mocks with zero module mocking.
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, vi } from 'vitest';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import {
  GOODS_PUBLISH_COST_TEMPLATE_LIST,
  GOODS_PUBLISH_SUBMIT,
  GOODS_PUBLISH_TEMPLATE,
} from '../../src/adapter/endpoints/goods-publish.js';
import { createLiveMerchantDraftEditor } from '../../src/adapter/goods-publish/merchant-draft-editor.js';
import { mergeDynamicPropertyTemplate } from '../../src/adapter/goods-publish/property-template.js';
import { abortableSleep } from '../../src/infra/abort.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import {
  DATA_DIR,
  GOODS_PUBLISH_SOURCE_CACHE_DIR,
  SCRAPE_COOLDOWN_PATH,
} from '../../src/infra/paths.js';
import { createScrapeCooldown } from '../../src/infra/scrape-cooldown.js';
import { parseRuntimeEnv } from '../../src/runtime/env.js';
import { publishGoodsFromLink } from '../../src/services/goods-publish.js';
import { prepareEditPayload, verifyDraftDetail } from '../../src/services/goods-publish/draft-guard.js';
import {
  convergeDynamicProperties,
  fullCountDiscountPayloadValue,
} from '../../src/services/goods-publish/draft-planner.js';
import { createSourceProductFetcher } from '../../src/services/goods-publish/source-product-fetcher.js';
import { PUBLISH_VIEW_FIELDS } from '../../src/services/views/goods-publish.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const activeSessions = [];

afterEach(async () => {
  while (activeSessions.length > 0) {
    const session = activeSessions.pop();
    await session.close().catch(() => {});
  }
});

function createMemoryScrapeCooldown({ threshold = 2, cooldownMs = 60_000, now = Date.now } = {}) {
  const inner = createScrapeCooldown({ threshold, cooldownMs, now, statePath: null });
  const calls = { check: 0, recordSoftBlock: 0, recordSuccess: 0 };

  return {
    calls,
    check() {
      calls.check += 1;
      return inner.check();
    },
    recordSoftBlock(signal) {
      calls.recordSoftBlock += 1;
      return inner.recordSoftBlock(signal);
    },
    recordSuccess() {
      calls.recordSuccess += 1;
      return inner.recordSuccess();
    },
    status() {
      return inner.status();
    },
    tripNow() {
      for (let i = 0; i < threshold; i += 1) inner.recordSoftBlock({ reason: 'empty_shell' });
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

function makeFakeLogger() {
  return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function toOutgoingProperties(propertyPlan = []) {
  return propertyPlan.flatMap((property) =>
    (property.values ?? []).map((value) => ({
      template_module_id: property.templateModuleId,
      template_pid: property.templatePid,
      pid: property.pid,
      vid: value.vid ?? null,
      value: value.value ?? '',
    })),
  );
}

function buildOutgoingSkus(skuPricing, uploadedSkuPreviewPlan) {
  const previewByColor = new Map(
    (uploadedSkuPreviewPlan ?? []).map((item) => [String(item.merchantColor).trim(), item.uploadedImageUrl]),
  );
  return (skuPricing ?? []).map((sku) => {
    const colorEntry = Object.entries(sku.specValues ?? {}).filter(([name]) => /颜色|花色/.test(name));
    const color = colorEntry.length === 1 ? String(colorEntry[0][1]).trim() : '';
    const thumbUrl = previewByColor.get(color) ?? '';
    return {
      spec: Object.values(sku.specValues ?? {}),
      multi_price: Math.round(Number(sku.groupPrice) * 100),
      price: Math.round(Number(sku.singlePrice) * 100),
      quantity: sku.stock,
      ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
    };
  });
}

function createMemoryDraftSessionHarness({
  order,
  readDynamicTemplateImpl,
  disableSizeChartImpl,
  saveDraftOverride,
  editPayloadOverride,
  draftDetailResponse,
} = {}) {
  const spies = {
    fillBaseAndMedia: vi.fn(),
    readDynamicTemplate: vi.fn(),
    fillDependentProperties: vi.fn(),
    disableSizeChart: vi.fn(),
    fillFullCountDiscount: vi.fn(),
    saveDraft: vi.fn(),
  };

  function createDraftSession({ draft }) {
    const state = { goods_name: '', gallery: [], skus: [], goods_properties: [], two_pieces_discount: undefined };
    return {
      async fillBaseAndMedia({ source, pricingPlan, propertyPlan, skuPreviewPlan }) {
        order?.push('fillBaseAndMedia');
        const uploadedSkuPreviewPlan = (skuPreviewPlan ?? []).map((item, idx) => ({
          merchantColor: item.merchantColor,
          uploadedImageUrl: `https://img.pddpic.com/uploaded-${idx + 1}.jpg`,
        }));
        state.goods_name = source.goodsName;
        state.gallery = [...(source.carousel ?? [])];
        state.skus = buildOutgoingSkus(pricingPlan?.skuPricing, uploadedSkuPreviewPlan);
        state.goods_properties = toOutgoingProperties(propertyPlan);
        spies.fillBaseAndMedia({ source, pricingPlan, propertyPlan, skuPreviewPlan, uploadedSkuPreviewPlan });
        return { uploadedSkuPreviewPlan };
      },
      async readDynamicTemplate(currentTemplate) {
        order?.push('readDynamicTemplate');
        const res = readDynamicTemplateImpl
          ? await readDynamicTemplateImpl(currentTemplate)
          : currentTemplate;
        spies.readDynamicTemplate(currentTemplate, res);
        return res;
      },
      async fillDependentProperties(dependentPlan) {
        order?.push('fillDependentProperties');
        spies.fillDependentProperties(dependentPlan);
        state.goods_properties.push(...toOutgoingProperties(dependentPlan));
      },
      async disableSizeChart() {
        order?.push('disableSizeChart');
        const res = disableSizeChartImpl ? await disableSizeChartImpl() : { changed: false, disabled: true };
        spies.disableSizeChart(res);
        return res;
      },
      async fillFullCountDiscount(rate) {
        order?.push('fillFullCountDiscount');
        const payloadValue = fullCountDiscountPayloadValue(rate);
        state.two_pieces_discount = payloadValue;
        const res = { rate, displayValue: (payloadValue / 10).toFixed(1), payloadValue };
        spies.fillFullCountDiscount(rate, res);
        return res;
      },
      async saveDraft(saveOptions) {
        order?.push('saveDraft');
        spies.saveDraft(saveOptions);
        if (saveDraftOverride) return saveDraftOverride(saveOptions);

        let body = {
          goods_name: state.goods_name,
          gallery: state.gallery,
          skus: state.skus,
          goods_properties: state.goods_properties,
          ...(state.two_pieces_discount != null ? { two_pieces_discount: state.two_pieces_discount } : {}),
        };
        if (editPayloadOverride) {
          body = typeof editPayloadOverride === 'function'
            ? editPayloadOverride(body)
            : { ...body, ...editPayloadOverride };
        }
        const prepared = saveOptions.prepareEditPayload(JSON.stringify(body), {
          costTemplateId: saveOptions.costTemplateId,
          expectedCostTemplateId: saveOptions.costTemplateId,
          expectedSkuPricing: saveOptions.expectedSkuPricing,
          expectedPropertyPlan: saveOptions.expectedPropertyPlan,
          expectedSkuPreviewPlan: saveOptions.expectedSkuPreviewPlan,
          expectedFullCountDiscountRate: saveOptions.expectedFullCountDiscountRate,
          strictPayload: Boolean(saveOptions.strictPayload),
        });
        const detail = typeof draftDetailResponse === 'function'
          ? await draftDetailResponse(prepared.body)
          : (draftDetailResponse ?? {
            success: true,
            error_code: 1000000,
            result: {
              goods_name: prepared.body.goods_name,
              cost_template_id: prepared.body.cost_template_id,
              gallery: prepared.body.gallery,
              ...(prepared.body.two_pieces_discount != null
                ? { two_pieces_discount: prepared.body.two_pieces_discount }
                : {}),
            },
          });
        const verification = saveOptions.verifyDraftDetail(detail, {
          goodsCommitId: draft.goodsCommitId,
          expectedCostTemplateId: saveOptions.costTemplateId,
          expectedFullCountDiscountRate: saveOptions.expectedFullCountDiscountRate,
          strictVerify: Boolean(saveOptions.strictVerify),
        });
        return { success: true, payload_validation: prepared.validation?.summary ?? null, verification };
      },
      async checkRiskControl() {},
    };
  }

  return { spies, createDraftSession };
}

async function makePublishCtx({
  costTemplates = [{ id: 3001, name: 'Synthetic 包邮', free_province_need: null }],
  initialTemplate = makeRawTemplate(),
  submitResponse = { success: true, error_code: 1000000 },
  scrapeCooldown = createMemoryScrapeCooldown(),
  sourceGoodsCache = createMemorySourceCache(),
  signal,
  fullCountDiscountRate = 0.95,
  onEndpoint,
  env = {},
  observePage,
  acquireProxyLease,
  sessionHarnessOptions = {},
  categoryResult = {
    root: '服饰',
    cates: ['服饰', '女装', 'T恤'],
    cat_id: 1003,
    cat_ids: [1001, 1002, 1003, null],
    cats: ['服饰', '女装', 'T恤', null],
    searchText: '服饰 > 女装 > T恤',
  },
} = {}) {
  const parsedEnv = parseRuntimeEnv({ PDD_SCRAPE_SIMULATE: '0', ...env }, { mode: 'live' });
  const browserPort = createInMemoryBrowserRuntime({
    createPage: () => ({
      __memory: true,
      url: () => 'https://mobile.yangkeduo.com/goods.html?goods_id=123456',
      close: async () => {},
    }),
  });
  const browserSession = await browserPort.openSession({ ownerTag: 'test-goods-publish' });
  activeSessions.push(browserSession);

  const defaultAcquireLease = vi.fn(async () => {
    const attempt = defaultAcquireLease.mock.calls.length;
    return {
      provider: 'qingguo',
      server: `http://198.51.100.${attempt}:42001`,
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: `fp:req0000${attempt}`,
    };
  });
  const effectiveAcquireLease = acquireProxyLease ?? defaultAcquireLease;

  const defaultObserve = vi.fn(async (page) => ({
    earlyObservation: null,
    observation: makeExtractedSource(),
    pageUrl: page.url(),
  }));
  const effectiveObserve = observePage ?? defaultObserve;

  const transport = createMemoryEndpointTransport({
    onEndpoint: async (spec, params, ctx) => {
      if (onEndpoint) {
        const override = await onEndpoint(spec, params, ctx);
        if (override !== undefined) return override;
      }
      if (spec === GOODS_PUBLISH_COST_TEMPLATE_LIST) return { cost_template_list: costTemplates };
      if (spec === GOODS_PUBLISH_TEMPLATE) return initialTemplate;
      if (spec === GOODS_PUBLISH_SUBMIT) return submitResponse;
      throw new Error(`Unexpected endpoint spec: ${spec?.name}`);
    },
  });

  const opaquePage = Object.freeze({ opaqueToken: 'merchant-page-token' });
  const log = makeFakeLogger();
  const baseCtx = createTestCtx({
    transport,
    page: opaquePage,
    mallId: '900001',
    log,
    signal,
    browserSession,
    scrapeCooldown,
    sourceGoodsCache,
    runtimeConfig: {
      fullCountDiscountRate,
      writeRateTokensPerMinute: 12,
      categoryApiBase: 'https://category.invalid',
      scrapeSoftBlockThreshold: 2,
      scrapeSoftBlockCooldownMs: 60_000,
    },
  });

  const sessionHarness = createMemoryDraftSessionHarness(sessionHarnessOptions);
  const openCategoryDraft = vi.fn(async () => ({ goodsCommitId: '7001', goodsId: '5001' }));
  const categoryResolver = { resolve: vi.fn(async () => categoryResult) };

  const sourceFetcher = createSourceProductFetcher({
    sourceCache: sourceGoodsCache,
    scrapeCooldown,
    sourceProxyEnv: parsedEnv.sourceProxyEnv,
    scrapeSimulate: parsedEnv.scrapeSimulate,
    browserPort,
    browserSession,
    observePage: effectiveObserve,
    acquireProxyLease: effectiveAcquireLease,
    sleep: (ms, abortSignal) => abortableSleep(ms, abortSignal),
    now: Date.now,
    log,
  });

  const draftEditor = createLiveMerchantDraftEditor({
    endpoint: baseCtx.client,
    mode: 'fixture',
    openCategoryDraft,
    checkRisk: vi.fn(async () => {}),
    convergeDynamic: convergeDynamicProperties,
    preparePayload: prepareEditPayload,
    verifyDetail: verifyDraftDetail,
    createDraftSession: sessionHarness.createDraftSession,
    log,
  });

  const port = Object.freeze({ sourceFetcher, categoryResolver, draftEditor });
  baseCtx.runtime = {
    mode: 'live',
    env: parsedEnv,
    ports: { goodsPublish: port, browser: browserPort },
  };

  return {
    ctx: baseCtx,
    transport,
    browserPort,
    port,
    spies: {
      acquireProxyLease: effectiveAcquireLease,
      observePage: effectiveObserve,
      categoryResolve: categoryResolver.resolve,
      openCategoryDraft,
      session: sessionHarness.spies,
    },
  };
}

const qingguoProxyEnv = {
  PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
  PDD_QINGGUO_AUTH_KEY: 'secret-qingguo-key',
};

describe('publishGoodsFromLink via in-memory GoodsPublishPort + raw EndpointPort', () => {
  it('completes a direct draft publish in isolation without touching repo data or tmp dirs', async () => {
    seedConsumerAccount();
    const { ctx } = await makePublishCtx();
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

  it('rejects calls missing GoodsPublishPort with E_CONFIG_INVALID', async () => {
    const bareCtx = createTestCtx({ mallId: '900001' });
    await assert.rejects(
      publishGoodsFromLink(bareCtx, '123456'),
      (err) => err instanceof PddCliError
        && err.code === 'E_CONFIG_INVALID'
        && err.detail?.reason === 'goods_publish_port_missing',
    );
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

  describe('Source Fetch Proxy retry and fail-closed contracts', () => {
    it('retries proxy infra failures with [500, 1000]ms backoff using fresh contexts and emits source_proxy_retry_recovered', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-24T10:00:00Z'));
      seedConsumerAccount();

      const attemptTimes = [];
      const acquireProxyLease = vi.fn()
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

      const observePage = vi.fn()
        .mockImplementationOnce(async () => {
          throw new Error('page.goto: net::ERR_PROXY_CONNECTION_FAILED');
        })
        .mockImplementationOnce(async (page) => ({
          earlyObservation: null,
          observation: makeExtractedSource(),
          pageUrl: page.url(),
        }));

      const { ctx, browserPort } = await makePublishCtx({
        env: qingguoProxyEnv,
        acquireProxyLease,
        observePage,
      });
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
      assert.deepEqual(attemptTimes.map((t) => t - attemptTimes[0]), [0, 500, 1500]);
      assert.equal(browserPort.derivedContexts.length, 2);
      assert.equal(browserPort.derivedContexts[0].proxy.server, 'http://198.51.100.2:42001');
      assert.equal(browserPort.derivedContexts[1].proxy.server, 'http://198.51.100.3:42001');
    });

    it('exhausts 3 attempts on repeated proxy failures and fails closed without direct fallback', async () => {
      vi.useFakeTimers();
      seedConsumerAccount();

      const observePage = vi.fn(async () => {
        throw new Error('TimeoutError: page.goto: Timeout 15000ms exceeded');
      });
      const { ctx, browserPort, spies } = await makePublishCtx({
        env: qingguoProxyEnv,
        observePage,
      });

      const pending = publishGoodsFromLink(ctx, '123456');
      const captured = pending.catch((err) => err);

      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);

      const err = await captured;
      assert.ok(err instanceof PddCliError);
      assert.equal(err.code, 'E_PROXY_NETWORK');
      assert.equal(err.exitCode, ExitCodes.NETWORK);
      assert.equal(spies.acquireProxyLease.mock.calls.length, 3);
      assert.equal(browserPort.derivedContexts.length, 3);
      assert.ok(browserPort.derivedContexts.every((c) => Boolean(c.proxy?.server)));
      assert.equal(JSON.stringify(err.detail).includes('198.51.100'), false);
      assert.equal(JSON.stringify(err.detail).includes('secret-qingguo-key'), false);
    });

    it.each([
      {
        label: 'ERR_TUNNEL_CONNECTION_FAILED (HTTP 407) maps to E_PROXY_AUTH',
        override: () => ({
          observePage: vi.fn(async () => {
            throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED');
          }),
        }),
        expectedCode: 'E_PROXY_AUTH',
        expectedExit: ExitCodes.AUTH,
        expectedContexts: 1,
      },
      {
        label: 'E_PROXY_QUOTA stops immediately on attempt 1',
        override: () => ({
          acquireProxyLease: vi.fn(async () => {
            throw new PddCliError({
              code: 'E_PROXY_QUOTA',
              message: '青果代理余额不足或提取额度已耗尽',
              exitCode: ExitCodes.BUSINESS,
            });
          }),
        }),
        expectedCode: 'E_PROXY_QUOTA',
        expectedExit: ExitCodes.BUSINESS,
        expectedContexts: 0,
      },
      {
        label: 'E_PROXY_RATE_LIMIT stops immediately on attempt 1',
        override: () => ({
          acquireProxyLease: vi.fn(async () => {
            throw new PddCliError({
              code: 'E_PROXY_RATE_LIMIT',
              message: '青果代理提取接口请求过于频繁',
              exitCode: ExitCodes.RATE_LIMIT,
            });
          }),
        }),
        expectedCode: 'E_PROXY_RATE_LIMIT',
        expectedExit: ExitCodes.RATE_LIMIT,
        expectedContexts: 0,
      },
      {
        label: 'unclassified browser error maps to E_GENERAL and stops on attempt 1',
        override: () => ({
          observePage: vi.fn(async () => {
            throw new Error('unexpected internal frame crash');
          }),
        }),
        expectedCode: 'E_GENERAL',
        expectedExit: ExitCodes.GENERAL,
        expectedContexts: 1,
      },
    ])('stops immediately without retry when $label', async ({
      override,
      expectedCode,
      expectedExit,
      expectedContexts,
    }) => {
      seedConsumerAccount();
      const { ctx, browserPort, spies } = await makePublishCtx({
        env: qingguoProxyEnv,
        ...override(),
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === expectedCode
          && err.exitCode === expectedExit,
      );

      assert.equal(spies.acquireProxyLease.mock.calls.length, 1);
      assert.equal(browserPort.derivedContexts.length, expectedContexts);
    });

    it('aborts proxy retry backoff immediately when ctx.signal aborts', async () => {
      vi.useFakeTimers();
      seedConsumerAccount();

      const acquireProxyLease = vi.fn(async () => {
        throw new PddCliError({
          code: 'E_PROXY_UNAVAILABLE',
          message: 'unavailable',
          exitCode: ExitCodes.NETWORK,
        });
      });
      const controller = new AbortController();
      const { ctx } = await makePublishCtx({
        signal: controller.signal,
        env: qingguoProxyEnv,
        acquireProxyLease,
      });

      const pending = publishGoodsFromLink(ctx, '123456');
      const captured = pending.catch((err) => err);

      await vi.advanceTimersByTimeAsync(100);
      controller.abort();

      const err = await captured;
      assert.ok(err instanceof PddCliError);
      assert.equal(err.code, 'E_TIMEOUT');
      assert.equal(acquireProxyLease.mock.calls.length, 1);
    });

    it('rejects invalid proxy config before cost template call on cache miss, and skips cooldown/proxy on cache hit', async () => {
      const invalidProxyEnv = { PDD_SOURCE_PROXY_PROVIDER: 'qingguo', PDD_QINGGUO_AUTH_KEY: '' };
      const miss = await makePublishCtx({ env: invalidProxyEnv });
      await assert.rejects(
        publishGoodsFromLink(miss.ctx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
      );
      assert.equal(miss.transport.calls.length, 0);
      assert.equal(miss.spies.acquireProxyLease.mock.calls.length, 0);

      const hitCooldown = createMemoryScrapeCooldown();
      hitCooldown.tripNow();
      const hitCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const hit = await makePublishCtx({
        scrapeCooldown: hitCooldown,
        sourceGoodsCache: hitCache,
        env: invalidProxyEnv,
      });

      const result = await publishGoodsFromLink(hit.ctx, '123456');
      assert.equal(result.data.status, '草稿');
      assert.equal(hitCooldown.calls.check, 0);
      assert.equal(hit.spies.acquireProxyLease.mock.calls.length, 0);
      assert.equal(hit.browserPort.derivedContexts.length, 0);
    });

    it('forwards normalized PDD_QINGGUO_AREA to proxy lease acquisition and rejects malformed area before cost templates', async () => {
      seedConsumerAccount();

      const ok = await makePublishCtx({ env: { ...qingguoProxyEnv, PDD_QINGGUO_AREA: '330100, 440300' } });
      await publishGoodsFromLink(ok.ctx, '123456');
      assert.equal(ok.spies.acquireProxyLease.mock.calls[0][0].area, '330100,440300');

      const invalid = await makePublishCtx({ env: { ...qingguoProxyEnv, PDD_QINGGUO_AREA: 'bad-area' } });
      await assert.rejects(
        publishGoodsFromLink(invalid.ctx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE',
      );
      assert.equal(invalid.transport.calls.length, 0);
    });
  });

  describe('empty-shell classification and immediate stop', () => {
    it('classifies _fiberFound=false & _appWall=true as E_RATE_LIMIT, records cooldown, preserves consumer auth, and stops proxy rotation', async () => {
      const consumer = seedConsumerAccount();
      const cooldown = createMemoryScrapeCooldown({ threshold: 2, cooldownMs: 60_000 });
      const sourceCache = createMemorySourceCache();

      const observeEmptyShell = vi.fn(async () => ({
        earlyObservation: null,
        pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
        observation: {
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
      }));

      const first = await makePublishCtx({
        scrapeCooldown: cooldown,
        sourceGoodsCache: sourceCache,
        env: qingguoProxyEnv,
        observePage: observeEmptyShell,
      });
      const beforeRepoState = captureRepoIsolationState('123456');
      await assert.rejects(
        publishGoodsFromLink(first.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.exitCode === ExitCodes.RATE_LIMIT
          && err.detail?.reason === 'empty_shell'
          && err.detail?.cooldown_triggered === false,
      );

      assert.equal(first.spies.acquireProxyLease.mock.calls.length, 1);
      assert.equal(first.browserPort.derivedContexts.length, 1);
      assert.equal(cooldown.calls.recordSoftBlock, 1);
      assert.equal(cooldown.status().consecutiveSoftBlock, 1);
      assert.equal(loadAuthState(consumer.id).exists, true);
      assert.equal(sourceCache.peek('123456'), null);

      const second = await makePublishCtx({
        scrapeCooldown: cooldown,
        sourceGoodsCache: sourceCache,
        env: qingguoProxyEnv,
        observePage: observeEmptyShell,
      });
      await assert.rejects(
        publishGoodsFromLink(second.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'empty_shell'
          && err.detail?.cooldown_triggered === true,
      );
      assert.equal(second.spies.acquireProxyLease.mock.calls.length, 1);
      assert.equal(cooldown.status().consecutiveSoftBlock, 2);
      assert.ok(cooldown.status().cooldownRemainingMs > 0);
      assert.equal(loadAuthState(consumer.id).exists, true);

      const third = await makePublishCtx({
        scrapeCooldown: cooldown,
        sourceGoodsCache: sourceCache,
        env: qingguoProxyEnv,
        observePage: observeEmptyShell,
      });
      await assert.rejects(
        publishGoodsFromLink(third.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'ip_soft_block'
          && err.detail?.cooldown_triggered === true,
      );
      assert.equal(third.transport.calls.length, 0);
      assert.equal(third.spies.acquireProxyLease.mock.calls.length, 0);
      assertRepoIsolationUnchanged(beforeRepoState);
    });
  });

  describe('consumer account degradation auth cleanup', () => {
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

      const cooldown = createMemoryScrapeCooldown({ threshold: 2, cooldownMs: 60_000 });
      const sourceCache = createMemorySourceCache();
      const { ctx, browserPort, spies } = await makePublishCtx({
        scrapeCooldown: cooldown,
        sourceGoodsCache: sourceCache,
        env: qingguoProxyEnv,
        observePage: vi.fn(async () => ({
          earlyObservation: null,
          observation: extracted,
          pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN_TOKEN',
        })),
      });

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
      assert.equal(spies.acquireProxyLease.mock.calls.length, 1);
      assert.equal(browserPort.derivedContexts.length, 1);
      assert.equal(sourceCache.peek('123456'), null);
    });
  });

  describe('5-round same-page dynamic property convergence', () => {
    it('always inspects dynamic property template once even with zero skipped initial properties', async () => {
      seedConsumerAccount();
      const { ctx, spies } = await makePublishCtx();

      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(result.data.status, '草稿');
      assert.equal(spies.session.readDynamicTemplate.mock.calls.length, 1);
      assert.equal(spies.session.fillDependentProperties.mock.calls.length, 0);
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
      const { ctx, spies } = await makePublishCtx({
        sourceGoodsCache: sourceCache,
        sessionHarnessOptions: {
          readDynamicTemplateImpl: async (currentTemplate) => {
            const added = dynamicByRound[round++];
            if (!added) return currentTemplate;
            return mergeDynamicPropertyTemplate(currentTemplate, [{ templateModuleId: 8001, ...added }]);
          },
        },
      });

      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(spies.session.readDynamicTemplate.mock.calls.length, 5);
      assert.equal(spies.session.fillDependentProperties.mock.calls.length, 4);
      assert.deepEqual(
        spies.session.fillDependentProperties.mock.calls.map(([plan]) => plan.map((item) => item.name)),
        [['材质'], ['成分含量'], ['风格'], ['领型']],
      );
      const savedOptions = spies.session.saveDraft.mock.calls[0][0];
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
      const { ctx, spies } = await makePublishCtx({
        sourceGoodsCache: sourceCache,
        sessionHarnessOptions: {
          readDynamicTemplateImpl: async (currentTemplate) => {
            const added = dynamicByRound[round++];
            return mergeDynamicPropertyTemplate(currentTemplate, [{ templateModuleId: 8001, ...added }]);
          },
        },
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.exitCode === ExitCodes.BUSINESS
          && err.detail?.issues?.includes('dynamic_property_template_unstable'),
      );

      assert.equal(spies.session.readDynamicTemplate.mock.calls.length, 5);
      assert.equal(spies.session.fillDependentProperties.mock.calls.length, 5);
      assert.equal(spies.session.disableSizeChart.mock.calls.length, 0);
      assert.equal(spies.session.fillFullCountDiscount.mock.calls.length, 0);
      assert.equal(spies.session.saveDraft.mock.calls.length, 0);
      assert.notEqual(sourceCache.peek('123456'), null);
    });

    it('fails closed on dynamic_property_template_invalid before size-chart or save', async () => {
      const invalidCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const { ctx, spies } = await makePublishCtx({
        sourceGoodsCache: invalidCache,
        sessionHarnessOptions: {
          readDynamicTemplateImpl: async () => ({
            ok: false,
            issues: ['dynamic_property_template_invalid'],
            propertysTid: 9001,
            properties: [],
          }),
        },
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('dynamic_property_template_invalid'),
      );
      assert.equal(spies.session.disableSizeChart.mock.calls.length, 0);
      assert.equal(spies.session.saveDraft.mock.calls.length, 0);
      assert.notEqual(invalidCache.peek('123456'), null);
    });

    it('fails closed on an unmapped newly revealed required property before size-chart or save', async () => {
      const missingReqCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const { ctx, spies } = await makePublishCtx({
        sourceGoodsCache: missingReqCache,
        sessionHarnessOptions: {
          readDynamicTemplateImpl: async (currentTemplate) => ({
            ok: true,
            issues: [],
            propertysTid: currentTemplate.propertysTid,
            properties: [
              ...currentTemplate.properties,
              toNormalizedTemplateProperty(makeRawProperty(1099, 2099, '199', '必填新属性', ['A'])),
            ],
          }),
        },
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('required_property_unmapped'),
      );
      assert.equal(spies.session.disableSizeChart.mock.calls.length, 0);
      assert.equal(spies.session.saveDraft.mock.calls.length, 0);
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
      const { ctx } = await makePublishCtx({ sourceGoodsCache: partialCache });
      const partialResult = await publishGoodsFromLink(ctx, '123456');

      assert.deepEqual(partialResult.data.property_mapping, { mapped_count: 1, skipped_count: 1 });
      assert.deepEqual(partialResult.warnings, ['property_mapping_partial']);
    });

    it('stops before fillBaseAndMedia when initial template has an unmapped important property', async () => {
      const cache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const { ctx, spies } = await makePublishCtx({
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
      assert.equal(spies.session.fillBaseAndMedia.mock.calls.length, 0);
      assert.equal(spies.session.saveDraft.mock.calls.length, 0);
    });
  });

  describe('strict outbound payload check, draft verification, and deferred v4 cache cleanup', () => {
    it('enforces save-phase ordering and strict payload expectations, keeping draftOnly safe from submit', async () => {
      const order = [];
      const sourceCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const { ctx, transport, spies } = await makePublishCtx({
        costTemplates: [
          { id: 3001, name: 'Template A' },
          { id: 3002, name: 'Template B' },
        ],
        sourceGoodsCache: sourceCache,
        fullCountDiscountRate: 0.88,
        sessionHarnessOptions: {
          order,
          disableSizeChartImpl: async () => ({ changed: true, disabled: true }),
          draftDetailResponse: { success: false, error_code: 5000 },
        },
      });

      const result = await publishGoodsFromLink(ctx, '123456', { draftOnly: true, costTemplateId: '3002' });

      assert.deepEqual(order, [
        'fillBaseAndMedia',
        'readDynamicTemplate',
        'disableSizeChart',
        'fillFullCountDiscount',
        'saveDraft',
      ]);
      assert.equal(spies.session.fillFullCountDiscount.mock.calls[0][0], 0.88);
      const [saveOpts] = spies.session.saveDraft.mock.calls[0];
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
      assert.equal(transport.calls.some((call) => call.spec === GOODS_PUBLISH_SUBMIT), false);
      assert.equal(sourceCache.peek('123456'), null);
    });

    it('fails strict draft detail verification when available response confirms missing fields and retains v4 cache', async () => {
      const sourceCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });
      const { ctx, transport } = await makePublishCtx({
        sourceGoodsCache: sourceCache,
        sessionHarnessOptions: {
          draftDetailResponse: {
            success: true,
            error_code: 1000000,
            result: { goods_name: '', cost_template_id: 3001, gallery: ['https://img.pddpic.com/carousel-1.jpg'] },
          },
        },
      });

      await assert.rejects(
        publishGoodsFromLink(ctx, '123456', { draftOnly: false }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('title_empty')
          && err.detail?.stage === 'populate_and_save_draft'
          && err.detail?.source_cached === true,
      );
      assert.equal(transport.calls.some((call) => call.spec === GOODS_PUBLISH_SUBMIT), false);
      assert.notEqual(sourceCache.peek('123456'), null);
    });

    it('retains v4 cache when strict save payload fails, reuses cache on retry without scraping, and clears cache after draft success', async () => {
      seedConsumerAccount();
      const sourceCache = createMemorySourceCache();
      const beforeRepoState = captureRepoIsolationState('123456');

      const fail = await makePublishCtx({
        sourceGoodsCache: sourceCache,
        sessionHarnessOptions: {
          editPayloadOverride: { goods_properties: [] },
        },
      });
      await assert.rejects(
        publishGoodsFromLink(fail.ctx, '123456', { draftOnly: false }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('goods_properties_missing'),
      );

      assert.equal(fail.transport.calls.some((call) => call.spec === GOODS_PUBLISH_SUBMIT), false);
      assert.notEqual(sourceCache.peek('123456'), null);
      assert.deepEqual(sourceCache.calls.remove, []);

      const retry = await makePublishCtx({ sourceGoodsCache: sourceCache });
      const retryResult = await publishGoodsFromLink(retry.ctx, '123456', { draftOnly: true });

      assert.equal(retryResult.data.status, '草稿');
      assert.equal(retry.browserPort.derivedContexts.length, 0);
      assert.equal(retry.spies.observePage.mock.calls.length, 0);
      assert.deepEqual(sourceCache.calls.remove, ['123456']);
      assert.equal(sourceCache.peek('123456'), null);
      assertRepoIsolationUnchanged(beforeRepoState);
    });

    it('retains v4 cache if --confirm submit is rejected via EndpointPort errorMapper and clears cache only after submit succeeds', async () => {
      const sourceCache = createMemorySourceCache({ 123456: makeNormalizedCachedSource() });

      const rejected = await makePublishCtx({
        sourceGoodsCache: sourceCache,
        submitResponse: { success: false, error_code: 9876 },
      });

      await assert.rejects(
        publishGoodsFromLink(rejected.ctx, '123456', { draftOnly: false }),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.hint === '保存草稿已完成，但提交发布被平台拒绝'
          && err.detail?.errorCode === 9876
          && err.detail?.stage === 'submit_draft'
          && err.detail?.source_cached === true,
      );
      assert.notEqual(sourceCache.peek('123456'), null);
      assert.deepEqual(sourceCache.calls.remove, []);

      const success = await makePublishCtx({ sourceGoodsCache: sourceCache });
      const submitted = await publishGoodsFromLink(success.ctx, '123456', { draftOnly: false });

      assert.equal(submitted.data.status, '已提交');
      assert.equal(
        success.transport.calls.filter((call) => call.spec === GOODS_PUBLISH_SUBMIT).length,
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

      const { ctx } = await makePublishCtx({ sourceGoodsCache: sourceCache });
      const result = await publishGoodsFromLink(ctx, '123456');

      assert.equal(result.data.status, '草稿');
      assert.deepEqual(result.warnings, ['source_cache_cleanup_failed']);
      assert.deepEqual(sourceCache.calls.read, ['123456']);
      assert.deepEqual(sourceCache.calls.write, ['123456']);
      assert.deepEqual(sourceCache.calls.remove, ['123456']);
    });

    it('stops pre-draft evidence or cost-template errors before category resolution and draft creation', async () => {
      const noTemplate = await makePublishCtx({ costTemplates: [] });
      await assert.rejects(
        publishGoodsFromLink(noTemplate.ctx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_BUSINESS',
      );
      assert.equal(noTemplate.browserPort.derivedContexts.length, 0);

      const badTemplate = await makePublishCtx({ costTemplates: [{ id: 3001, name: 'A' }] });
      await assert.rejects(
        publishGoodsFromLink(badTemplate.ctx, '123456', { costTemplateId: '9999' }),
        (err) => err instanceof PddCliError && err.code === 'E_USAGE',
      );
      assert.equal(badTemplate.browserPort.derivedContexts.length, 0);

      const missingPropsCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({ goodsProperties: [] }),
      });
      const missingProps = await makePublishCtx({ sourceGoodsCache: missingPropsCache });
      await assert.rejects(
        publishGoodsFromLink(missingProps.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('source_properties_missing'),
      );
      assert.equal(missingProps.spies.categoryResolve.mock.calls.length, 0);
      assert.equal(missingProps.spies.openCategoryDraft.mock.calls.length, 0);

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
      const missingColor = await makePublishCtx({ sourceGoodsCache: missingColorCache });
      await assert.rejects(
        publishGoodsFromLink(missingColor.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('sku_preview_color_dimension_missing'),
      );
      assert.equal(missingColor.spies.categoryResolve.mock.calls.length, 0);
      assert.equal(missingColor.spies.openCategoryDraft.mock.calls.length, 0);
    });

    it('stops invalid pricing plan and invalid fullCountDiscountRate before category resolution and draft creation', async () => {
      const badRefCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource({ sourceReferencePriceCents: 2800 }),
      });
      const badRef = await makePublishCtx({ sourceGoodsCache: badRefCache });
      await assert.rejects(
        publishGoodsFromLink(badRef.ctx, '123456'),
        (err) => err instanceof PddCliError
          && err.code === 'E_BUSINESS'
          && err.detail?.issues?.includes('pricing_plan_invalid'),
      );
      assert.equal(badRef.spies.categoryResolve.mock.calls.length, 0);
      assert.equal(badRef.spies.openCategoryDraft.mock.calls.length, 0);

      const validCache = createMemorySourceCache({
        123456: makeNormalizedCachedSource(),
      });
      const badDiscount = await makePublishCtx({ sourceGoodsCache: validCache, fullCountDiscountRate: 0.49 });
      await assert.rejects(
        publishGoodsFromLink(badDiscount.ctx, '123456'),
        (err) => err instanceof PddCliError && err.code === 'E_CONFIG_INVALID',
      );
      assert.equal(badDiscount.spies.categoryResolve.mock.calls.length, 0);
      assert.equal(badDiscount.spies.openCategoryDraft.mock.calls.length, 0);
    });
  });
});
