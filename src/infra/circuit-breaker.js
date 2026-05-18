import { PddCliError, ExitCodes } from './errors.js';
import { getLogger } from './logger.js';

const BREAKER_DEFAULTS = {
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
  halfOpenAfterMs: 60 * 1000,
};

const TRIPWIRE_CODES = new Set([
  'E_RATE_LIMIT', 'E_AUTH_EXPIRED', 'E_AUTH_TIMEOUT', 'E_QR_NOT_FOUND',
]);
const TRIPWIRE_MESSAGES = [
  '验证码', 'captcha', 'slider', '滑块', '请求太频繁', '风控',
];

export class CircuitBreaker {
  constructor(opts = {}) {
    this._threshold = opts.failureThreshold ?? BREAKER_DEFAULTS.failureThreshold;
    this._cooldownMs = opts.cooldownMs ?? BREAKER_DEFAULTS.cooldownMs;
    this._halfOpenMs = opts.halfOpenAfterMs ?? BREAKER_DEFAULTS.halfOpenAfterMs;
    this._phases = new Map();
    this._globalTripped = false;
    this._globalTrippedAt = 0;
    this._log = opts.log ?? getLogger();
  }

  check(phase) {
    if (this._isGlobalTripped()) {
      const remaining = this._globalCooldownRemaining();
      throw new PddCliError({
        code: 'E_RATE_LIMIT',
        message: `熔断器已触发，全局冷却中 (${Math.ceil(remaining / 1000)}s)`,
        hint: '连续失败或风控触发，请稍后重试',
        detail: { phase, cooldown_remaining_ms: remaining },
        exitCode: ExitCodes.RATE_LIMIT,
      });
    }
    const state = this._phases.get(phase);
    if (state?.cooldownUntil && Date.now() < state.cooldownUntil) {
      const remaining = state.cooldownUntil - Date.now();
      throw new PddCliError({
        code: 'E_RATE_LIMIT',
        message: `阶段 ${phase} 熔断中 (${Math.ceil(remaining / 1000)}s)`,
        hint: '该阶段连续失败，进入冷却期',
        detail: { phase, cooldown_remaining_ms: remaining, failures: state.failures },
        exitCode: ExitCodes.RATE_LIMIT,
      });
    }
  }

  recordSuccess(phase) {
    this._phases.delete(phase);
  }

  recordFailure(phase, err) {
    const prev = this._phases.get(phase) || { failures: 0, cooldownUntil: 0 };
    prev.failures += 1;
    prev.lastError = err?.message || String(err);
    prev.lastFailedAt = Date.now();

    if (prev.failures >= this._threshold) {
      prev.cooldownUntil = Date.now() + this._cooldownMs;
      this._log.warn({ phase, failures: prev.failures, cooldownMs: this._cooldownMs },
        'circuit-breaker: phase tripped');
    }

    this._phases.set(phase, prev);

    if (this._shouldTripGlobal(err)) {
      this._globalTripped = true;
      this._globalTrippedAt = Date.now();
      this._log.warn({ phase, err: err?.message || err?.code },
        'circuit-breaker: GLOBAL trip — auth/captcha/rate-limit detected');
    }
  }

  async wrap(phase, fn) {
    this.check(phase);
    try {
      const result = await fn();
      this.recordSuccess(phase);
      return result;
    } catch (err) {
      this.recordFailure(phase, err);
      throw err;
    }
  }

  status() {
    const phases = {};
    for (const [name, state] of this._phases) {
      phases[name] = {
        failures: state.failures,
        cooldownRemaining: state.cooldownUntil ? Math.max(0, state.cooldownUntil - Date.now()) : 0,
        lastError: state.lastError,
      };
    }
    return {
      globalTripped: this._isGlobalTripped(),
      globalCooldownRemaining: this._globalCooldownRemaining(),
      phases,
    };
  }

  reset(phase) {
    if (phase) {
      this._phases.delete(phase);
    } else {
      this._phases.clear();
      this._globalTripped = false;
      this._globalTrippedAt = 0;
    }
  }

  _isGlobalTripped() {
    if (!this._globalTripped) return false;
    if (Date.now() - this._globalTrippedAt > this._cooldownMs) {
      this._globalTripped = false;
      return false;
    }
    return true;
  }

  _globalCooldownRemaining() {
    if (!this._globalTripped) return 0;
    return Math.max(0, (this._globalTrippedAt + this._cooldownMs) - Date.now());
  }

  _shouldTripGlobal(err) {
    if (!err) return false;
    if (err.code && TRIPWIRE_CODES.has(err.code)) return true;
    const msg = (err.message || '').toLowerCase();
    return TRIPWIRE_MESSAGES.some(kw => msg.includes(kw));
  }
}

let _shared = null;

export function getSharedBreaker(opts) {
  if (!_shared) _shared = new CircuitBreaker(opts);
  return _shared;
}

export function _resetSharedBreaker() {
  _shared = null;
}
