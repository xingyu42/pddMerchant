const DEFAULT_TTL_MS = 1000;

function normalizeKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    const idx = url.indexOf('?');
    const noQuery = idx >= 0 ? url.slice(0, idx) : url;
    const hashIdx = noQuery.indexOf('#');
    return hashIdx >= 0 ? noQuery.slice(0, hashIdx) : noQuery;
  }
}

export function createPageSession(context, { now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
  const history = new Map();
  const siblings = [];

  async function goto(page, url, options) {
    const key = normalizeKey(url);
    const prev = history.get(key);
    const currentTime = now();

    if (prev && (currentTime - prev.at) < ttlMs) {
      const sibling = await context.newPage();
      siblings.push(sibling);
      await sibling.goto(url, options);
      history.set(key, { at: now(), page: sibling });
      return sibling;
    }

    await page.goto(url, options);
    history.set(key, { at: now(), page });
    return page;
  }

  function getSiblings() {
    return [...siblings];
  }

  async function closeAll() {
    for (const s of siblings) {
      try { await s.close(); } catch { /* ignore */ }
    }
    siblings.length = 0;
  }

  return { goto, getSiblings, closeAll, _history: history };
}

export { normalizeKey, DEFAULT_TTL_MS };
