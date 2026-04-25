import { PddCliError, ExitCodes } from '../infra/errors.js';
import { timeoutError } from '../infra/abort.js';

let globalSeq = 0;
const pageRequestSeqs = new WeakMap();
const activeCollectors = new WeakMap();

function ensureRequestTracking(page) {
  if (pageRequestSeqs.has(page)) return;
  const seqMap = new WeakMap();
  pageRequestSeqs.set(page, seqMap);
  page.on('request', (req) => {
    seqMap.set(req, ++globalSeq);
  });
}

function getRequestSeq(page, request) {
  const seqMap = pageRequestSeqs.get(page);
  if (!seqMap) return 0;
  return seqMap.get(request) ?? 0;
}

function resolveMatcher(pattern) {
  if (pattern instanceof RegExp) {
    return (url) => pattern.test(url);
  }
  if (typeof pattern === 'function') {
    return pattern;
  }
  if (typeof pattern === 'string' && pattern.length > 0) {
    return (url) => url.includes(pattern);
  }
  throw new PddCliError({
    code: 'E_USAGE',
    message: 'xhr-collector: pattern must be RegExp, non-empty string, or function',
    exitCode: ExitCodes.USAGE,
  });
}

export function createCollector(page, { pattern, count = 1, timeout = 15000, multiplex = false, signal } = {}) {
  if (!page || typeof page.on !== 'function') {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'xhr-collector: page must expose on/off methods',
      exitCode: ExitCodes.USAGE,
    });
  }
  if (pattern === undefined || pattern === null) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'xhr-collector: pattern is required',
      exitCode: ExitCodes.USAGE,
    });
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'xhr-collector: count must be a positive integer',
      exitCode: ExitCodes.USAGE,
    });
  }

  if (multiplex) {
    throw new PddCliError({
      code: 'E_NOT_IMPLEMENTED',
      message: 'xhr-collector: multiplex mode is not yet supported',
      exitCode: ExitCodes.GENERAL,
    });
  }

  if (activeCollectors.has(page)) {
    throw new PddCliError({
      code: 'E_COLLECTOR_COLLISION',
      message: 'xhr-collector: another collector is already active on this page',
      exitCode: ExitCodes.GENERAL,
    });
  }

  ensureRequestTracking(page);
  const snapshotSeq = globalSeq;

  const matcher = resolveMatcher(pattern);
  const collected = [];
  let settled = false;
  let timer = null;
  let resolveFn;
  let rejectFn;

  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  promise.catch(() => {}); // prevent unhandled rejection on timeout/dispose race

  const collectorRef = {};
  activeCollectors.set(page, collectorRef);

  const listener = (response) => {
    if (settled) return;

    const request = typeof response.request === 'function' ? response.request() : null;
    if (request) {
      const reqSeq = getRequestSeq(page, request);
      if (reqSeq <= snapshotSeq) return;
    }

    let url;
    try {
      url = typeof response?.url === 'function' ? response.url() : response?.url;
    } catch {
      return;
    }
    if (typeof url !== 'string') return;

    let matched = false;
    try {
      matched = Boolean(matcher(url, response));
    } catch {
      return;
    }
    if (!matched) return;

    collected.push(response);
    if (collected.length >= count) {
      settled = true;
      cleanup();
      resolveFn(collected.slice());
    }
  };

  function cleanup() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof page.off === 'function') {
      try { page.off('response', listener); } catch { /* ignore */ }
    } else if (typeof page.removeListener === 'function') {
      try { page.removeListener('response', listener); } catch { /* ignore */ }
    }
    if (activeCollectors.get(page) === collectorRef) {
      activeCollectors.delete(page);
    }
  }

  page.on('response', listener);

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(new PddCliError({
      code: 'E_NETWORK',
      message: `xhr-collector: timed out after ${timeout}ms waiting for ${count} match(es); collected ${collected.length}`,
      hint: '检查网络连通性、登录态或 URL 匹配模式',
      detail: {
        pattern: String(pattern),
        count,
        timeout,
        collected: collected.length,
      },
      exitCode: ExitCodes.NETWORK,
    }));
  }, timeout);

  // AbortSignal integration (W1)
  if (signal) {
    if (signal.aborted) {
      if (!settled) { settled = true; cleanup(); rejectFn(timeoutError()); }
    } else {
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectFn(timeoutError());
      }, { once: true });
    }
  }

  function waitFor() {
    return promise;
  }

  function dispose() {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFn(new PddCliError({
      code: 'E_GENERAL',
      message: 'xhr-collector: disposed before completion',
      exitCode: ExitCodes.GENERAL,
    }));
    promise.catch(() => { /* absorb rejection when disposed */ });
  }

  return { waitFor, dispose, _snapshotSeq: snapshotSeq };
}

export async function parseBody(response) {
  if (!response) return null;
  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch { /* fall through */ }
  }
  if (typeof response.text === 'function') {
    try {
      const text = await response.text();
      if (typeof text !== 'string') return text;
      try { return JSON.parse(text); } catch { return text; }
    } catch { /* fall through */ }
  }
  return null;
}

export function _resetCollectorState() {
  globalSeq = 0;
}
