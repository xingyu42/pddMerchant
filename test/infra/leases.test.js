import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, get, openDatabase, run } from '../../src/infra/db.js';
import { acquireLease, assertLeaseOwner, releaseLease, renewLease } from '../../src/infra/leases.js';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const WAIT_OPTIONS = { timeoutMs: 25, retryMs: 1 };
let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-leases-test-'));
  openDatabase(join(root, 'pdd.db'));
});

afterEach(() => {
  try {
    closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readLease() {
  return get('SELECT * FROM leases WHERE scope = ? AND key = ?', 'account', '42');
}

function seedLease({ pid = process.pid, host = hostname(), expiresAt = FUTURE } = {}) {
  run(`INSERT INTO leases (scope, key, owner_token, pid, hostname, acquired_at, expires_at, heartbeat_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 'account', '42', 'previous-owner', pid, host, PAST, expiresAt, PAST);
}

function deadPid() {
  const result = spawnSync(process.execPath, ['--eval', ''], { timeout: 5000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  assert.ok(Number.isSafeInteger(result.pid) && result.pid > 0);
  assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
  return result.pid;
}

describe('leases', () => {
  it('excludes a second acquirer and reports a small explicit timeout', async () => {
    const { token } = await acquireLease('account', 42);
    const original = readLease();
    assert.equal(original.owner_token, token);
    assert.equal(original.pid, process.pid);
    assert.equal(original.hostname, hostname());
    await assert.rejects(acquireLease('account', 42, WAIT_OPTIONS), { code: 'E_LOCK_TIMEOUT' });
    assert.deepEqual(readLease(), original);
    assert.doesNotThrow(() => assertLeaseOwner('account', 42, token));
  });

  it('immediately takes over a same-host dead-pid row even before its expiry', async () => {
    seedLease({ pid: deadPid() });
    const { token } = await acquireLease('account', 42);
    assert.notEqual(token, 'previous-owner');
    assert.equal(readLease().owner_token, token);
    assert.equal(readLease().pid, process.pid);
    assert.doesNotThrow(() => assertLeaseOwner('account', 42, token));
  });

  it('preserves a same-host live-pid row even after its expiry', async () => {
    seedLease({ expiresAt: PAST });
    const original = readLease();
    await assert.rejects(acquireLease('account', 42, WAIT_OPTIONS), { code: 'E_LOCK_TIMEOUT' });
    assert.deepEqual(readLease(), original);
  });

  it('takes over an expired same-host live pid with the heartbeat rule', async () => {
    seedLease({ expiresAt: PAST });
    const { token } = await acquireLease('account', 42, { staleBy: 'heartbeat', timeoutMs: 0 });
    assert.notEqual(token, 'previous-owner');
    assert.equal(readLease().owner_token, token);
  });

  it('keeps an unexpired heartbeat lease even when its local pid is dead', async () => {
    seedLease({ pid: deadPid() });
    const original = readLease();
    await assert.rejects(acquireLease('account', 42, { staleBy: 'heartbeat', timeoutMs: 0 }), { code: 'E_LOCK_TIMEOUT' });
    assert.deepEqual(readLease(), original);
  });

  it('tries once with zero timeout, without sleeping or extending the wait', async () => {
    vi.useFakeTimers();
    const extendUntil = vi.fn(() => Date.now() + 1000);
    const { token } = await acquireLease('account', 42, { timeoutMs: 0 });
    const original = readLease();
    run('UPDATE leases SET expires_at = ? WHERE scope = ? AND key = ?', PAST, 'account', '42');
    await assert.rejects(acquireLease('account', 42, { timeoutMs: 0, extendUntil }), { code: 'E_LOCK_TIMEOUT' });
    assert.equal(readLease().owner_token, token);
    assert.equal(readLease().acquired_at, original.acquired_at);
    assert.equal(extendUntil.mock.calls.length, 0);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('applies the heartbeat rule on later attempts in a wait', async () => {
    vi.useFakeTimers();
    seedLease({ expiresAt: new Date(Date.now() + 100).toISOString() });
    const waiting = acquireLease('account', 42, { staleBy: 'heartbeat', timeoutMs: 500, retryMs: 1 });
    await vi.advanceTimersByTimeAsync(300);
    assert.equal(readLease().owner_token, (await waiting).token);
  });

  it('takes over a foreign-host row only after expires_at regardless of its pid', async () => {
    seedLease({ host: `${hostname()}-foreign`, pid: process.pid });
    const original = readLease();
    await assert.rejects(acquireLease('account', 42, WAIT_OPTIONS), { code: 'E_LOCK_TIMEOUT' });
    assert.deepEqual(readLease(), original);

    run('UPDATE leases SET expires_at = ? WHERE scope = ? AND key = ?', PAST, 'account', '42');
    const { token } = await acquireLease('account', 42);
    assert.notEqual(token, original.owner_token);
    assert.equal(readLease().owner_token, token);
    assert.equal(readLease().hostname, hostname());
  });

  it('cancels an already waiting acquisition through AbortSignal', async () => {
    await acquireLease('account', 42);
    const original = readLease();
    const controller = new AbortController();
    const waiting = acquireLease('account', 42, { timeoutMs: 10_000, retryMs: 1000, signal: controller.signal });
    const rejected = assert.rejects(waiting, { code: 'E_TIMEOUT' });
    // acquireLease has synchronously tried the occupied row and installed its abortable wait.
    controller.abort();
    await rejected;
    assert.deepEqual(readLease(), original);
  });

  it('keeps the row when releasing with a wrong token and removes it for its owner', async () => {
    const { token } = await acquireLease('account', 42);
    const original = readLease();
    assert.equal(releaseLease('account', 42, 'wrong-token'), false);
    assert.deepEqual(readLease(), original);
    assert.equal(releaseLease('account', 42, token), true);
    assert.equal(readLease(), undefined);
  });

  it('rejects the previous owner after a dead-pid takeover', async () => {
    const previous = await acquireLease('account', 42);
    run('UPDATE leases SET pid = ? WHERE scope = ? AND key = ?', deadPid(), 'account', '42');
    const current = await acquireLease('account', 42);
    assert.notEqual(current.token, previous.token);
    assert.throws(() => assertLeaseOwner('account', 42, previous.token), { code: 'E_AUTH_LOCK_LOST', exitCode: 3 });
    assert.doesNotThrow(() => assertLeaseOwner('account', 42, current.token));
  });

  it('renews expires_at and heartbeat_at without changing ownership or acquisition time', async () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const { token } = await acquireLease('account', 42, { ttlMs: 1000 });
    const original = readLease();
    clock.mockReturnValue(now + 5000);
    assert.equal(renewLease('account', 42, token, { ttlMs: 20_000 }).changes, 1);
    const renewed = readLease();
    assert.ok(Date.parse(renewed.expires_at) > Date.parse(original.expires_at));
    assert.deepEqual({ ...renewed }, {
      ...original,
      expires_at: new Date(now + 25_000).toISOString(),
      heartbeat_at: new Date(now + 5000).toISOString(),
    });
  });

  it('extends an exhausted wait and acquires after the original deadline', async () => {
    vi.useFakeTimers();
    await acquireLease('account', 42);
    const extended = Date.now() + 500;
    const extendUntil = vi.fn(() => extended);
    const waiting = acquireLease('account', 42, { timeoutMs: 25, retryMs: 1, extendUntil });
    await vi.advanceTimersByTimeAsync(100);
    assert.ok(extendUntil.mock.calls.length > 0);
    run('DELETE FROM leases');
    await vi.advanceTimersByTimeAsync(100);
    assert.ok((await waiting).token);
  });

  it('stops extending when the supplied extension is exhausted', async () => {
    vi.useFakeTimers();
    await acquireLease('account', 42);
    const extended = Date.now() + 100;
    const waiting = assert.rejects(acquireLease('account', 42, {
      timeoutMs: 25, retryMs: 1, extendUntil: () => extended,
    }), { code: 'E_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(150);
    await waiting;
  });

  it('caps extension at the waiting command deadline', async () => {
    vi.useFakeTimers();
    await acquireLease('account', 42);
    const waiting = assert.rejects(acquireLease('account', 42, {
      timeoutMs: 25, retryMs: 1, extendUntil: () => Date.now() + 1000, deadlineAt: Date.now() + 75,
    }), { code: 'E_LOCK_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(75);
    await waiting;
  });

  it('still responds to cancellation during the extended wait', async () => {
    vi.useFakeTimers();
    await acquireLease('account', 42);
    const controller = new AbortController();
    const waiting = assert.rejects(acquireLease('account', 42, {
      timeoutMs: 25, retryMs: 1, signal: controller.signal, extendUntil: () => Date.now() + 1000,
    }), { code: 'E_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    await waiting;
  });
});
