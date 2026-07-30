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

  async function selectPage(page, url) {
    const key = normalizeKey(url);
    const prev = history.get(key);
    const currentTime = now();
    let selected = page;

    if (prev && (currentTime - prev.at) < ttlMs) {
      selected = await context.newPage();
      siblings.push(selected);
    }

    return selected;
  }

  function recordNavigation(page, url) {
    history.set(normalizeKey(url), { at: now(), page });
  }

  async function goto(page, url, options) {
    const selected = await selectPage(page, url);
    await selected.goto(url, options);
    recordNavigation(selected, url);
    return selected;
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

  return { selectPage, recordNavigation, goto, getSiblings, closeAll, _history: history };
}

export { normalizeKey, DEFAULT_TTL_MS };
