import { PddCliError, ExitCodes } from './errors.js';

const DEFAULT_MIN_SCORE = 40;
const DEFAULT_DECAY_INTERVAL_MS = 60_000;

const SCORE_DELTA = Object.freeze({
  success: 5,
  '429': -15,
  captcha: -30,
  slider: -30,
  'risk-modal': -40,
  'login-redirect': -50,
});

const MULTIPLIER_BANDS = [
  { min: 80, multiplier: 1.0 },
  { min: 60, multiplier: 0.6 },
  { min: 40, multiplier: 0.3 },
];

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createSessionHealth({
  minScore = DEFAULT_MIN_SCORE,
  now = Date.now,
  decayIntervalMs = DEFAULT_DECAY_INTERVAL_MS,
} = {}) {
  let _score = 100;
  let _riskCount = 0;
  let _successCount = 0;
  let _lastDecayAt = now();

  function applyDecay() {
    const elapsed = now() - _lastDecayAt;
    if (elapsed >= decayIntervalMs) {
      const ticks = Math.floor(elapsed / decayIntervalMs);
      _score = clamp(_score + ticks * 2, 0, 100);
      _lastDecayAt += ticks * decayIntervalMs;
    }
  }

  return {
    check() {
      applyDecay();
      if (_score < minScore) {
        throw new PddCliError({
          code: 'E_RATE_LIMIT',
          message: `Session health too low: ${_score} < ${minScore}`,
          hint: 'Wait for natural score recovery or restart session',
          exitCode: ExitCodes.RATE_LIMIT,
        });
      }
    },

    recordSuccess() {
      applyDecay();
      _successCount++;
      _score = clamp(_score + SCORE_DELTA.success, 0, 100);
    },

    recordRisk(signal) {
      applyDecay();
      _riskCount++;
      const delta = SCORE_DELTA[signal?.type] ?? -20;
      _score = clamp(_score + delta, 0, 100);
    },

    score() {
      applyDecay();
      return _score;
    },

    multiplier() {
      applyDecay();
      for (const band of MULTIPLIER_BANDS) {
        if (_score >= band.min) return band.multiplier;
      }
      return 0;
    },

    status() {
      applyDecay();
      return {
        score: _score,
        multiplier: this.multiplier(),
        riskCount: _riskCount,
        successCount: _successCount,
      };
    },

    reset() {
      _score = 100;
      _riskCount = 0;
      _successCount = 0;
      _lastDecayAt = now();
    },
  };
}

let _shared = null;

export function getSharedSessionHealth(opts) {
  if (!_shared) _shared = createSessionHealth(opts);
  return _shared;
}

export function _resetSharedSessionHealth() {
  _shared = null;
}
