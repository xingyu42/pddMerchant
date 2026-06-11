// R2c 拆分结构守卫（task 5.1/5.3）：facade 再导出与 core 是同一 live binding，
// providers 直连调用与 core.loadFixture 命中同一 cache 实例（反双缓存）。
// 行为级等价由 PROP-MOCK-1 基线（test/pbt/mock-dispatcher-baseline.pbt.test.js）覆盖。
import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import * as facade from '../src/adapter/mock-dispatcher.js';
import * as core from '../src/adapter/fixtures/core.js';
import { mockListMalls, mockSwitchTo } from '../src/adapter/fixtures/mall.js';
import { mockAccountRegistry } from '../src/adapter/fixtures/account.js';

const savedFixtureDir = process.env.PDD_TEST_FIXTURE_DIR;

describe('fixtures facade structure (R2c split)', () => {
  beforeEach(() => {
    delete process.env.PDD_TEST_FIXTURE_DIR;
    core.clearFixtureCache();
  });

  afterEach(() => {
    if (savedFixtureDir !== undefined) process.env.PDD_TEST_FIXTURE_DIR = savedFixtureDir;
    else delete process.env.PDD_TEST_FIXTURE_DIR;
    core.clearFixtureCache();
  });

  it('facade re-exports are the same bindings as core (single cache owner)', () => {
    assert.strictEqual(facade.isMockEnabled, core.isMockEnabled);
    assert.strictEqual(facade.loadFixture, core.loadFixture);
    assert.strictEqual(facade.clearFixtureCache, core.clearFixtureCache);
  });

  it('providers called directly share the one core cache instance', () => {
    const viaMall = mockListMalls();
    assert.strictEqual(viaMall, core.loadFixture('shops.list.json'));
    assert.strictEqual(viaMall, facade.loadFixture('shops.list.json'));

    const viaAccount = mockAccountRegistry();
    assert.strictEqual(viaAccount, core.loadFixture('accounts.json'));

    // 全清语义：core.clearFixtureCache 后两个 provider 都观察到重新解析的新实例
    core.clearFixtureCache();
    const refreshed = core.loadFixture('shops.list.json');
    assert.notStrictEqual(refreshed, viaMall);
    assert.strictEqual(mockListMalls(), refreshed);
    assert.notStrictEqual(mockAccountRegistry(), viaAccount);
  });

  it('cross-provider read-through: mockSwitchTo observes mutations on the shared cached list', () => {
    const list = mockListMalls();
    const target = list[0];
    target.__probe = 'r2c';
    try {
      assert.equal(mockSwitchTo(String(target.id)).__probe, 'r2c');
    } finally {
      delete target.__probe;
    }
  });
});
