import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { resolveClock } from '../../src/infra/clock.js';

class StatefulClock {
  constructor(initialMs = 1_700_000_000_000) {
    this.t = initialMs;
  }

  now() {
    return this.t;
  }

  async sleep(ms) {
    this.t += ms;
  }
}

describe('resolveClock', () => {
  it('binds clock.now and clock.sleep to the caller clock instance across direct and destructured calls', async () => {
    const stateful = new StatefulClock(1_000);
    const resolved = resolveClock(stateful);

    assert.equal(resolved.now(), 1_000);
    await resolved.sleep(250);
    assert.equal(resolved.now(), 1_250);

    const { now, sleep } = resolved;
    assert.equal(now(), 1_250);
    await sleep(750);
    assert.equal(now(), 2_000);
    assert.equal(stateful.t, 2_000);
  });
});
