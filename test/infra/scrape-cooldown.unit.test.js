import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createScrapeCooldown,
  getSharedScrapeCooldown,
  _resetSharedScrapeCooldown,
} from '../../src/infra/scrape-cooldown.js';

const COOLDOWN_MS = 7_200_000; // 2h

describe('createScrapeCooldown (内存模式)', () => {
  let clock;
  let cd;
  beforeEach(() => {
    clock = 1_000_000;
    cd = createScrapeCooldown({ now: () => clock, statePath: null, threshold: 2, cooldownMs: COOLDOWN_MS });
  });

  it('未达阈值前不冷却、check 不抛', () => {
    const r = cd.recordSoftBlock({ reason: 'price_masked' });
    assert.equal(r.cooldownTriggered, false);
    assert.equal(r.consecutiveSoftBlock, 1);
    cd.check(); // 不抛
  });

  it('达阈值进入冷却，check() 抛 E_RATE_LIMIT(ip_soft_block)', () => {
    cd.recordSoftBlock({});
    const r = cd.recordSoftBlock({});
    assert.equal(r.cooldownTriggered, true);
    assert.equal(r.cooldownUntil, clock + COOLDOWN_MS);
    assert.throws(() => cd.check(), (err) => {
      assert.equal(err.code, 'E_RATE_LIMIT');
      assert.equal(err.exitCode, 4);
      assert.equal(err.detail.reason, 'ip_soft_block');
      assert.equal(err.detail.cooldown_triggered, true);
      assert.ok(err.detail.cooldown_remaining_ms > 0);
      return true;
    });
  });

  it('冷却到期后 check() 放行', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({});
    assert.throws(() => cd.check());
    clock += COOLDOWN_MS; // 推进到冷却边界（remaining=0，不再 >0）
    cd.check(); // 不抛
  });

  it('冷却过期后仍软封 → 立即重新冷却（仍封时快速退避）', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({}); // count=2 → 冷却
    clock += COOLDOWN_MS;   // 过期
    cd.check();             // 放行
    const r = cd.recordSoftBlock({}); // count=3 ≥ threshold → 立即再冷却
    assert.equal(r.cooldownTriggered, true);
    assert.throws(() => cd.check());
  });

  it('recordSuccess 清零计数与冷却', () => {
    cd.recordSoftBlock({});
    cd.recordSoftBlock({});
    cd.recordSuccess();
    assert.equal(cd.status().consecutiveSoftBlock, 0);
    assert.equal(cd.status().cooldownUntil, 0);
    cd.check(); // 不抛
  });
});

describe('createScrapeCooldown (落盘持久化)', () => {
  let dir;
  let statePath;
  let clock;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdd-cooldown-'));
    statePath = join(dir, 'scrape-cooldown.json');
    clock = 5_000_000;
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('冷却状态跨实例持久化（模拟跨进程）', () => {
    const a = createScrapeCooldown({ now: () => clock, statePath, threshold: 1, cooldownMs: COOLDOWN_MS });
    const r = a.recordSoftBlock({}); // threshold=1 → 立即冷却 + 落盘
    assert.equal(r.cooldownTriggered, true);
    assert.ok(existsSync(statePath), 'state file should be persisted');

    // 新实例（新进程）从磁盘读到冷却态
    const b = createScrapeCooldown({ now: () => clock, statePath, threshold: 1, cooldownMs: COOLDOWN_MS });
    assert.throws(() => b.check(), (e) => e.code === 'E_RATE_LIMIT');
  });

  it('recordSuccess 落盘后新实例不再冷却', () => {
    const a = createScrapeCooldown({ now: () => clock, statePath, threshold: 1, cooldownMs: COOLDOWN_MS });
    a.recordSoftBlock({});
    a.recordSuccess();
    const b = createScrapeCooldown({ now: () => clock, statePath, threshold: 1, cooldownMs: COOLDOWN_MS });
    b.check(); // 不抛
    assert.equal(b.status().consecutiveSoftBlock, 0);
  });

  it('文件缺失 → 归零容错', () => {
    const a = createScrapeCooldown({ now: () => clock, statePath, threshold: 2, cooldownMs: COOLDOWN_MS });
    a.check(); // 不抛
    assert.equal(a.status().consecutiveSoftBlock, 0);
  });

  it('文件损坏 → 归零容错', () => {
    writeFileSync(statePath, '{ not valid json', 'utf8');
    const a = createScrapeCooldown({ now: () => clock, statePath, threshold: 2, cooldownMs: COOLDOWN_MS });
    a.check(); // 不抛
    assert.equal(a.status().consecutiveSoftBlock, 0);
  });
});

describe('getSharedScrapeCooldown 单例', () => {
  beforeEach(() => _resetSharedScrapeCooldown());
  afterEach(() => _resetSharedScrapeCooldown());

  it('返回同一实例', () => {
    const a = getSharedScrapeCooldown({ statePath: null, threshold: 2, cooldownMs: COOLDOWN_MS });
    const b = getSharedScrapeCooldown({ statePath: null });
    assert.equal(a, b);
  });

  it('_reset 后创建新实例', () => {
    const a = getSharedScrapeCooldown({ statePath: null, threshold: 2, cooldownMs: COOLDOWN_MS });
    _resetSharedScrapeCooldown();
    const b = getSharedScrapeCooldown({ statePath: null, threshold: 2, cooldownMs: COOLDOWN_MS });
    assert.notEqual(a, b);
  });
});
