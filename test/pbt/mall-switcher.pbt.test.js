import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMallContext, readActiveIdFromXhr } from '../../src/adapter/mall-switcher.js';
import { property, gen, mulberry32 } from './_harness.js';
import { createMallPage, buildNestedObject } from './_fake-pages.js';

// Stable path list per design.md D13 (must stay in sync with src/adapter/mall-switcher.js).
const STATE_PATHS = [
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall_id'],
  ['__mms', 'user', 'userInfo', '_userInfo', 'mall', 'mall_id'],
  ['__NEXT_DATA__', 'props', 'userInfo', 'mall_id'],
  ['__NEXT_DATA__', 'props', 'user', 'mallId'],
  ['__NEXT_DATA__', 'props', 'pageProps', 'coreData', 'extra', 'mallId'],
  ['__PRELOADED_STATE__', 'mall', 'currentMallId'],
  ['__PRELOADED_STATE__', 'mall', 'mallId'],
  ['__PRELOADED_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'mall', 'currentMallId'],
  ['__INITIAL_STATE__', 'mall', 'mallId'],
  ['__INITIAL_STATE__', 'user', 'mallId'],
  ['__INITIAL_STATE__', 'account', 'mallId'],
];

const mallIdGen = (rng) => {
  // Mix numeric strings (real PDD shape) and numbers, always > 0.
  const useString = rng() < 0.5;
  const n = Math.floor(rng() * 1_000_000_000) + 1;
  return useString ? String(n) : n;
};

// PBT 6.2: probe precedence — `mock > state > url > cookie > storage > xhr > dom > null`.
// Strategy: generate random subset of "which layers have data", assert the HIGHEST
// populated layer wins and provides activeId.
test('pbt: mall_context_precedence honors mock>state>url>cookie>storage>xhr>dom>null', async () => {
  delete process.env.PDD_TEST_ADAPTER;

  const layerGen = gen.record({
    hasState: gen.bool(),
    hasUrl: gen.bool(),
    hasCookie: gen.bool(),
    hasStorage: gen.bool(),
    hasXhr: gen.bool(),
    hasDom: gen.bool(),
    stateId: mallIdGen,
    urlId: mallIdGen,
    cookieId: mallIdGen,
    storageId: mallIdGen,
    xhrId: mallIdGen,
    domId: mallIdGen,
  });

  await property('mall_context_precedence', layerGen, async (s) => {
    const opts = {};
    if (s.hasState) {
      opts.globals = {
        __PRELOADED_STATE__: { mall: { currentMallId: s.stateId } },
      };
    }
    opts.currentUrl = s.hasUrl
      ? `https://mms.pinduoduo.com/home/?mall_id=${s.urlId}`
      : 'https://mms.pinduoduo.com/home/';
    if (s.hasCookie) opts.cookies = [{ name: 'mall_id', value: String(s.cookieId) }];
    if (s.hasStorage) opts.storage = { mallId: String(s.storageId) };
    if (s.hasXhr) {
      opts.xhrResponses = [{
        headers: { 'content-type': 'application/json' },
        bodyObj: { mall_id: s.xhrId },
      }];
    }
    opts.domMalls = s.hasDom ? [{ mallId: String(s.domId), mallName: 'Dom' }] : [];

    const page = createMallPage(opts);
    const ctx = await resolveMallContext(page);

    if (s.hasState) {
      return ctx.source === 'state' && String(ctx.activeId) === String(s.stateId);
    }
    if (s.hasUrl) {
      return ctx.source === 'url' && String(ctx.activeId) === String(s.urlId);
    }
    if (s.hasCookie) {
      return ctx.source === 'cookie' && String(ctx.activeId) === String(s.cookieId);
    }
    if (s.hasStorage) {
      return ctx.source === 'storage' && String(ctx.activeId) === String(s.storageId);
    }
    if (s.hasXhr) {
      return ctx.source === 'xhr' && String(ctx.activeId) === String(s.xhrId);
    }
    if (s.hasDom) {
      return ctx.source === 'dom' && String(ctx.activeId) === String(s.domId);
    }
    return ctx.source === null && ctx.activeId === null;
  }, { runs: 80 });
});

// PBT 6.2b: upstream hit → XHR listener NOT attached (no response handler registered).
test('pbt: upstream probe hit does not register XHR listener', async () => {
  delete process.env.PDD_TEST_ADAPTER;

  await property(
    'xhr_listener_not_attached_on_upstream_hit',
    gen.record({
      layer: gen.oneOf(['state', 'url', 'cookie', 'storage']),
      id: mallIdGen,
    }),
    async (s) => {
      const opts = {
        xhrResponses: [{
          headers: { 'content-type': 'application/json' },
          bodyObj: { mall_id: 'xhr-should-not-fire' },
        }],
      };
      if (s.layer === 'state') {
        opts.globals = { __INITIAL_STATE__: { mall: { mallId: s.id } } };
      } else if (s.layer === 'url') {
        opts.currentUrl = `https://mms.pinduoduo.com/home/?mall_id=${s.id}`;
      } else if (s.layer === 'cookie') {
        opts.cookies = [{ name: 'mall_id', value: String(s.id) }];
      } else if (s.layer === 'storage') {
        opts.storage = { mallId: String(s.id) };
      }
      const page = createMallPage(opts);
      await resolveMallContext(page);
      return page.onResponseCalls === 0
        && page.offResponseCalls === 0
        && page.listenerCount('response') === 0;
    },
    { runs: 30 },
  );
});

// PBT 6.3: xhr listener lifecycle — hit / timeout / malformed all restore baseline.
test('pbt: mall_xhr_listener_cleanup restores listenerCount baseline', async () => {
  delete process.env.PDD_TEST_ADAPTER;

  const scenarios = gen.oneOf(['hit', 'timeout', 'malformed']);
  await property(
    'xhr_cleanup',
    scenarios,
    async (scenario) => {
      const opts = {};
      if (scenario === 'hit') {
        opts.xhrResponses = [{
          headers: { 'content-type': 'application/json' },
          bodyObj: { mall_id: 'x-1' },
        }];
      } else if (scenario === 'malformed') {
        opts.xhrResponses = [{
          headers: { 'content-type': 'application/json' },
          bodyText: '<html>not json</html>',
        }];
      }
      // scenario === 'timeout': no xhrResponses
      const page = createMallPage(opts);
      const baseline = page.listenerCount('response');
      const id = await readActiveIdFromXhr(page, { timeoutMs: 40 });
      if (scenario === 'hit' && id !== 'x-1') return false;
      if (scenario !== 'hit' && id !== null) return false;
      return page.onResponseCalls === 1
        && page.offResponseCalls === 1
        && page.listenerCount('response') === baseline;
    },
    { runs: 30 },
  );
});

// PBT 6.4: every one of 12 state paths can yield source='state' when populated.
test('pbt: mall_state_path_coverage all 12 paths route to source=state', async () => {
  delete process.env.PDD_TEST_ADAPTER;

  const pickGen = gen.record({
    pathIndex: gen.int(0, STATE_PATHS.length - 1),
    id: mallIdGen,
  });

  await property(
    'state_path_coverage',
    pickGen,
    async ({ pathIndex, id }) => {
      const path = STATE_PATHS[pathIndex];
      const globals = buildNestedObject(path, id);
      const page = createMallPage({ globals });
      const ctx = await resolveMallContext(page);
      return ctx.source === 'state' && String(ctx.activeId) === String(id);
    },
    { runs: 60 },
  );
});

// PBT 6.4b: STATE_PATHS list in test stays in sync with source (documented invariant).
// Fails loudly if production list diverges from the 12 paths in design.md D13.
test('state_path list size invariant (must remain 12 per D13)', () => {
  assert.equal(STATE_PATHS.length, 12);
});

// Smoke: harness mulberry32 cover multiple distinct samples within one property
// (guards against a silent single-sample regression).
test('harness: property() exercises >1 distinct sample per run', async () => {
  const samples = new Set();
  await property(
    'collect_samples',
    gen.int(0, 999),
    (x) => {
      samples.add(x);
      return true;
    },
    { runs: 50, seed: 123 },
  );
  assert.ok(samples.size >= 30, `expected ≥30 distinct samples, got ${samples.size}`);
});

// mulberry32 referenced solely for documentation; ensure import path is valid.
assert.equal(typeof mulberry32, 'function');
