import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMallContext } from '../src/adapter/mall-switcher.js';

function readPath(root, path) {
  let cur = root;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function isPathsArg(arg) {
  return Array.isArray(arg) && arg.every((item) => Array.isArray(item));
}

function isStringKeysArg(arg) {
  return Array.isArray(arg) && arg.length > 0 && arg.every((item) => typeof item === 'string');
}

function createFakePage({
  globals = {},
  currentUrl = 'https://mms.pinduoduo.com/home/',
  cookies = [],
  storage = {},
  domMalls = [],
  openSwitcher = true,
} = {}) {
  return {
    async evaluate(_fn, arg) {
      if (isPathsArg(arg)) {
        for (const path of arg) {
          const value = readPath(globals, path);
          if (value != null) return value;
        }
        return null;
      }
      if (isStringKeysArg(arg)) {
        for (const key of arg) {
          const v = storage[key];
          if (typeof v === 'string' && v.trim().length > 0) return v.trim();
        }
        return null;
      }
      return domMalls;
    },
    url() {
      return currentUrl;
    },
    context() {
      return {
        cookies: async () => cookies,
      };
    },
    locator() {
      return {
        first() {
          return {
            async click() {
              if (!openSwitcher) throw new Error('switcher unavailable');
            },
          };
        },
      };
    },
    keyboard: {
      async press() {
        return undefined;
      },
    },
  };
}

test('resolveMallContext: state beats url/cookie/storage/dom', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    globals: {
      __PRELOADED_STATE__: {
        mall: {
          currentMallId: 'state-1',
          mallName: 'State Mall',
          mallList: [
            { mallId: 'state-1', mallName: 'State Mall' },
            { mallId: 'state-2', mallName: 'Other Mall' },
          ],
        },
      },
    },
    currentUrl: 'https://mms.pinduoduo.com/home/?mall_id=url-1',
    cookies: [{ name: 'mall_id', value: 'cookie-1' }],
    storage: { mallId: 'storage-1' },
    domMalls: [{ mallId: 'dom-1', mallName: 'Dom Mall' }],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'state');
  assert.equal(ctx.activeId, 'state-1');
  assert.equal(ctx.activeName, 'State Mall');
  assert.equal(ctx.malls.length, 2);
  assert.equal(ctx.malls[0].active, true);
  assert.equal(ctx.malls[0].is_current, true);
  assert.equal(ctx.malls[1].active, false);
});

test('resolveMallContext: url beats cookie/storage/dom when state is absent', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    currentUrl: 'https://mms.pinduoduo.com/home/?mallId=url-2',
    cookies: [{ name: 'mall_id', value: 'cookie-2' }],
    storage: { mallId: 'storage-2' },
    domMalls: [{ mallId: 'dom-2', mallName: 'Dom Mall' }],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'url');
  assert.equal(ctx.activeId, 'url-2');
});

test('resolveMallContext: cookie beats storage/dom when state and url are absent', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    cookies: [{ name: 'mallId', value: 'cookie-3' }],
    storage: { currentMallId: 'storage-3' },
    domMalls: [{ mallId: 'dom-3', mallName: 'Dom Mall' }],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'cookie');
  assert.equal(ctx.activeId, 'cookie-3');
});

test('resolveMallContext: storage beats dom when earlier probes are empty', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    storage: { selectedMallId: 'storage-4' },
    domMalls: [{ mallId: 'dom-4', mallName: 'Dom Mall' }],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'storage');
  assert.equal(ctx.activeId, 'storage-4');
});

test('resolveMallContext: dom is used when no earlier probe yields an id', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    domMalls: [
      { mallId: 'dom-5', mallName: 'Dom Mall A' },
      { mallId: 'dom-6', mallName: 'Dom Mall B' },
    ],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'dom');
  assert.equal(ctx.activeId, 'dom-5');
  assert.equal(ctx.malls.length, 2);
  assert.equal(ctx.malls[0].active, true);
  assert.equal(ctx.malls[0].is_current, true);
});

test('resolveMallContext: returns empty context when every probe misses', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({ openSwitcher: false });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, null);
  assert.equal(ctx.activeId, null);
  assert.deepEqual(ctx.malls, []);
});
