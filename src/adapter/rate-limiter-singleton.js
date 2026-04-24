import { createRateLimiter } from './rate-limiter.js';
import { PlaywrightEndpointClient } from './endpoint-client.js';

const DEFAULT_QPS = 2;
const DEFAULT_BURST = 3;
const DEFAULT_COOLDOWN_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function readNonNegativeFloat(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readPositiveInt(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : fallback;
}

function readPositiveFloat(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const _cooldownConfig = {
  threshold: readPositiveInt('PDD_COOLDOWN_THRESHOLD', DEFAULT_COOLDOWN_THRESHOLD),
  ms: readPositiveFloat('PDD_COOLDOWN_MS', DEFAULT_COOLDOWN_MS),
};

const _cooldownState = {
  map: new Map(),
  get threshold() { return _cooldownConfig.threshold; },
  set threshold(v) { _cooldownConfig.threshold = v; },
  get ms() { return _cooldownConfig.ms; },
  set ms(v) { _cooldownConfig.ms = v; },
};

let _limiter = null;
let _client = null;

export function getSharedLimiter() {
  if (!_limiter) {
    const qps = readNonNegativeFloat('PDD_RATE_LIMIT_QPS', DEFAULT_QPS);
    const burst = readPositiveInt('PDD_RATE_LIMIT_BURST', DEFAULT_BURST);
    _limiter = createRateLimiter({ qps, burst });
  }
  return _limiter;
}

export function getSharedClient() {
  if (!_client) {
    _client = new PlaywrightEndpointClient({
      limiter: getSharedLimiter(),
      cooldownState: _cooldownState,
    });
  }
  return _client;
}

export function _resetSharedLimiter() {
  _limiter = null;
  _client = null;
}

export function _resetSharedClient() {
  _cooldownState.map.clear();
  _limiter = null;
  _client = null;
}
