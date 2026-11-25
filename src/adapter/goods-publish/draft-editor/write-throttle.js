import { abortableSleep, throwIfAborted } from '../../../infra/abort.js';

const DEFAULT_TOKENS_PER_MINUTE = 20;
const DEFAULT_BURST = 2;
const DEFAULT_JITTER_MS = Object.freeze([2000, 8000]);

function resolveEnabled(enabled, mode) {
  if (typeof enabled === 'boolean') return enabled;
  return mode !== 'fixture';
}

/**
 * Private instance-scoped abortable write throttle for merchant draft mutations.
 * Responds immediately to AbortSignal and performs zero wait when disabled or in fixture mode.
 */
export function createWriteThrottle({
  tokensPerMinute = DEFAULT_TOKENS_PER_MINUTE,
  burst = DEFAULT_BURST,
  jitterMs = DEFAULT_JITTER_MS,
  enabled,
  mode = 'live',
  now = Date.now,
  sleep = abortableSleep,
  random = Math.random,
} = {}) {
  const active = resolveEnabled(enabled, mode);
  if (active && (!Number.isInteger(tokensPerMinute) || tokensPerMinute <= 0)) {
    throw new TypeError('tokensPerMinute must be a positive integer');
  }

  let tokens = burst;
  let lastRefill = now();
  const intervalMs = 60_000 / (Number.isFinite(tokensPerMinute) && tokensPerMinute > 0 ? tokensPerMinute : DEFAULT_TOKENS_PER_MINUTE);

  function refill() {
    const current = now();
    const elapsed = current - lastRefill;
    const newTokens = Math.floor(elapsed / intervalMs);
    if (newTokens > 0) {
      tokens = Math.min(burst, tokens + newTokens);
      lastRefill = current;
    }
  }

  async function acquire(_label, signal) {
    throwIfAborted(signal);
    if (!active) return;

    refill();
    while (tokens <= 0) {
      const waitMs = intervalMs - (now() - lastRefill);
      await sleep(Math.max(waitMs, 100), signal);
      refill();
    }
    tokens -= 1;
    const [minJ, maxJ] = jitterMs;
    const jitter = minJ + random() * (maxJ - minJ);
    if (jitter > 0) await sleep(jitter, signal);
  }

  async function run(label, fn, signal) {
    await acquire(label, signal);
    return fn();
  }

  function status() {
    refill();
    return { active, tokens, lastRefill, tokensPerMinute, burst };
  }

  return Object.freeze({ acquire, run, status });
}
