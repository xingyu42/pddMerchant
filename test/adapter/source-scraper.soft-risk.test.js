import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { scrapeSourceGoods } from '../../src/adapter/goods-publish/source-scraper.js';

// 构造满足 scrapeSourceGoods 所需的最小 Playwright page 桩（evaluate 计数用于验证短路）
function makePage(evaluateResult, { url = 'https://mobile.yangkeduo.com/goods.html?goods_id=1' } = {}) {
  const page = {
    evaluated: 0,
    url: () => url,
    goto: async () => null,
    waitForResponse: async () => null,
    waitForSelector: async () => null,
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
    evaluate: async () => { page.evaluated += 1; return evaluateResult; },
  };
  return page;
}

function makeRuntimePage(rawData) {
  const page = makePage(null);
  page.evaluate = async (fn, arg) => {
    page.evaluated += 1;
    const previous = {
      rawData: globalThis.rawData,
      document: globalThis.document,
      location: globalThis.location,
    };
    globalThis.rawData = rawData;
    globalThis.location = { href: 'https://mobile.yangkeduo.com/goods.html?goods_id=1' };
    globalThis.document = {
      body: { innerText: '¥ 8.22\n商品详情\n颜色\n红色' },
      getElementById: () => null,
      querySelector: (selector) => {
        if (selector === 'title') return { textContent: '测试商品' };
        if (selector === '[class*="sku"]') return { innerText: '颜色\n红色' };
        return null;
      },
      querySelectorAll: (selector) => selector.includes('mms-material-img')
        ? [{ src: 'https://img.pddpic.com/mms-material-img/test.jpg' }]
        : [],
    };
    try {
      return fn(arg);
    } finally {
      globalThis.rawData = previous.rawData;
      globalThis.document = previous.document;
      globalThis.location = previous.location;
    }
  };
  return page;
}

function makeHealth() {
  const calls = { check: 0, recordRisk: [], recordSuccess: 0 };
  return {
    calls,
    check() { calls.check++; },
    recordRisk(signal) { calls.recordRisk.push(signal); },
    recordSuccess() { calls.recordSuccess++; },
  };
}

// 冷却桩：blockCheck=true 模拟冷却期内 check() 短路抛错；threshold 控制 recordSoftBlock 何时触发冷却
function makeCooldown({ blockCheck = false, threshold = 1 } = {}) {
  const calls = { check: 0, recordSoftBlock: [], recordSuccess: 0 };
  let count = 0;
  return {
    calls,
    check() {
      calls.check++;
      if (blockCheck) {
        const err = new Error('IP 软风控冷却中');
        err.code = 'E_RATE_LIMIT';
        err.exitCode = 4;
        err.detail = { reason: 'ip_soft_block', cooldown_triggered: true, cooldown_remaining_ms: 7_200_000 };
        throw err;
      }
    },
    recordSoftBlock(signal) {
      calls.recordSoftBlock.push(signal);
      count += 1;
      const triggered = count >= threshold;
      return { cooldownTriggered: triggered, cooldownRemainingMs: triggered ? 7_200_000 : 0, cooldownUntil: 0, consecutiveSoftBlock: count };
    },
    recordSuccess() { calls.recordSuccess++; },
  };
}

const MASKED = {
  goodsID: '1', goodsName: '测试商品', catID: '15000', catID1: '1', catID2: '2', catID3: '15000',
  price: null, carousel: ['https://img.pddpic.com/x.jpg'], skuText: '', properties: '', detailImgs: [], _fiberFound: false,
};

const HEALTHY = {
  ...MASKED,
  price: '8.22',
  skuText: '颜色\n白色',
  skuDimensions: [],
  skus: [{
    sourceSkuId: 'sku-1',
    specValues: {},
    sourcePriceCents: 822,
    sourceNormalPriceCents: 899,
    stock: 10,
  }],
};
const EMPTY_SHELL = {
  ...MASKED,
  goodsName: '',
  catID: null,
  catID3: null,
  carousel: [],
  _appWall: true,
};

describe('scrapeSourceGoods 软风控脱敏检测', () => {
  let prevSimulate;
  beforeEach(() => {
    prevSimulate = process.env.PDD_SCRAPE_SIMULATE;
    process.env.PDD_SCRAPE_SIMULATE = '0';   // 跳过人为浏览模拟
  });
  afterEach(() => {
    if (prevSimulate === undefined) delete process.env.PDD_SCRAPE_SIMULATE;
    else process.env.PDD_SCRAPE_SIMULATE = prevSimulate;
  });

  it('price 脱敏(¥0/缺失) → E_RISK_CONTROL_SOFT(exit 4) 且不写全局冷却', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown({ threshold: 1 });
    await assert.rejects(
      () => scrapeSourceGoods(makePage(MASKED), '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.exitCode, 4);
        assert.equal(err.detail.reason, 'price_masked');
        return true;
      },
    );
    assert.equal(health.calls.recordRisk.length, 1, 'recordRisk should fire once');
    assert.equal(health.calls.recordRisk[0].type, 'desensitized');
    assert.equal(health.calls.recordSuccess, 0, 'recordSuccess must not fire on masked page');
    assert.equal(cooldown.calls.recordSoftBlock.length, 0);
  });

  it('反爬空壳优先判为 IP 降级，不误删消费者登录态，并记录持久冷却', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown({ threshold: 1 });
    await assert.rejects(
      () => scrapeSourceGoods(makePage(EMPTY_SHELL), '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RATE_LIMIT');
        assert.equal(err.detail.reason, 'empty_shell');
        assert.equal(err.detail.cooldown_triggered, true);
        return true;
      },
    );
    assert.equal(health.calls.recordRisk[0].reason, 'empty_shell');
    assert.equal(cooldown.calls.recordSoftBlock.length, 1);
  });

  it('SKU 缺失也会确认账号降级', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown({ threshold: 1 });
    const skuMissing = { ...HEALTHY, skuText: '' };
    await assert.rejects(
      () => scrapeSourceGoods(makePage(skuMissing), '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.detail.reason, 'sku_missing');
        return true;
      },
    );
    assert.equal(health.calls.recordRisk.length, 1);
    assert.equal(cooldown.calls.recordSoftBlock.length, 0);
  });

  it('returns data and records success when price is present', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown();
    const data = await scrapeSourceGoods(makePage(HEALTHY), '1', { sessionHealth: health, scrapeCooldown: cooldown });
    assert.equal(data.price, '8.22');
    assert.equal(health.calls.recordRisk.length, 0);
    assert.equal(health.calls.recordSuccess, 1);
    assert.equal(cooldown.calls.recordSuccess, 1, 'success must reset cooldown counter');
  });

  it('bounded runtime traversal ignores recommendations and selects the exact target with SKUs', async () => {
    const target = {
      goodsID: '1',
      goodsName: '测试商品',
      catID: '15000',
      catID1: '1',
      catID2: '2',
      catID3: '15000',
      skuDimensions: [{ name: '颜色', values: [{ id: 'red', text: '红色' }] }],
      skus: [{
        skuID: 'target-sku',
        groupPrice: 822,
        normalPrice: 899,
        quantity: 0,
        specValues: { 颜色: '红色' },
      }],
    };
    const rawData = {
      store: { initDataObj: { goods: { goodsID: '1', skus: [] } } },
      recommendations: [{ goodsID: '999', skus: [{ skuID: 'wrong-sku' }] }],
      hydrated: { target },
    };
    const health = makeHealth();
    const cooldown = makeCooldown();

    const data = await scrapeSourceGoods(makeRuntimePage(rawData), '1', {
      sessionHealth: health,
      scrapeCooldown: cooldown,
    });

    assert.equal(data.goodsID, '1');
    assert.equal(data.skus.length, 1);
    assert.equal(data.skus[0].sourceSkuId, 'target-sku');
    assert.equal(data.skus[0].stock, 0);
    assert.equal(health.calls.recordSuccess, 1);
  });

  it('throws on app-redirect placeholder even when price parses', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown();
    // 价格能解析，但页面带"前往APP查看价格"占位 → _maskHint 命中
    const masked = { ...HEALTHY, _maskHint: true };
    await assert.rejects(
      () => scrapeSourceGoods(makePage(masked), '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.detail.reason, 'app_redirect_placeholder');
        return true;
      },
    );
    assert.equal(health.calls.recordRisk[0].type, 'desensitized');
    assert.equal(health.calls.recordSuccess, 0);
    // 价格能解析(¥8.22) → 非 price 脱敏 → 视为单品门控，不计入跨进程冷却
    assert.equal(cooldown.calls.recordSoftBlock.length, 0);
  });

  it('short-circuits before page.evaluate when cooldown is active', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown({ blockCheck: true });
    const page = makePage(HEALTHY);
    await assert.rejects(
      () => scrapeSourceGoods(page, '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RATE_LIMIT');
        assert.equal(err.detail.reason, 'ip_soft_block');
        return true;
      },
    );
    assert.equal(page.evaluated, 0, 'cooldown gate MUST short-circuit before scraping');
    assert.equal(cooldown.calls.check, 1);
    assert.equal(health.calls.recordRisk.length, 0);
  });
});
