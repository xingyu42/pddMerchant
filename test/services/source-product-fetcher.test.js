import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { ExitCodes, PddCliError } from '../../src/infra/errors.js';
import { createLogger } from '../../src/infra/logger.js';
import { createScrapeCooldown } from '../../src/infra/scrape-cooldown.js';
import { createSourceProductFetcher } from '../../src/services/goods-publish/source-product-fetcher.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

afterEach(() => {
  vi.useRealTimers();
  createLogger({ level: 'silent' });
});

function seedConsumerAccount({
  identity = 'consumer-2001',
  displayName = 'Fetcher Consumer',
  cookies = [{ name: 'PDDAccessToken', value: 'token-123', domain: '.yangkeduo.com', path: '/' }],
} = {}) {
  const account = insertAccount({ kind: 'consumer', identity, displayName }, { setDefault: true });
  saveAuthStateSnapshot({ cookies, origins: [] }, account.id);
  return account;
}

function makeMemoryCache(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [String(k), structuredClone(v)]));
  const calls = { read: [], write: [], remove: [] };
  const faults = { read: null, write: null, remove: null };
  return {
    calls,
    faults,
    async read(goodsId) {
      calls.read.push(String(goodsId));
      if (faults.read) throw faults.read;
      const entry = store.get(String(goodsId));
      return entry ? structuredClone(entry) : null;
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

function makeValidObservation(overrides = {}) {
  return {
    goodsID: '123456',
    goodsName: 'Fetcher Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
    skuText: '颜色\n白色',
    properties: '',
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
    _fiberFound: true,
    _maskHint: false,
    _url: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
    _title: 'Fetcher Cotton Tee',
    _bodyLen: 800,
    _roots: 'app',
    _appWall: false,
    _decodedSkuSource: {
      goodsID: '123456',
      linePrice: '59',
      skuDimensions: [{ name: '颜色', values: [{ id: '1', text: '白色' }] }],
      skus: [
        {
          skuID: 'sku-w',
          groupPrice: '14.70',
          normalPrice: '25.80',
          quantity: 10,
          thumbUrl: 'https://img.pddpic.com/white.jpg',
          specValues: { 颜色: '白色' },
        },
      ],
      goodsProperties: [{ name: '面料俗称', values: ['棉'], refPid: '101', referenceId: '1' }],
      visitedObjects: 8,
    },
    ...overrides,
  };
}

function makeCachedSource() {
  return {
    goodsID: '123456',
    goodsName: 'Cached Cotton Tee',
    catID: 1003,
    catID1: 1001,
    catID2: 1002,
    catID3: 1003,
    price: '14.70',
    sourceReferencePriceCents: 5900,
    carousel: ['https://img.pddpic.com/carousel-1.jpg'],
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
    detailImgs: ['https://img.pddpic.com/detail-1.jpg'],
  };
}

function makeFakeLogger() {
  return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const proxyEnv = { PDD_SOURCE_PROXY_PROVIDER: 'qingguo', PDD_QINGGUO_AUTH_KEY: 'secret-key' };

describe('SourceProductFetcher', () => {
  it('checks v4 cache first on prepare(), skips cooldown/proxy config on hit, and emits source_cache_cleanup_failed when clearCache fails', async () => {
    const cooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    cooldown.recordSoftBlock({ reason: 'empty_shell' });
    const cache = makeMemoryCache({ 123456: makeCachedSource() });
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const acquireProxyLease = vi.fn();

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: { PDD_SOURCE_PROXY_PROVIDER: 'qingguo', PDD_QINGGUO_AUTH_KEY: '' },
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        log: makeFakeLogger(),
      });
      assert.deepEqual(Object.keys(fetcher), ['prepare']);

      const acquisition = await fetcher.prepare('https://mobile.yangkeduo.com/goods.html?goods_id=123456');
      assert.equal(acquisition.goodsId, '123456');
      assert.equal(acquisition.cacheHit, true);

      const source = await acquisition.fetch();
      assert.equal(source.goodsID, '123456');
      assert.equal(acquireProxyLease.mock.calls.length, 0);
      assert.equal(browser.derivedContexts.length, 0);

      cache.faults.remove = new Error('EACCES');
      const warnings = [];
      await acquisition.clearCache(warnings);
      assert.deepEqual(warnings, ['source_cache_cleanup_failed']);
    } finally {
      await session.close();
    }
  });

  it('validates cooldown and Proxy-Required Fetch config in prepare() before fetch or lease acquisition', async () => {
    const cooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const acquireProxyLease = vi.fn();

    const badProxyFetcher = createSourceProductFetcher({
      sourceCache: cache,
      scrapeCooldown: cooldown,
      sourceProxyEnv: { PDD_SOURCE_PROXY_PROVIDER: 'qingguo', PDD_QINGGUO_AUTH_KEY: '' },
      acquireProxyLease,
      log: makeFakeLogger(),
    });
    await assert.rejects(
      badProxyFetcher.prepare('123456'),
      (err) => err instanceof PddCliError && err.code === 'E_USAGE',
    );
    assert.equal(acquireProxyLease.mock.calls.length, 0);

    cooldown.recordSoftBlock({ reason: 'empty_shell' });
    const cooledFetcher = createSourceProductFetcher({
      sourceCache: cache,
      scrapeCooldown: cooldown,
      sourceProxyEnv: proxyEnv,
      acquireProxyLease,
      log: makeFakeLogger(),
    });
    await assert.rejects(
      cooledFetcher.prepare('123456'),
      (err) => err instanceof PddCliError && err.code === 'E_RATE_LIMIT' && err.detail?.reason === 'ip_soft_block',
    );
    assert.equal(acquireProxyLease.mock.calls.length, 0);
  });

  it('derives read-only Proxy Attempt Contexts via BrowserRuntimePort and retries only E_PROXY_UNAVAILABLE/E_PROXY_NETWORK with [500, 1000]ms backoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-25T00:00:00Z'));
    seedConsumerAccount();

    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    cooldown.recordSoftBlock({ reason: 'empty_shell' });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const attemptTimes = [];

    const acquireProxyLease = vi.fn(async () => {
      attemptTimes.push(Date.now());
      const index = attemptTimes.length;
      if (index === 1) {
        throw new PddCliError({ code: 'E_PROXY_UNAVAILABLE', message: 'busy', exitCode: ExitCodes.NETWORK });
      }
      return {
        provider: 'qingguo',
        server: `http://198.51.100.${index}:42001`,
        expiresAt: Date.now() + 120_000,
        area: '330100',
        isp: '电信',
        requestIdHash: `fp:req00${index}`,
      };
    });

    let observeCalls = 0;
    const observePage = vi.fn(async (page) => {
      observeCalls += 1;
      if (observeCalls === 1) throw new Error('page.goto: net::ERR_PROXY_CONNECTION_FAILED');
      return {
        earlyObservation: null,
        observation: makeValidObservation(),
        pageUrl: page.url(),
      };
    });

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        observePage,
        log: makeFakeLogger(),
      });

      const acquisition = await fetcher.prepare('123456');
      assert.equal(acquisition.cacheHit, false);

      const warnings = [];
      const pending = acquisition.fetch({ warnings });
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);
      const source = await pending;

      assert.equal(source.goodsID, '123456');
      assert.equal(source.sourceReferencePriceCents, 5900);
      assert.deepEqual(warnings, ['source_proxy_retry_recovered']);
      assert.deepEqual(acquisition.warnings, ['source_proxy_retry_recovered']);
      assert.deepEqual(attemptTimes.map((t) => t - attemptTimes[0]), [0, 500, 1500]);
      assert.equal(browser.derivedContexts.length, 2);
      assert.equal(browser.derivedContexts[0].proxy.server, 'http://198.51.100.2:42001');
      assert.equal(browser.derivedContexts[1].proxy.server, 'http://198.51.100.3:42001');
      assert.equal(cooldown.status().consecutiveSoftBlock, 0);
      assert.deepEqual(cache.calls.write, ['123456']);
    } finally {
      await session.close();
    }
  });

  it('fails once on ERR_TUNNEL_CONNECTION_FAILED (E_PROXY_AUTH) without rotating proxies', async () => {
    seedConsumerAccount();
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const acquireProxyLease = vi.fn(async () => ({
      provider: 'qingguo',
      server: 'http://198.51.100.1:42001',
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: 'fp:req1',
    }));
    const observePage = vi.fn(async () => {
      throw new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED');
    });

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        observePage,
        log: makeFakeLogger(),
      });
      const acquisition = await fetcher.prepare('123456');
      await assert.rejects(
        acquisition.fetch(),
        (err) => err instanceof PddCliError && err.code === 'E_PROXY_AUTH' && err.exitCode === ExitCodes.AUTH,
      );
      assert.equal(acquireProxyLease.mock.calls.length, 1);
      assert.equal(browser.derivedContexts.length, 1);
    } finally {
      await session.close();
    }
  });

  it('classifies empty shell before masking, records cooldown, preserves consumer auth, and stops proxy rotation', async () => {
    const consumer = seedConsumerAccount();
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const acquireProxyLease = vi.fn(async () => ({
      provider: 'qingguo',
      server: 'http://198.51.100.1:42001',
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: 'fp:req1',
    }));
    const observePage = vi.fn(async () => ({
      earlyObservation: null,
      observation: makeValidObservation({
        goodsName: '拼多多',
        catID: null,
        catID3: null,
        price: null,
        carousel: [],
        skuText: '',
        _fiberFound: false,
        _maskHint: true,
        _appWall: true,
        _decodedSkuSource: null,
      }),
      pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET',
    }));

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        observePage,
        log: makeFakeLogger(),
      });
      const acquisition = await fetcher.prepare('123456');
      await assert.rejects(
        acquisition.fetch(),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'empty_shell'
          && err.detail?.cooldown_triggered === false,
      );
      assert.equal(acquireProxyLease.mock.calls.length, 1);
      assert.equal(cooldown.status().consecutiveSoftBlock, 1);
      assert.equal(loadAuthState(consumer.id).exists, true);
      assert.equal(cache.peek('123456'), null);
    } finally {
      await session.close();
    }
  });

  it('deletes consumer auth state via SQLite storage and skips cooldown write on Consumer Account Degradation', async () => {
    const consumer = seedConsumerAccount();
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const acquireProxyLease = vi.fn(async () => ({
      provider: 'qingguo',
      server: 'http://198.51.100.1:42001',
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: 'fp:req1',
    }));
    const observePage = vi.fn(async () => ({
      earlyObservation: null,
      observation: makeValidObservation({
        price: '0',
        _fiberFound: true,
        _maskHint: false,
        _appWall: false,
        _decodedSkuSource: null,
      }),
      pageUrl: 'https://mobile.yangkeduo.com/goods.html?goods_id=123456&uin=SECRET_UIN',
    }));

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        observePage,
        log: makeFakeLogger(),
      });
      const acquisition = await fetcher.prepare('123456');
      let caught;
      try {
        await acquisition.fetch();
      } catch (err) {
        caught = err;
      }

      assert.ok(caught instanceof PddCliError);
      assert.equal(caught.code, 'E_RISK_CONTROL_SOFT');
      assert.equal(caught.detail.reason, 'price_masked');
      assert.equal(caught.detail.path, '/goods.html');
      assert.equal(caught.detail.consumer_account_degraded, true);
      assert.equal(caught.detail.consumer_auth_removed, true);
      assert.equal(JSON.stringify(caught.detail).includes('SECRET_UIN'), false);
      assert.equal(loadAuthState(consumer.id).exists, false);
      assert.equal(cooldown.status().consecutiveSoftBlock, 0);
      assert.equal(acquireProxyLease.mock.calls.length, 1);
      assert.equal(cache.peek('123456'), null);
    } finally {
      await session.close();
    }
  });

  it('aborts proxy retry backoff immediately on signal abort and fails closed after 3 exhausted attempts', async () => {
    vi.useFakeTimers();
    seedConsumerAccount();
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();

    const abortLease = vi.fn(async () => {
      throw new PddCliError({ code: 'E_PROXY_UNAVAILABLE', message: 'unavailable', exitCode: ExitCodes.NETWORK });
    });

    try {
      const controller = new AbortController();
      const abortFetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease: abortLease,
        log: makeFakeLogger(),
      });
      const acq1 = await abortFetcher.prepare('123456');
      const pendingAbort = acq1.fetch({ signal: controller.signal }).catch((err) => err);
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      const abortErr = await pendingAbort;
      assert.equal(abortErr.code, 'E_TIMEOUT');
      assert.equal(abortLease.mock.calls.length, 1);

      const exhaustLease = vi.fn(async () => ({
        provider: 'qingguo',
        server: 'http://198.51.100.9:42001',
        expiresAt: Date.now() + 120_000,
        area: '330100',
        isp: '电信',
        requestIdHash: 'fp:req9',
      }));
      const exhaustObserve = vi.fn(async () => {
        throw new Error('TimeoutError: page.goto timed out');
      });
      const exhaustFetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease: exhaustLease,
        observePage: exhaustObserve,
        log: makeFakeLogger(),
      });
      const acq2 = await exhaustFetcher.prepare('123456');
      const pendingExhaust = acq2.fetch().catch((err) => err);
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(1000);
      const exhaustErr = await pendingExhaust;
      assert.equal(exhaustErr.code, 'E_PROXY_NETWORK');
      assert.equal(exhaustLease.mock.calls.length, 3);
      assert.equal(browser.derivedContexts.length, 3);
      assert.ok(browser.derivedContexts.every((ctx) => ctx.proxy?.server === 'http://198.51.100.9:42001'));
    } finally {
      await session.close();
    }
  });

  it('keeps saved consumer auth snapshot read-only across proxy fetch and stops immediately on quota/rate-limit/hard-challenge errors', async () => {
    const consumer = seedConsumerAccount({
      cookies: [{ name: 'PDDAccessToken', value: 'original-immutable-token', domain: '.yangkeduo.com', path: '/' }],
    });
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();

    const acquireProxyLease = vi.fn(async () => ({
      provider: 'qingguo',
      server: 'http://198.51.100.10:42001',
      expiresAt: Date.now() + 120_000,
      area: '330100',
      isp: '电信',
      requestIdHash: 'fp:req10',
    }));

    try {
      const okFetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease,
        observePage: async (page) => {
          const ctx = page.context();
          const cookies = await ctx.cookies();
          cookies[0].value = 'mutated-in-memory';
          return { earlyObservation: null, observation: makeValidObservation(), pageUrl: page.url() };
        },
        log: makeFakeLogger(),
      });
      const acq = await okFetcher.prepare('123456');
      await acq.fetch();
      assert.equal(loadAuthState(consumer.id).state.cookies[0].value, 'original-immutable-token');

      const quotaFetcher = createSourceProductFetcher({
        sourceCache: makeMemoryCache(),
        scrapeCooldown: cooldown,
        sourceProxyEnv: proxyEnv,
        browserPort: browser,
        browserSession: session,
        acquireProxyLease: vi.fn(async () => {
          throw new PddCliError({ code: 'E_PROXY_QUOTA', message: 'quota', exitCode: ExitCodes.BUSINESS });
        }),
        log: makeFakeLogger(),
      });
      const acqQuota = await quotaFetcher.prepare('123456');
      await assert.rejects(acqQuota.fetch(), { code: 'E_PROXY_QUOTA' });
    } finally {
      await session.close();
    }
  });

  it('routes diagnostic logs to the logger created via createLogger() after fetcher construction', async () => {
    seedConsumerAccount();
    createLogger({ level: 'silent' });
    const cooldown = createScrapeCooldown({ threshold: 2, cooldownMs: 60_000, statePath: null });
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        browserPort: browser,
        browserSession: session,
        observePage: async (page) => ({
          earlyObservation: null,
          observation: makeValidObservation(),
          pageUrl: page.url(),
        }),
      });

      const chunks = [];
      createLogger({
        level: 'debug',
        destination: { write(chunk) { chunks.push(String(chunk)); } },
      });

      const acq = await fetcher.prepare('123456');
      await acq.fetch();
      const output = chunks.join('');
      assert.match(output, /goods-publish: Phase A — scraping source/);
      assert.match(output, /source-scrape extracted fields/);
      assert.match(output, /goods-publish: source cache written/);
    } finally {
      await session.close();
    }
  });

  it('re-checks scrapeCooldown inside fetch() on cache miss and aborts before observePage or recordSuccess when cooldown activates after prepare()', async () => {
    seedConsumerAccount();
    const cooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    const recordSuccessSpy = vi.spyOn(cooldown, 'recordSuccess');
    const cache = makeMemoryCache();
    const browser = createInMemoryBrowserRuntime();
    const session = await browser.openSession();
    const observePage = vi.fn();

    try {
      const fetcher = createSourceProductFetcher({
        sourceCache: cache,
        scrapeCooldown: cooldown,
        browserPort: browser,
        browserSession: session,
        observePage,
        log: makeFakeLogger(),
      });
      const acquisition = await fetcher.prepare('123456');
      assert.equal(acquisition.cacheHit, false);

      cooldown.recordSoftBlock({ reason: 'empty_shell' });

      await assert.rejects(
        acquisition.fetch(),
        (err) => err instanceof PddCliError
          && err.code === 'E_RATE_LIMIT'
          && err.detail?.reason === 'ip_soft_block',
      );
      assert.equal(observePage.mock.calls.length, 0);
      assert.equal(browser.derivedContexts.length, 0);
      assert.equal(recordSuccessSpy.mock.calls.length, 0);
    } finally {
      await session.close();
    }
  });
});
