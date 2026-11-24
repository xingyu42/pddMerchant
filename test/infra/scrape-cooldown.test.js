import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import * as scrapeCooldownModule from '../../src/infra/scrape-cooldown.js';
import { PddCliError } from '../../src/infra/errors.js';

const { createScrapeCooldown } = scrapeCooldownModule;
const tempDirs = [];

function makeTempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-scrape-cooldown-'));
  tempDirs.push(dir);
  return join(dir, 'scrape-cooldown.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('scrape-cooldown (instance-scoped persistent store)', () => {
  it('retires getSharedScrapeCooldown global singleton export and exposes createScrapeCooldown', () => {
    assert.equal(typeof createScrapeCooldown, 'function');
    assert.equal(Object.hasOwn(scrapeCooldownModule, 'getSharedScrapeCooldown'), false);
  });

  it('validates threshold and cooldownMs inputs', () => {
    assert.throws(() => createScrapeCooldown({ threshold: 0, cooldownMs: 1000, statePath: null }), TypeError);
    assert.throws(() => createScrapeCooldown({ threshold: 2, cooldownMs: 0, statePath: null }), TypeError);
  });

  it('persists soft-block cooldown across instances sharing statePath and clears on recordSuccess', () => {
    const statePath = makeTempStatePath();
    let nowMs = 1_700_000_000_000;
    const now = () => nowMs;

    const first = createScrapeCooldown({ now, statePath, threshold: 2, cooldownMs: 60_000 });
    first.check();
    const hit1 = first.recordSoftBlock({ reason: 'empty_shell' });
    assert.equal(hit1.cooldownTriggered, false);
    assert.equal(hit1.consecutiveSoftBlock, 1);

    const second = createScrapeCooldown({ now, statePath, threshold: 2, cooldownMs: 60_000 });
    const hit2 = second.recordSoftBlock({ reason: 'empty_shell' });
    assert.equal(hit2.cooldownTriggered, true);
    assert.equal(hit2.consecutiveSoftBlock, 2);
    assert.equal(hit2.cooldownRemainingMs, 60_000);

    const third = createScrapeCooldown({ now, statePath, threshold: 2, cooldownMs: 60_000 });
    assert.throws(
      () => third.check(),
      (err) => err instanceof PddCliError && err.code === 'E_RATE_LIMIT' && err.detail?.cooldown_remaining_ms === 60_000,
    );

    const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(persisted.consecutiveSoftBlock, 2);

    third.recordSuccess();
    const fourth = createScrapeCooldown({ now, statePath, threshold: 2, cooldownMs: 60_000 });
    fourth.check();
    assert.equal(fourth.status().consecutiveSoftBlock, 0);
    assert.equal(fourth.status().cooldownRemainingMs, 0);
  });
});
