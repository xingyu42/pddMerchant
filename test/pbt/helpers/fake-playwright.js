export function createFakePage({ url = 'https://mms.pinduoduo.com/' } = {}) {
  const listeners = new Map();
  let currentUrl = url;
  let requestSeq = 0;

  return {
    url: () => currentUrl,
    async goto(u, _opts) { currentUrl = u; },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const arr = listeners.get(event);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    emit(event, ...args) {
      const arr = listeners.get(event) ?? [];
      for (const fn of arr) fn(...args);
    },
    _nextRequest() {
      const seq = ++requestSeq;
      const req = { __seq: seq };
      const arr = listeners.get('request') ?? [];
      for (const fn of arr) fn(req);
      return req;
    },
    async waitForSelector() {},
    async waitForLoadState() {},
    async evaluate(fn, ...args) { return null; },
    locator() {
      return {
        first() { return { click: async () => {} }; },
      };
    },
    context() { return createFakeContext(); },
    keyboard: { press: async () => {} },
    async close() {},
  };
}

export function createFakeContext() {
  const pages = [];
  return {
    async newPage() {
      const p = createFakePage();
      pages.push(p);
      return p;
    },
    async cookies() { return []; },
    async close() {},
    _pages: pages,
  };
}

export function createFakeResponse({ url, status = 200, body = {}, request } = {}) {
  return {
    url: () => url ?? 'https://mms.pinduoduo.com/api/test',
    status: () => status,
    request: () => request ?? {},
    async json() { return body; },
    async text() { return JSON.stringify(body); },
    headers() { return { 'content-type': 'application/json' }; },
  };
}
