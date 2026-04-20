import { PddCliError, ExitCodes } from '../infra/errors.js';

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

export function createCollector(page, { pattern, count = 1, timeout = 15000 } = {}) {
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

  const listener = (response) => {
    if (settled) return;
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

  return { waitFor, dispose };
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
