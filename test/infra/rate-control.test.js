import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createRateControl, withWriteRateControl, _resetSharedRateControl } from '../../src/infra/rate-control.js';

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => { t += ms; },
  };
}

describe('rate-control', () => {
  it('acquire consumes tokens', async () => {
    const clock = fakeClock();
    const sleeps = [];
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 2,
      jitterMs: [0, 0],
      now: clock.now,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
      random: () => 0,
    });

    await rc.acquire('test');
    await rc.acquire('test');
    assert.equal(rc.status().tokens, 0);
  });

  it('acquire waits when no tokens available', async () => {
    const clock = fakeClock();
    const sleeps = [];
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 1,
      jitterMs: [0, 0],
      now: clock.now,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
      random: () => 0,
    });

    await rc.acquire('a');
    await rc.acquire('b');
    assert(sleeps.length >= 1, 'should have slept at least once');
  });

  it('jitter applies random delay within range', async () => {
    const clock = fakeClock();
    const sleeps = [];
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 5,
      jitterMs: [100, 500],
      now: clock.now,
      sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); },
      random: () => 0.5,
    });

    await rc.acquire('test');
    const jitterSleep = sleeps[sleeps.length - 1];
    assert(jitterSleep >= 100 && jitterSleep <= 500, `jitter ${jitterSleep} outside [100,500]`);
  });

  it('reset restores tokens', async () => {
    const clock = fakeClock();
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 2,
      jitterMs: [0, 0],
      now: clock.now,
      sleep: async (ms) => clock.advance(ms),
      random: () => 0,
    });

    await rc.acquire('a');
    await rc.acquire('b');
    assert.equal(rc.status().tokens, 0);
    rc.reset();
    assert.equal(rc.status().tokens, 2);
  });

  it('withWriteRateControl wraps function execution', async () => {
    const clock = fakeClock();
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 5,
      jitterMs: [0, 0],
      now: clock.now,
      sleep: async (ms) => clock.advance(ms),
      random: () => 0,
    });

    const result = await withWriteRateControl('test', async () => 42, { rateControl: rc });
    assert.equal(result, 42);
  });

  it('withWriteRateControl propagates errors', async () => {
    const clock = fakeClock();
    const rc = createRateControl({
      tokensPerMinute: 60,
      burst: 5,
      jitterMs: [0, 0],
      now: clock.now,
      sleep: async (ms) => clock.advance(ms),
      random: () => 0,
    });

    await assert.rejects(
      () => withWriteRateControl('test', async () => { throw new Error('boom'); }, { rateControl: rc }),
      { message: 'boom' }
    );
  });
});
