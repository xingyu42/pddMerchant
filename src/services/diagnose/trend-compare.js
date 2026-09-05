const DAY_SECONDS = 86400;

export function resolveCompareWindows(options = {}) {
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  const days = options.days ?? 7;
  return {
    current: { since: nowSec - days * DAY_SECONDS, until: nowSec, days },
    previous: { since: nowSec - 2 * days * DAY_SECONDS, until: nowSec - days * DAY_SECONDS, days },
  };
}

function deltaPct(current, previous) {
  if (previous === 0 || previous == null) return null;
  return Number(((current - previous) / previous * 100).toFixed(2));
}

export function compareShopDiagnosis(input = {}) {
  const { current, previous } = input;
  if (!current) return null;

  const dimNames = ['orders', 'inventory', 'promo', 'funnel'];
  const dimensions = {};

  for (const name of dimNames) {
    const curDim = current.dimensions?.[name];
    const prevDim = previous?.dimensions?.[name];
    const metrics = {};
    const keys = new Set([...Object.keys(curDim?.detail ?? {}), ...Object.keys(prevDim?.detail ?? {})]);
    for (const key of keys) {
      if (key === 'window_days' || key === 'low_stock_threshold') continue;
      const curValue = curDim?.detail?.[key];
      const prevValue = prevDim?.detail?.[key];
      if (!Number.isFinite(curValue) && !Number.isFinite(prevValue)) continue;
      // These endpoints expose current snapshots, not historical values.
      const snapshot = name === 'inventory' || (name === 'orders' && ['unship', 'delay'].includes(key));
      const currentValue = Number.isFinite(curValue) ? curValue : null;
      const previousValue = !snapshot && Number.isFinite(prevValue) ? prevValue : null;
      const comparable = currentValue != null && previousValue != null;
      metrics[key] = {
        current: currentValue,
        previous: previousValue,
        delta: comparable ? Number((currentValue - previousValue).toFixed(4)) : null,
        delta_pct: comparable ? deltaPct(currentValue, previousValue) : null,
        ...(snapshot ? { note: 'current_snapshot_only' } : {}),
      };
    }
    dimensions[name] = { metrics };
  }
  return { dimensions };
}
