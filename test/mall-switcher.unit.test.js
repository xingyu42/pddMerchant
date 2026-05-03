import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readActiveIdFromXhr, resolveMallContext } from '../src/adapter/mall-switcher.js';

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

function createFakeResponse({ headers = {}, bodyObj, bodyText } = {}) {
  const hasBodyObj = bodyObj !== undefined;
  return {
    headers() { return headers; },
    async json() {
      if (hasBodyObj) return bodyObj;
      if (typeof bodyText === 'string') return JSON.parse(bodyText);
      throw new Error('missing body');
    },
    async text() {
      if (typeof bodyText === 'string') return bodyText;
      if (hasBodyObj) return JSON.stringify(bodyObj);
      return '';
    },
  };
}

function createFakePage({
  globals = {},
  currentUrl = 'https://mms.pinduoduo.com/home/',
  cookies = [],
  storage = {},
  domMalls = [],
  openSwitcher = true,
  xhrResponses = [],
} = {}) {
  const responseListeners = [];
  let pendingXhrResponses = xhrResponses.slice();
  let onResponseCalls = 0;
  let offResponseCalls = 0;
  let xhrScheduled = false;

  async function fireXhr() {
    const batch = pendingXhrResponses;
    pendingXhrResponses = [];
    for (const entry of batch) {
      const response = createFakeResponse(entry);
      for (const listener of responseListeners.slice()) {
        await listener(response);
      }
    }
  }

  function scheduleXhr() {
    if (xhrScheduled || pendingXhrResponses.length === 0) return;
    xhrScheduled = true;
    setTimeout(() => { void fireXhr(); }, 0);
  }

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
    url() { return currentUrl; },
    context() { return { cookies: async () => cookies }; },
    on(evt, fn) {
      if (evt !== 'response') return;
      onResponseCalls += 1;
      responseListeners.push(fn);
      scheduleXhr();
    },
    off(evt, fn) {
      if (evt !== 'response') return;
      offResponseCalls += 1;
      const i = responseListeners.indexOf(fn);
      if (i >= 0) responseListeners.splice(i, 1);
    },
    listenerCount(evt) {
      return evt === 'response' ? responseListeners.length : 0;
    },
    get onResponseCalls() { return onResponseCalls; },
    get offResponseCalls() { return offResponseCalls; },
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
      async press() { return undefined; },
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

test('resolveMallContext: state hits __mms Next.js path', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    globals: {
      __mms: {
        user: {
          userInfo: {
            _userInfo: {
              mall_id: 'mms-1',
              mall: { mall_name: 'MMS Mall' },
            },
          },
        },
      },
    },
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'state');
  assert.equal(ctx.activeId, 'mms-1');
  assert.equal(ctx.activeName, 'MMS Mall');
});

test('resolveMallContext: state hits __NEXT_DATA__ pageProps path', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    globals: {
      __NEXT_DATA__: {
        props: {
          userInfo: { mall_name: 'Next Mall' },
          pageProps: {
            coreData: { extra: { mallId: 'next-1' } },
          },
        },
      },
    },
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'state');
  assert.equal(ctx.activeId, 'next-1');
  assert.equal(ctx.activeName, 'Next Mall');
});

test('resolveMallContext: XHR hits when earlier probes miss', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    xhrResponses: [
      {
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyObj: { data: { rows: [{ mall_id: 'xhr-1' }] } },
      },
    ],
  });

  assert.equal(page.listenerCount('response'), 0);
  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'xhr');
  assert.equal(ctx.activeId, 'xhr-1');
  assert.equal(page.onResponseCalls, 1);
  assert.equal(page.offResponseCalls, 1);
  assert.equal(page.listenerCount('response'), 0);
});

test('resolveMallContext: XHR timeout falls through to dom', { timeout: 10000 }, async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    domMalls: [{ mallId: 'dom-7', mallName: 'Dom Mall Timeout' }],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'dom');
  assert.equal(ctx.activeId, 'dom-7');
  assert.equal(page.onResponseCalls, 1);
  assert.equal(page.offResponseCalls, 1);
  assert.equal(page.listenerCount('response'), 0);
});

test('resolveMallContext: upstream hit does not attach XHR listener', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    globals: {
      __INITIAL_STATE__: { mall: { mallId: 'state-no-xhr' } },
    },
    xhrResponses: [
      {
        headers: { 'content-type': 'application/json' },
        bodyObj: { mall_id: 'xhr-ignored' },
      },
    ],
  });

  const ctx = await resolveMallContext(page);
  assert.equal(ctx.source, 'state');
  assert.equal(ctx.activeId, 'state-no-xhr');
  assert.equal(page.onResponseCalls, 0);
  assert.equal(page.offResponseCalls, 0);
  assert.equal(page.listenerCount('response'), 0);
});

test('readActiveIdFromXhr cleans up listener after malformed responses', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  const page = createFakePage({
    xhrResponses: [
      {
        headers: { 'content-type': 'application/json' },
        bodyText: '<html>not json</html>',
      },
      {
        headers: { 'content-type': 'text/html' },
        bodyText: '<html>still not json</html>',
      },
    ],
  });

  assert.equal(page.listenerCount('response'), 0);
  const activeId = await readActiveIdFromXhr(page, { timeoutMs: 50 });
  assert.equal(activeId, null);
  assert.equal(page.onResponseCalls, 1);
  assert.equal(page.offResponseCalls, 1);
  assert.equal(page.listenerCount('response'), 0);
});

test('resolveMallContext: activeProbeReload triggers page.reload before XHR probe', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let reloadCalls = 0;
  const page = createFakePage({
    xhrResponses: [
      { headers: { 'content-type': 'application/json' }, bodyObj: { mall_id: 'reloaded-1' } },
    ],
  });
  page.reload = async () => { reloadCalls += 1; };

  const ctx = await resolveMallContext(page, { activeProbeReload: true });
  assert.equal(reloadCalls, 1, 'page.reload called exactly once');
  assert.equal(ctx.source, 'xhr');
  assert.equal(ctx.activeId, 'reloaded-1');
});

test('resolveMallContext: without activeProbeReload page.reload is not invoked', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let reloadCalls = 0;
  const page = createFakePage({
    xhrResponses: [
      { headers: { 'content-type': 'application/json' }, bodyObj: { mall_id: 'xhr-only' } },
    ],
  });
  page.reload = async () => { reloadCalls += 1; };

  const ctx = await resolveMallContext(page);
  assert.equal(reloadCalls, 0, 'page.reload must NOT be called without flag');
  assert.equal(ctx.source, 'xhr');
  assert.equal(ctx.activeId, 'xhr-only');
});

test('resolveMallContext: activeProbeReload is skipped when state probe already hits', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let reloadCalls = 0;
  const page = createFakePage({
    globals: { __PRELOADED_STATE__: { mall: { currentMallId: 'state-early' } } },
  });
  page.reload = async () => { reloadCalls += 1; };

  const ctx = await resolveMallContext(page, { activeProbeReload: true });
  assert.equal(reloadCalls, 0, 'reload must NOT run when upstream probe succeeds');
  assert.equal(ctx.source, 'state');
  assert.equal(ctx.activeId, 'state-early');
});

test('resolveMallContext: activeProbeReload tolerates reload rejection and still runs XHR probe', async () => {
  delete process.env.PDD_TEST_ADAPTER;
  let reloadCalls = 0;
  const page = createFakePage({
    xhrResponses: [
      { headers: { 'content-type': 'application/json' }, bodyObj: { mall_id: 'after-reload-fail' } },
    ],
  });
  page.reload = async () => {
    reloadCalls += 1;
    throw new Error('simulated reload timeout');
  };

  const ctx = await resolveMallContext(page, { activeProbeReload: true });
  assert.equal(reloadCalls, 1);
  assert.equal(ctx.source, 'xhr');
  assert.equal(ctx.activeId, 'after-reload-fail');
});

