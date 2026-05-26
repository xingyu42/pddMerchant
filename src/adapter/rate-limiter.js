import { boxMullerZ } from '../infra/random-utils.js';

const DEFAULT_QPS = 2;
const DEFAULT_BURST = 3;

export function lognormalJitter(baseMs, sigma = 0.5, random = Math.random) {
  if (sigma <= 0 || baseMs <= 0) return 0;
  const z = boxMullerZ(random);
  return Math.max(0, Math.round(baseMs * (Math.exp(sigma * z) - 1)));
}

export function createRateLimiter({
  qps = DEFAULT_QPS,
  burst = DEFAULT_BURST,
  jitterSigma = 0,
  healthMultiplier = null,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  random = Math.random,
} = {}) {
  if (qps === 0) {
    return {
      async acquire(_label) {
        await Promise.resolve();
        return { waitMs: 0 };
      },
      _reset() {},
    };
  }

  let tokens = burst;
  let lastRefill = now();
  const queue = [];
  let draining = false;

  function refill() {
    const current = now();
    const elapsed = (current - lastRefill) / 1000;
    tokens = Math.min(burst, tokens + elapsed * qps);
    lastRefill = current;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    while (queue.length > 0) {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        const next = queue.shift();
        next.resolve({ waitMs: now() - next.enqueuedAt });
      } else {
        const effectiveQps = qps * (healthMultiplier?.() ?? 1);
        const safeQps = Math.max(effectiveQps, 0.01);
        const baseWaitMs = Math.ceil((1 - tokens) / safeQps * 1000);
        const jitter = jitterSigma > 0 ? lognormalJitter(baseWaitMs, jitterSigma, random) : 0;
        const waitMs = baseWaitMs + jitter;
        await sleep(waitMs);
        refill();
      }
    }
    draining = false;
  }

  return {
    acquire(label) {
      return new Promise((resolve) => {
        queue.push({ resolve, label, enqueuedAt: now() });
        drain();
      });
    },
    _reset() {
      tokens = burst;
      lastRefill = now();
      queue.length = 0;
      draining = false;
    },
  };
}
