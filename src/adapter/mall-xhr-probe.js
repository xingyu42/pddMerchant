const ACTIVE_ID_RESPONSE_KEYS = ['mall_id', 'mallId', 'currentMallId'];
const PAYLOAD_SEARCH_MAX_DEPTH = 10;

function hasMallId(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

export function findActiveIdInPayload(value, seen = new Set(), depth = 0) {
  if (value == null || depth > PAYLOAD_SEARCH_MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findActiveIdInPayload(item, seen, depth + 1);
      if (hasMallId(hit)) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  for (const key of ACTIVE_ID_RESPONSE_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const candidate = value[key];
    if ((typeof candidate === 'string' || typeof candidate === 'number') && hasMallId(candidate)) {
      return candidate;
    }
  }
  for (const nested of Object.values(value)) {
    const hit = findActiveIdInPayload(nested, seen, depth + 1);
    if (hasMallId(hit)) return hit;
  }
  return null;
}

export async function readActiveIdFromXhr(page, { timeoutMs = 3000, allowedEndpoints } = {}) {
  if (typeof page?.on !== 'function' || typeof page?.off !== 'function') return null;

  let settled = false;
  let resolveProbe;
  let timeoutId = null;

  async function handleResponse(response) {
    if (settled) return;
    try {
      if (allowedEndpoints && allowedEndpoints.length > 0) {
        const url = typeof response.url === 'function' ? response.url() : response?.url;
        if (typeof url === 'string') {
          const matched = allowedEndpoints.some((ep) => {
            const pattern = ep?.meta?.urlPattern ?? ep;
            if (pattern instanceof RegExp) return pattern.test(url);
            if (typeof pattern === 'string') return url.includes(pattern);
            return false;
          });
          if (!matched) return;
        }
      }

      const rawHeaders = typeof response?.headers === 'function' ? response.headers() : response?.headers;
      const headers = rawHeaders instanceof Promise ? await rawHeaders : rawHeaders;
      const contentType = Object.entries(headers ?? {})
        .find(([key]) => key.toLowerCase() === 'content-type')?.[1];
      if (typeof contentType !== 'string' || !contentType.toLowerCase().includes('application/json')) return;

      let body;
      try {
        body = typeof response.json === 'function' ? await response.json() : JSON.parse(await response.text());
      } catch {
        return;
      }

      const hit = findActiveIdInPayload(body);
      if (hasMallId(hit) && !settled) {
        settled = true;
        resolveProbe?.(hit);
      }
    } catch {
      /* best-effort probe */
    }
  }

  try {
    return await new Promise((resolve) => {
      resolveProbe = resolve;
      page.on('response', handleResponse);
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    try { page.off('response', handleResponse); } catch { /* noop */ }
  }
}

export { hasMallId };
