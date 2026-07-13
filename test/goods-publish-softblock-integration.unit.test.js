import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes } from '../src/infra/errors.js';
import { createScrapeCooldown } from '../src/infra/scrape-cooldown.js';

// 集成测试：验证 IP 软封禁冷却机制在 goods-publish 流程中的行为。
// 场景覆盖：
//   1. 连续软封达阈值 → 触发冷却
//   2. 冷却期内 check() 短路退避，抛 E_RATE_LIMIT(ip_soft_block)
//   3. 冷却到期后 check() 放行
//   4. recordSuccess() 清零计数

describe('goods-publish IP 软封禁集成测试', () => {
  const DEFAULT_THRESHOLD = 2;
  const DEFAULT_COOLDOWN_MS = 7_200_000; // 2h

  let clock;
  let cd;

  beforeEach(() => {
    clock = 1_000_000;
    cd = createScrapeCooldown({
      now: () => clock,
      statePath: null, // 内存模式
      threshold: DEFAULT_THRESHOLD,
      cooldownMs: DEFAULT_COOLDOWN_MS,
    });
  });

  it('连续软封未达阈值前，check() 不抛异常', () => {
    const r1 = cd.recordSoftBlock({ reason: 'price_masked', goods_id: '12345' });
    assert.equal(r1.cooldownTriggered, false);
    assert.equal(r1.consecutiveSoftBlock, 1);
    assert.doesNotThrow(() => cd.check());
  });

  it('连续软封达阈值后，check() 抛 E_RATE_LIMIT(ip_soft_block)', () => {
    cd.recordSoftBlock({ reason: 'price_masked' });
    const r2 = cd.recordSoftBlock({ reason: 'carousel_empty' });

    assert.equal(r2.cooldownTriggered, true);
    assert.equal(r2.cooldownUntil, clock + DEFAULT_COOLDOWN_MS);

    assert.throws(
      () => cd.check(),
      (err) => {
        assert.equal(err.code, 'E_RATE_LIMIT');
        assert.equal(err.exitCode, ExitCodes.RATE_LIMIT);
        assert.equal(err.detail.reason, 'ip_soft_block');
        assert.equal(err.detail.cooldown_triggered, true);
        assert.ok(err.detail.cooldown_remaining_ms > 0);
        assert.ok(err.message.includes('IP 软风控冷却中'));
        return true;
      }
    );
  });

  it('冷却到期后 check() 放行', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({});

    // 推进时钟到冷却边界
    clock += DEFAULT_COOLDOWN_MS;
    assert.doesNotThrow(() => cd.check());
  });

  it('冷却过期后仍软封 → 立即重新冷却（快速退避）', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({});
    assert.throws(() => cd.check());

    // 冷却到期
    clock += DEFAULT_COOLDOWN_MS;
    cd.check(); // 放行

    // 第3次软封 → count=3 ≥ threshold=2 → 立即再冷却
    const r3 = cd.recordSoftBlock({});
    assert.equal(r3.cooldownTriggered, true);
    assert.throws(() => cd.check());
  });

  it('recordSuccess() 清零计数与冷却状态', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({});
    assert.throws(() => cd.check());

    cd.recordSuccess();
    const status = cd.status();
    assert.equal(status.consecutiveSoftBlock, 0);
    assert.equal(status.cooldownUntil, 0);
    assert.doesNotThrow(() => cd.check());
  });

  it('goods-publish 场景：price_masked 软封触发冷却', () => {
    // 模拟第1次 goods publish，检测到价格脱敏
    const r1 = cd.recordSoftBlock({
      reason: 'price_masked',
      goods_id: '918867803697',
      phase: 'source-extract',
    });
    assert.equal(r1.cooldownTriggered, false);

    // 模拟第2次 goods publish，再次检测到软封 → 冷却
    const r2 = cd.recordSoftBlock({
      reason: 'price_masked',
      goods_id: '785831857546',
      phase: 'source-extract',
    });
    assert.equal(r2.cooldownTriggered, true);

    // 第3次 goods publish 调用前，check() 短路退避
    assert.throws(
      () => cd.check(),
      (err) => err.code === 'E_RATE_LIMIT' && err.detail.reason === 'ip_soft_block'
    );
  });

  it('goods-publish 场景：carousel_empty 软封触发冷却', () => {
    cd.recordSoftBlock({ reason: 'carousel_empty', goods_id: '12345' });
    cd.recordSoftBlock({ reason: 'carousel_empty', goods_id: '67890' });

    assert.throws(() => cd.check(), (err) => err.code === 'E_RATE_LIMIT');
  });

  it('goods-publish 场景：混合软封原因触发冷却', () => {
    cd.recordSoftBlock({ reason: 'price_masked' });
    cd.recordSoftBlock({ reason: 'carousel_empty' });

    assert.throws(() => cd.check());
  });

  it('status() 返回正确的冷却状态', () => {
    const s1 = cd.status();
    assert.equal(s1.consecutiveSoftBlock, 0);
    assert.equal(s1.cooldownUntil, 0);

    cd.recordSoftBlock({});
    const s2 = cd.status();
    assert.equal(s2.consecutiveSoftBlock, 1);
    assert.equal(s2.cooldownUntil, 0);

    cd.recordSoftBlock({});
    const s3 = cd.status();
    assert.equal(s3.consecutiveSoftBlock, 2);
    assert.equal(s3.cooldownUntil, clock + DEFAULT_COOLDOWN_MS);
  });

  it('环境变量 PDD_SCRAPE_SOFTBLOCK_THRESHOLD 自定义阈值', () => {
    const customCd = createScrapeCooldown({
      now: () => clock,
      statePath: null,
      threshold: 3, // 自定义阈值
      cooldownMs: DEFAULT_COOLDOWN_MS,
    });

    customCd.recordSoftBlock({});
    customCd.recordSoftBlock({});
    assert.doesNotThrow(() => customCd.check()); // 未达阈值 3

    customCd.recordSoftBlock({});
    assert.throws(() => customCd.check()); // 达到阈值 3
  });

  it('环境变量 PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS 自定义冷却时长', () => {
    const customCooldownMs = 3_600_000; // 1h
    const customCd = createScrapeCooldown({
      now: () => clock,
      statePath: null,
      threshold: 1,
      cooldownMs: customCooldownMs,
    });

    const r = customCd.recordSoftBlock({});
    assert.equal(r.cooldownUntil, clock + customCooldownMs);

    clock += customCooldownMs - 1;
    assert.throws(() => customCd.check()); // 未到期

    clock += 1;
    assert.doesNotThrow(() => customCd.check()); // 到期
  });
});
