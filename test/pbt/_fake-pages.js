// Shared fake Page / Response helpers for PBT tests.
// Based on test/mall-switcher.unit.test.js and test/run-endpoint.unit.test.js patterns,
// reshaped for property-based sampling (programmable per-run behavior).

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

// Fake page tailored for resolveMallContext / readActiveIdFromXhr.
export function createMallPage({
  globals = {},
  currentUrl = 'https://mms.pinduoduo.com/home/',
  cookies = [],
  storage = {},
  domMalls = [],
  openSwitcher = true,
  xhrResponses = [],
} = {}) {
  const responseListeners = [];
  let pendingXhr = xhrResponses.slice();
  let onResponseCalls = 0;
  let offResponseCalls = 0;
  let xhrScheduled = false;

  async function fireXhr() {
    const batch = pendingXhr;
    pendingXhr = [];
    for (const entry of batch) {
      const response = createFakeResponse(entry);
      for (const listener of responseListeners.slice()) {
        await listener(response);
      }
    }
  }

  function scheduleXhr() {
    if (xhrScheduled || pendingXhr.length === 0) return;
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

// Fake page tailored for runEndpoint (response injected via xhr-collector listeners).
export function createEndpointPage({ respondBy } = {}) {
  const listeners = [];
  let attempt = 0;
  return {
    on(evt, fn) { if (evt === 'response') listeners.push(fn); },
    off(evt, fn) {
      if (evt !== 'response') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    async goto(url) {
      const curr = attempt;
      attempt += 1;
      queueMicrotask(() => {
        const resp = respondBy(url, curr);
        const response = {
          url: () => url,
          status: () => resp.status ?? 200,
          text: async () => (typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body)),
          json: async () => resp.body,
        };
        for (const l of listeners.slice()) l(response);
      });
    },
    async waitForSelector() { /* noop */ },
    url: () => 'http://fake/current',
    get attemptCount() { return attempt; },
  };
}

// Build a nested object with `value` at `path`, e.g. (['a','b','c'], 42) → { a: { b: { c: 42 } } }
export function buildNestedObject(path, value) {
  const root = {};
  let cur = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
  return root;
}

// Run `fn` with setTimeout patched to fire callback on the next microtask,
// so tests that rely on setTimeout(_, ms) complete instantly regardless of `ms`.
export async function withInstantTimers(fn) {
  const origSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, _ms, ...args) => origSetTimeout(cb, 0, ...args);
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
}
