// PROP-CTX-1（refactor-arch-review-remediation task 1.1）
// 特征化测试：冻结 executeSingle 注入命令 run(ctx) 的字段集（design §D-2）。
// fixture ctx 不含 context/pageSession 且 page=null；live ctx 额外含 context/pageSession，
// client 必须来自 getSharedClient()。R2a 拆分期间该字段集 diff 必须恒为 ∅。
import { vi, describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { gen, property } from './_harness.js';

const fakes = vi.hoisted(() => ({
  fakePage: { __fake: 'page' },
  fakeContext: { __fake: 'context', newPage: async () => ({ close: async () => {} }) },
}));

vi.mock('../../src/adapter/browser.js', async (importOriginal) => ({
  ...(await importOriginal()),
  withBrowser: async (_options, fn) =>
    fn({ browser: { __fake: 'browser' }, context: fakes.fakeContext, page: fakes.fakePage }),
}));
vi.mock('../../src/adapter/auth-state.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isAuthValid: async () => true,
  migrateLegacyAuthStateIfNeeded: async () => {},
}));
vi.mock('../../src/adapter/mall-reader.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveMallContext: async () => ({ activeId: '445301049', activeName: 'probe-mall', malls: [], source: 'probe' }),
}));
vi.mock('../../src/adapter/mall-writer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  switchTo: async () => {},
}));
vi.mock('../../src/infra/account-resolver.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAccountContext: async () => null,
  accountMetaForEnvelope: () => ({}),
}));
vi.mock('../../src/infra/daemon-launcher.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureDaemonRunning: async () => {},
}));

const { executeSingle } = await import('../../src/commands/_runner.js');
const { FixtureEndpointClient } = await import('../../src/adapter/mock-dispatcher.js');
const { getSharedClient } = await import('../../src/adapter/rate-limiter-singleton.js');

// design §D-2 冻结清单 — 任何增删都必须先改 design 再改这里
const FIXTURE_CTX_KEYS = [
  'client', 'page', 'mallCtx', 'mallId', 'authPath', 'account', 'accountSlug',
  'config', 'log', 'correlation_id', 'warnings', 'signal', 'deadlineAt',
].sort();
const LIVE_CTX_KEYS = [...FIXTURE_CTX_KEYS, 'context', 'pageSession'].sort();

const optsGen = gen.record({
  json: gen.bool(),
  noColor: gen.bool(),
  hasTimeout: gen.bool(),
  needsAuth: gen.bool(),
});

function probeSpec(name, needsAuth, capture) {
  return {
    name,
    needsAuth,
    needsMall: 'current',
    run: async (ctx) => { capture(ctx); return null; },
  };
}

describe('ctx contract PBT (PROP-CTX-1)', () => {
  let savedAdapter;
  let savedAuthInvalid;

  beforeEach(() => {
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    savedAuthInvalid = process.env.PDD_TEST_AUTH_INVALID;
    delete process.env.PDD_TEST_AUTH_INVALID;
  });

  afterEach(() => {
    if (savedAdapter !== undefined) process.env.PDD_TEST_ADAPTER = savedAdapter;
    else delete process.env.PDD_TEST_ADAPTER;
    if (savedAuthInvalid !== undefined) process.env.PDD_TEST_AUTH_INVALID = savedAuthInvalid;
    else delete process.env.PDD_TEST_AUTH_INVALID;
  });

  it('PROP-CTX-1a: fixture ctx field set is frozen — no context/pageSession, page=null', async () => {
    process.env.PDD_TEST_ADAPTER = 'fixture';
    await property('fixture-ctx-frozen', optsGen, async ({ json, noColor, hasTimeout, needsAuth }) => {
      let captured;
      const spec = probeSpec('ctx.probe.fixture', needsAuth, (ctx) => { captured = ctx; });
      const envelope = await executeSingle(
        spec,
        { json, noColor, ...(hasTimeout ? { timeoutMs: 30000 } : {}) },
        { emitResult: false, skipDaemonStart: true },
      );
      assert.equal(envelope.ok, true, `probe must succeed, got error: ${envelope.error?.code}`);
      assert.ok(captured, 'run(ctx) must be invoked');
      assert.deepEqual(Object.keys(captured).sort(), FIXTURE_CTX_KEYS);
      assert.equal(captured.page, null, 'fixture ctx.page must be null');
      assert.ok(captured.client instanceof FixtureEndpointClient, 'fixture client must be FixtureEndpointClient');
      assert.ok(!('context' in captured), 'fixture ctx must not expose context');
      assert.ok(!('pageSession' in captured), 'fixture ctx must not expose pageSession');
      return true;
    });
  });

  it('PROP-CTX-1b: live ctx field set is frozen — context/pageSession present, client from getSharedClient', async () => {
    delete process.env.PDD_TEST_ADAPTER;
    await property('live-ctx-frozen', optsGen, async ({ json, noColor, hasTimeout, needsAuth }) => {
      let captured;
      const spec = probeSpec('ctx.probe.live', needsAuth, (ctx) => { captured = ctx; });
      const envelope = await executeSingle(
        spec,
        { json, noColor, ...(hasTimeout ? { timeoutMs: 30000 } : {}) },
        { emitResult: false, skipDaemonStart: true },
      );
      assert.equal(envelope.ok, true, `probe must succeed, got error: ${envelope.error?.code}`);
      assert.ok(captured, 'run(ctx) must be invoked');
      assert.deepEqual(Object.keys(captured).sort(), LIVE_CTX_KEYS);
      assert.equal(captured.page, fakes.fakePage, 'live ctx.page must be the browser page');
      assert.equal(captured.context, fakes.fakeContext, 'live ctx.context must be the browser context');
      assert.equal(captured.client, getSharedClient(), 'live client must come from getSharedClient()');
      assert.equal(typeof captured.pageSession?.closeAll, 'function', 'live ctx.pageSession must be a page session');
      return true;
    });
  });
});
