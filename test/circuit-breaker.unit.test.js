import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { CircuitBreaker, _resetSharedBreaker, getSharedBreaker } from '../src/infra/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
  });

  it('allows calls when healthy', () => {
    breaker.check('test');
  });

  it('tracks consecutive failures per phase', () => {
    breaker.recordFailure('p1', new Error('fail'));
    breaker.recordFailure('p1', new Error('fail'));
    const s = breaker.status();
    assert.equal(s.phases.p1.failures, 2);
    breaker.check('p1');
  });

  it('trips phase after threshold failures', () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('p1', new Error('fail'));
    assert.throws(() => breaker.check('p1'), /熔断中/);
  });

  it('resets phase on success', () => {
    breaker.recordFailure('p1', new Error('fail'));
    breaker.recordFailure('p1', new Error('fail'));
    breaker.recordSuccess('p1');
    const s = breaker.status();
    assert.equal(s.phases.p1, undefined);
  });

  it('trips globally on auth errors', () => {
    const err = new Error('auth expired');
    err.code = 'E_AUTH_EXPIRED';
    breaker.recordFailure('login', err);
    assert.equal(breaker.status().globalTripped, true);
    assert.throws(() => breaker.check('any_phase'), /全局冷却/);
  });

  it('trips globally on captcha keyword', () => {
    breaker.recordFailure('save', new Error('请输入验证码'));
    assert.equal(breaker.status().globalTripped, true);
  });

  it('does not trip globally on regular errors', () => {
    breaker.recordFailure('save', new Error('network timeout'));
    assert.equal(breaker.status().globalTripped, false);
  });

  it('wrap() records success on resolve', async () => {
    await breaker.wrap('p1', async () => 42);
    assert.equal(breaker.status().phases.p1, undefined);
  });

  it('wrap() records failure on reject', async () => {
    await breaker.wrap('p1', async () => { throw new Error('boom'); }).catch(() => {});
    assert.equal(breaker.status().phases.p1.failures, 1);
  });

  it('wrap() throws before execution when tripped', async () => {
    for (let i = 0; i < 3; i++) breaker.recordFailure('p1', new Error('fail'));
    await assert.rejects(() => breaker.wrap('p1', async () => 42), /熔断中/);
  });

  it('reset() clears all state', () => {
    breaker.recordFailure('p1', new Error('fail'));
    breaker.recordFailure('p2', new Error('fail'));
    breaker.reset();
    const s = breaker.status();
    assert.equal(Object.keys(s.phases).length, 0);
    assert.equal(s.globalTripped, false);
  });

  it('reset(phase) clears only that phase', () => {
    breaker.recordFailure('p1', new Error('fail'));
    breaker.recordFailure('p2', new Error('fail'));
    breaker.reset('p1');
    assert.equal(breaker.status().phases.p1, undefined);
    assert.equal(breaker.status().phases.p2.failures, 1);
  });
});

describe('getSharedBreaker singleton', () => {
  beforeEach(() => _resetSharedBreaker());

  it('returns same instance', () => {
    const a = getSharedBreaker();
    const b = getSharedBreaker();
    assert.strictEqual(a, b);
  });
});
