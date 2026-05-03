import { describe, it } from 'vitest';
import { strict as assert } from 'node:assert';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { property, gen } from './_harness.js';
import { acquireLock, releaseLock, isLockStale, lockPath } from '../../src/adapter/auth-lock.js';

function tmpAuthPath() {
  return join(tmpdir(), `pbt-auth-lock-${randomUUID()}.json`);
}

async function cleanup(path) {
  const lp = lockPath(path);
  try { await unlink(lp); } catch { /* ok */ }
  try { await unlink(path); } catch { /* ok */ }
}

describe('auth-lock PBT', () => {
  it('PROP-LOCK-1: acquireLock + releaseLock round-trip always succeeds', async () => {
    await property(
      'acquire-release round-trip',
      gen.int(1, 100),
      async () => {
        const path = tmpAuthPath();
        try {
          const { token } = await acquireLock(path, { timeoutMs: 5000, staleMs: 60000 });
          assert.ok(typeof token === 'string' && token.length > 0);
          const released = await releaseLock(path, token);
          assert.ok(released);
          assert.ok(!existsSync(lockPath(path)));
          return true;
        } finally {
          await cleanup(path);
        }
      },
      { runs: 20 },
    );
  });

  it('PROP-LOCK-2: release with wrong token never deletes lock', async () => {
    await property(
      'owner-safety',
      gen.tuple(gen.string({ minLen: 4, maxLen: 8 }), gen.string({ minLen: 4, maxLen: 8 })),
      async ([a, b]) => {
        const path = tmpAuthPath();
        try {
          const { token } = await acquireLock(path, { timeoutMs: 5000 });
          const wrongToken = token + '-wrong';
          const released = await releaseLock(path, wrongToken);
          assert.strictEqual(released, false);
          assert.ok(existsSync(lockPath(path)));
          await releaseLock(path, token);
          return true;
        } finally {
          await cleanup(path);
        }
      },
      { runs: 20 },
    );
  });

  it('PROP-LOCK-3: stale lock (old createdAt) is detected', async () => {
    await property(
      'stale detection by age',
      gen.int(1, 1000),
      (staleOffsetMs) => {
        const lockData = {
          pid: process.pid,
          token: 'test',
          createdAt: Date.now() - 200_000 - staleOffsetMs,
        };
        return isLockStale(lockData, { staleMs: 120_000 }) === true;
      },
      { runs: 50 },
    );
  });

  it('PROP-LOCK-4: fresh lock with live PID is not stale', async () => {
    await property(
      'fresh lock not stale',
      gen.int(0, 50_000),
      (ageMs) => {
        const lockData = {
          pid: process.pid,
          token: 'test',
          createdAt: Date.now() - ageMs,
        };
        return isLockStale(lockData, { staleMs: 120_000 }) === false;
      },
      { runs: 50 },
    );
  });

  it('PROP-LOCK-5: double release is idempotent', async () => {
    await property(
      'idempotent release',
      gen.int(1, 50),
      async () => {
        const path = tmpAuthPath();
        try {
          const { token } = await acquireLock(path, { timeoutMs: 5000 });
          const r1 = await releaseLock(path, token);
          const r2 = await releaseLock(path, token);
          assert.ok(r1);
          assert.ok(r2);
          return true;
        } finally {
          await cleanup(path);
        }
      },
      { runs: 20 },
    );
  });

  it('PROP-LOCK-6: stale lock recovery allows re-acquisition', async () => {
    const path = tmpAuthPath();
    try {
      const lp = lockPath(path);
      await writeFile(lp, JSON.stringify({
        pid: 999999999,
        token: 'dead',
        createdAt: Date.now() - 300_000,
      }));
      const { token } = await acquireLock(path, { timeoutMs: 5000, staleMs: 120_000 });
      assert.ok(typeof token === 'string');
      await releaseLock(path, token);
    } finally {
      await cleanup(path);
    }
  });
});
