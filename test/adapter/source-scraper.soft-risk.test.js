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

  it('price 脱敏(¥0/缺失) → E_RISK_CONTROL_SOFT(exit 4) 且计入跨进程冷却', async () => {
    const health = makeHealth();
    const cooldown = makeCooldown({ threshold: 1 });
    await assert.rejects(
      () => scrapeSourceGoods(makePage(MASKED), '1', { sessionHealth: health, scrapeCooldown: cooldown }),
      (err) => {
        assert.equal(err.code, 'E_RISK_CONTROL_SOFT');
        assert.equal(err.exitCode, 4);
        assert.equal(err.detail.reason, 'price_masked');
        assert.equal(err.detail.cooldown_triggered, true);
        return true;
      },
    );
    assert.equal(health.calls.recordRisk.length, 1, 'recordRisk should fire once');
    assert.equal(health.calls.recordRisk[0].type, 'desensitized');
    assert.equal(health.calls.recordSuccess, 0, 'recordSuccess must not fire on masked page');
    // price 脱敏是软封签名 → 计入冷却（已知取舍：价格缺失的下架/限购商品也会计入）
    assert.equal(cooldown.calls.recordSoftBlock.length, 1, 'price-masked must engage IP soft-block cooldown');
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
