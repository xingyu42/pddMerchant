export async function findFirst(page, selectors, { timeoutMs = 0, pollIntervalMs = 300 } = {}) {
  if (!Array.isArray(selectors) || selectors.length === 0) return null;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return { element: el, selector: sel };
      } catch { /* try next */ }
    }
    if (timeoutMs > 0 && Date.now() < deadline) {
      const wait = Math.min(pollIntervalMs, deadline - Date.now());
      if (wait > 0) await page.waitForTimeout(wait);
    }
  } while (timeoutMs > 0 && Date.now() < deadline);
  return null;
}
