import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempRoots = [];

async function tempStatePath() {
  const root = await mkdtemp(join(tmpdir(), 'pdd-daemon-lifecycle-'));
  tempRoots.push(root);
  return join(root, 'daemon-state.json');
}

function captureStdout() {
  const original = process.stdout.write;
  let output = '';
  process.stdout.write = function write(chunk, encoding, cb) {
    output += String(chunk);
    if (typeof encoding === 'function') encoding();
    if (typeof cb === 'function') cb();
    return true;
  };
  return () => {
    process.stdout.write = original;
    return output;
  };
}

async function importDaemonCommand({ statePath, pidAlive = false, ensureResult, terminate = () => {} } = {}) {
  vi.resetModules();
  vi.doMock('../src/infra/paths.js', () => ({
    DAEMON_STATE_PATH: statePath,
  }));
  vi.doMock('../src/infra/process-util.js', () => ({
    isPidAlive: () => typeof pidAlive === 'function' ? pidAlive() : pidAlive,
  }));
  vi.doMock('../src/infra/daemon-launcher.js', () => ({
    ensureDaemonRunning: async () => ensureResult ?? { started: false, pid: 12345 },
  }));
  vi.doMock('node:os', () => ({ platform: () => 'win32' }));
  vi.doMock('node:child_process', () => ({ execSync: terminate }));
  return import('../src/commands/daemon.js');
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    await rm(root, { recursive: true, force: true });
  }
});

describe('daemon command lifecycle invariants', () => {
  it('preserves state and reports failure when termination is denied', async () => {
    const statePath = await tempStatePath();
    await writeFile(statePath, JSON.stringify({ pid: 12345, tokenFingerprint: 'test' }));
    const daemon = await importDaemonCommand({
      statePath, pidAlive: true, terminate: () => { throw new Error('denied'); },
    });
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback) => { queueMicrotask(callback); return 0; });
    const restore = captureStdout();
    try {
      const result = await daemon.stop({ json: true });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'E_DAEMON_STOP_FAILED');
      assert.equal(result.data.stopped, false);
      assert.equal(existsSync(statePath), true);
    } finally { restore(); }
  });

  it('preserves a replacement state after the old process stops', async () => {
    const statePath = await tempStatePath();
    await writeFile(statePath, JSON.stringify({ pid: 12345, tokenFingerprint: 'old' }));
    let alive = true;
    const daemon = await importDaemonCommand({ statePath, pidAlive: () => alive, terminate: () => {
      alive = false;
      writeFileSync(statePath, JSON.stringify({ pid: 54321, tokenFingerprint: 'new' }));
    } });
    const restore = captureStdout();
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback) => { queueMicrotask(callback); return 0; });
    try {
      assert.equal((await daemon.stop({ json: true })).data.stopped, true);
      assert.equal(existsSync(statePath), true);
    } finally { restore(); }
  });
  it('daemon status cleans stale state and keeps --json stdout to one envelope line', async () => {
    const statePath = await tempStatePath();
    await writeFile(statePath, JSON.stringify({
      pid: 987654321,
      startedAt: '2026-07-08T00:00:00.000Z',
      lastResult: 'refreshed',
      refreshCount: 2,
      failureCount: 0,
    }));
    const daemon = await importDaemonCommand({ statePath, pidAlive: false });

    const restore = captureStdout();
    const envelope = await daemon.status({ json: true, noColor: true });
    const stdout = restore();

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'daemon.status');
    assert.equal(envelope.data.running, false);
    assert.equal(existsSync(statePath), false, 'stale daemon state file should be removed');

    const lines = stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `expected one stdout JSON line, got ${lines.length}: ${stdout}`);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, 'daemon.status');
    assert.equal(parsed.data.running, false);
    assert.equal(parsed.data.pid, 987654321);
  });

  it('daemon stop cleans tokenless state before attempting process termination', async () => {
    const statePath = await tempStatePath();
    await writeFile(statePath, JSON.stringify({
      pid: 987654321,
      startedAt: '2026-07-08T00:00:00.000Z',
      status: 'running',
    }));
    const daemon = await importDaemonCommand({
      statePath,
      pidAlive: true,
    });

    const restore = captureStdout();
    const envelope = await daemon.stop({ json: true, noColor: true });
    const stdout = restore();

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'daemon.stop');
    assert.equal(envelope.data.stopped, false);
    assert.equal(envelope.data.message, 'daemon state missing token, cleaned');
    assert.equal(existsSync(statePath), false, 'tokenless daemon state file should be removed');

    const lines = stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `expected one stdout JSON line, got ${lines.length}: ${stdout}`);
  });

  it('daemon start reports an already-running daemon without spawning a replacement', async () => {
    const statePath = await tempStatePath();
    const daemon = await importDaemonCommand({
      statePath,
      pidAlive: true,
      ensureResult: { started: false, pid: 24680 },
    });

    const restore = captureStdout();
    const envelope = await daemon.start({ json: true, noColor: true });
    const stdout = restore();

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'daemon.start');
    assert.equal(envelope.data.pid, 24680);
    assert.equal(envelope.data.already_running, true);
    assert.equal(envelope.data.stateFile, statePath);

    const lines = stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `expected one stdout JSON line, got ${lines.length}: ${stdout}`);
  });

  it('daemon start reports failure when startup is unconfirmed even without a started pid', async () => {
    const statePath = await tempStatePath();
    const daemon = await importDaemonCommand({
      statePath,
      ensureResult: { started: false, confirmed: false },
    });

    const restore = captureStdout();
    const envelope = await daemon.start({ json: true, noColor: true });
    const stdout = restore();

    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'daemon.start');
    assert.equal(envelope.error.code, 'E_DAEMON_START_FAILED');
    assert.equal(envelope.meta.exit_code, 1);

    const lines = stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `expected one stdout JSON line, got ${lines.length}: ${stdout}`);
  });
});
