import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  createSessionHealth,
  getSharedSessionHealth,
  _resetSharedSessionHealth,
} from '../src/infra/session-health.js';

describe('createSessionHealth', () => {
  let health;
  let clock;

  beforeEach(() => {
    clock = 0;
    health = createSessionHealth({ now: () => clock, decayIntervalMs: 60_000 });
  });

  it('starts at score 100', () => {
    assert.equal(health.score(), 100);
  });

  it('recordSuccess caps at 100', () => {
    health.recordSuccess();
    assert.equal(health.score(), 100);
  });

  it('recordRisk reduces score by type', () => {
    health.recordRisk({ type: 'captcha' });
    assert.equal(health.score(), 70);
  });

  it('recordRisk uses -20 for unknown type', () => {
    health.recordRisk({ type: 'unknown-thing' });
    assert.equal(health.score(), 80);
  });

  it('score clamps to 0', () => {
    health.recordRisk({ type: 'login-redirect' });
    health.recordRisk({ type: 'login-redirect' });
    assert.equal(health.score(), 0);
  });

  it('check() throws PddCliError when score < minScore', () => {
    health.recordRisk({ type: 'login-redirect' });
    health.recordRisk({ type: 'captcha' });
    assert.throws(() => health.check(), (err) => {
      assert.equal(err.code, 'E_RATE_LIMIT');
      assert.equal(err.exitCode, 4);
      assert.ok(err.message.includes('Session health too low'));
      return true;
    });
  });

  it('check() passes when score >= minScore', () => {
    health.recordRisk({ type: '429' });
    health.check();
  });

  it('natural decay restores score over time', () => {
    health.recordRisk({ type: 'captcha' });
    assert.equal(health.score(), 70);
    clock += 60_000 * 5;
    assert.equal(health.score(), 80);
  });

  it('multiplier returns correct band', () => {
    assert.equal(health.multiplier(), 1.0);

    health.recordRisk({ type: 'captcha' });
    assert.equal(health.multiplier(), 0.6);

    health.recordRisk({ type: 'captcha' });
    assert.equal(health.multiplier(), 0.3);
  });

  it('multiplier returns 0 below all bands', () => {
    health.recordRisk({ type: 'login-redirect' });
    health.recordRisk({ type: 'login-redirect' });
    assert.equal(health.multiplier(), 0);
  });

  it('status() returns full snapshot', () => {
    health.recordSuccess();
    health.recordRisk({ type: '429' });
    const s = health.status();
    assert.equal(s.score, 85);
    assert.equal(s.riskCount, 1);
    assert.equal(s.successCount, 1);
    assert.equal(s.multiplier, 1.0);
  });

  it('reset() restores initial state', () => {
    health.recordRisk({ type: 'captcha' });
    health.reset();
    assert.equal(health.score(), 100);
    assert.equal(health.status().riskCount, 0);
  });

  it('recovery: N successes after risk restores score', () => {
    health.recordRisk({ type: 'captcha' });
    assert.equal(health.score(), 70);
    for (let i = 0; i < 6; i++) health.recordSuccess();
    assert.equal(health.score(), 100);
  });

  it('score always in [0, 100]', () => {
    for (let i = 0; i < 10; i++) health.recordRisk({ type: 'login-redirect' });
    assert.equal(health.score(), 0);
    for (let i = 0; i < 100; i++) health.recordSuccess();
    assert.equal(health.score(), 100);
  });
});

describe('getSharedSessionHealth singleton', () => {
  beforeEach(() => _resetSharedSessionHealth());

  it('returns same instance', () => {
    const a = getSharedSessionHealth();
    const b = getSharedSessionHealth();
    assert.strictEqual(a, b);
  });

  it('reset clears singleton', () => {
    const a = getSharedSessionHealth();
    _resetSharedSessionHealth();
    const b = getSharedSessionHealth();
    assert.notStrictEqual(a, b);
  });
});
