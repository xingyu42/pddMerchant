const DEFAULT_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRateControl({
  tokensPerMinute,
  burst = 2,
  jitterMs = [2000, 8000],
  now = Date.now,
  sleep = DEFAULT_SLEEP,
  random = Math.random,
} = {}) {
  if (!Number.isInteger(tokensPerMinute) || tokensPerMinute <= 0) {
    throw new TypeError('tokensPerMinute must be a positive integer');
  }
  const effectiveTPM = tokensPerMinute;
  let tokens = burst;
  let lastRefill = now();
  const interval = 60_000 / effectiveTPM;

  function refill() {
    const current = now();
    const elapsed = current - lastRefill;
    const newTokens = Math.floor(elapsed / interval);
    if (newTokens > 0) {
      tokens = Math.min(burst, tokens + newTokens);
      lastRefill = current;
    }
  }

  async function acquire(label) {
    refill();
    while (tokens <= 0) {
      const waitMs = interval - (now() - lastRefill);
      await sleep(Math.max(waitMs, 100));
      refill();
    }
    tokens -= 1;
    const [minJ, maxJ] = jitterMs;
    const jitter = minJ + random() * (maxJ - minJ);
    await sleep(jitter);
  }

  function recordSuccess(label) {}
  function recordFailure(label, err) {}

  function status() {
    refill();
    return { tokens, lastRefill, tokensPerMinute, burst };
  }

  function reset() {
    tokens = burst;
    lastRefill = now();
  }

  return { acquire, recordSuccess, recordFailure, status, reset };
}

let _shared = null;

export function getSharedWriteRateControl(opts) {
  if (!_shared) {
    _shared = createRateControl(opts);
  }
  return _shared;
}

export function _resetSharedRateControl() {
  _shared = null;
}

export async function withWriteRateControl(label, fn, options = {}) {
  const rc = options.rateControl ?? getSharedWriteRateControl({
    tokensPerMinute: options.tokensPerMinute,
  });
  await rc.acquire(label);
  try {
    const result = await fn();
    rc.recordSuccess(label);
    return result;
  } catch (err) {
    rc.recordFailure(label, err);
    throw err;
  }
}
