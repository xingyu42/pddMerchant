const DEFAULT_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRateControl({
  tokensPerMinute = 20,
  burst = 2,
  jitterMs = [2000, 8000],
  now = Date.now,
  sleep = DEFAULT_SLEEP,
  random = Math.random,
} = {}) {
  const effectiveTPM = Math.max(1, Number.isFinite(tokensPerMinute) ? tokensPerMinute : 20);
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
    const tpm = parseInt(process.env.PDD_WRITE_RATE_TPM, 10);
    _shared = createRateControl({
      ...opts,
      tokensPerMinute: Number.isFinite(tpm) ? tpm : undefined,
    });
  }
  return _shared;
}

export function _resetSharedRateControl() {
  _shared = null;
}

export async function withWriteRateControl(label, fn, options = {}) {
  const rc = options.rateControl ?? getSharedWriteRateControl();
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
