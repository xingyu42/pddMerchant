const DEFAULT_QPS = 2;
const DEFAULT_BURST = 3;

export function createRateLimiter({
  qps = DEFAULT_QPS,
  burst = DEFAULT_BURST,
  now = Date.now,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
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
        const waitMs = Math.ceil((1 - tokens) / qps * 1000);
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
