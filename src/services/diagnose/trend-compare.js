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

export function compareShopDiagnosis(input) {
  const { current, previous } = input ?? {};
  if (!current) return null;

  const currentScore = current.score;
  const previousScore = previous?.score ?? null;

  const scoreDelta = (currentScore != null && previousScore != null)
    ? currentScore - previousScore
    : null;
  const scoreDeltaPct = (currentScore != null && previousScore != null)
    ? deltaPct(currentScore, previousScore)
    : null;

  const dimNames = ['orders', 'inventory', 'promo', 'funnel'];
  const dimensions = {};
  const regressions = [];
  const improvements = [];

  for (const name of dimNames) {
    const curDim = current.dimensions?.[name];
    const prevDim = previous?.dimensions?.[name];
    const curScore = curDim?.score ?? null;

    if (name === 'inventory') {
      dimensions[name] = {
        current: curScore,
        previous: null,
        delta: null,
        delta_pct: null,
        note: 'current_snapshot_only',
      };
      continue;
    }

    const prevScore = prevDim?.score ?? null;
    const delta = (curScore != null && prevScore != null) ? curScore - prevScore : null;
    const dPct = (curScore != null && prevScore != null) ? deltaPct(curScore, prevScore) : null;

    dimensions[name] = { current: curScore, previous: prevScore, delta, delta_pct: dPct };

    if (delta != null && delta < 0) {
      regressions.push({ dimension: name, delta, delta_pct: dPct });
    } else if (delta != null && delta > 0) {
      improvements.push({ dimension: name, delta, delta_pct: dPct });
    }
  }

  regressions.sort((a, b) => a.delta - b.delta);
  improvements.sort((a, b) => b.delta - a.delta);

  return {
    score_delta: scoreDelta,
    score_delta_pct: scoreDeltaPct,
    dimensions,
    regressions,
    improvements,
  };
}
