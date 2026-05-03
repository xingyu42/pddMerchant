import { describe, it, afterEach } from 'vitest';
import { strict as assert } from 'node:assert';
import { execSync, spawn } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAEMON_STATE_PATH } from '../../src/infra/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', '..', 'bin', 'pdd.js');

function run(args, env = {}) {
  const result = execSync(`node ${BIN} ${args} --json`, {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, PDD_TEST_ADAPTER: 'fixture', ...env },
  });
  return JSON.parse(result.trim().split('\n').pop());
}

async function cleanDaemonState() {
  try { await unlink(DAEMON_STATE_PATH); } catch { /* ok */ }
}

describe('daemon e2e', () => {
  afterEach(async () => {
    await cleanDaemonState();
  });

  it('e2e: daemon status returns not running when no state', () => {
    const envelope = run('daemon status');
    assert.strictEqual(envelope.ok, true);
    assert.strictEqual(envelope.command, 'daemon.status');
    assert.strictEqual(envelope.data.running, false);
  });

  it('e2e: daemon stop when not running returns ok', () => {
    const envelope = run('daemon stop');
    assert.strictEqual(envelope.ok, true);
    assert.strictEqual(envelope.data.stopped, false);
    assert.ok(envelope.data.message.includes('not running'));
  });

  it('e2e: daemon status detects stale state and cleans up', async () => {
    await writeFile(DAEMON_STATE_PATH, JSON.stringify({
      pid: 999999999,
      token: 'stale-test',
      startedAt: new Date().toISOString(),
      status: 'running',
      lastRefreshAt: null,
      lastResult: null,
      nextRunAt: null,
      refreshCount: 0,
      failureCount: 0,
    }));

    const envelope = run('daemon status');
    assert.strictEqual(envelope.ok, true);
    assert.strictEqual(envelope.data.running, false);
    assert.ok(!existsSync(DAEMON_STATE_PATH), 'stale state file should be cleaned');
  });
});
