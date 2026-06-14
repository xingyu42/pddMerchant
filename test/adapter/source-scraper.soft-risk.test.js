import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { scrapeSourceGoods } from '../../src/adapter/goods-publish/source-scraper.js';

// 构造满足 scrapeSourceGoods 所需的最小 Playwright page 桩
function makePage(evaluateResult, { url = 'https://mobile.yangkeduo.com/goods.html?goods_id=1' } = {}) {
  return {
    url: () => url,
    goto: async () => null,
    waitForResponse: async () => null,
    waitForSelector: async () => null,
    locator: () => ({ first: () => ({ isVisible: async () => false }) }),
    evaluate: async () => evaluateResult,
  };
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

const MASKED = {
  goodsID: '1', goodsName: '测试商品', catID: '15000', catID1: '1', catID2: '2', catID3: '15000',
  price: null, carousel: ['https://img.pddpic.com/x.jpg'], skuText: '', properties: '', detailImgs: [], _fiberFound: false,
};

const HEALTHY = { ...MASKED, price: '8.22', skuText: '颜色\n白色\n黑色' };

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

  it('throws E_RISK_CONTROL_SOFT (exit 4) when price is masked', async () => {
    const health = makeHealth();
    await assert.rejects(
      () => scrapeSourceGoods(makePage(MASKED), '1', { sessionHealth: health }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.exitCode, 4);
        return true;
      },
    );
    assert.equal(health.calls.recordRisk.length, 1, 'recordRisk should fire once');
    assert.equal(health.calls.recordRisk[0].type, 'desensitized');
    assert.equal(health.calls.recordSuccess, 0, 'recordSuccess must not fire on masked page');
  });

  it('returns data and records success when price is present', async () => {
    const health = makeHealth();
    const data = await scrapeSourceGoods(makePage(HEALTHY), '1', { sessionHealth: health });
    assert.equal(data.price, '8.22');
    assert.equal(health.calls.recordRisk.length, 0);
    assert.equal(health.calls.recordSuccess, 1);
  });

  it('throws on app-redirect placeholder even when price parses', async () => {
    const health = makeHealth();
    // 价格能解析，但页面带"前往APP查看价格"占位 → _maskHint 命中
    const masked = { ...HEALTHY, _maskHint: true };
    await assert.rejects(
      () => scrapeSourceGoods(makePage(masked), '1', { sessionHealth: health }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.detail.reason, 'app_redirect_placeholder');
        return true;
      },
    );
    assert.equal(health.calls.recordRisk[0].type, 'desensitized');
    assert.equal(health.calls.recordSuccess, 0);
  });
});
