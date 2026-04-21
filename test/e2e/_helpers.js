// E2E 共享 helper：通过 spawnSync 调用真实 CLI，携带 mock adapter 环境变量。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(__dirname, '..', '..');
export const BIN = join(PROJECT_ROOT, 'bin', 'pdd.js');
export const FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures');

export const MOCK_ENV = {
  PDD_TEST_ADAPTER: 'fixture',
  PDD_TEST_FIXTURE_DIR: FIXTURE_DIR,
  NO_COLOR: '1',
};

// runPdd(args, extraEnv) → { status, stdout, stderr, envelope }
// envelope: 解析 stdout 为单行 JSON；若失败返回 null。
export function runPdd(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...MOCK_ENV, ...extraEnv },
  });
  let envelope = null;
  const raw = (result.stdout ?? '').trim();
  if (raw.length > 0) {
    try {
      envelope = JSON.parse(raw.split('\n').pop());
    } catch {
      envelope = null;
    }
  }
  return { ...result, envelope };
}

export function assertOkEnvelope(envelope, command) {
  assert.ok(envelope, `envelope must be parseable JSON; got null`);
  assert.equal(envelope.ok, true, `expected ok=true for ${command}`);
  assert.equal(envelope.command, command, `expected command=${command}`);
  assert.equal(envelope.error, null, `expected error=null for ${command}`);
  assert.ok(envelope.meta && typeof envelope.meta.latency_ms === 'number', 'meta.latency_ms required');
}

export function assertFailEnvelope(envelope, command, expectedCode) {
  assert.ok(envelope, 'envelope must be parseable JSON');
  assert.equal(envelope.ok, false, `expected ok=false for ${command}`);
  assert.equal(envelope.command, command);
  assert.ok(envelope.error, 'error object required');
  if (expectedCode) {
    assert.equal(envelope.error.code, expectedCode, `expected error.code=${expectedCode}`);
  }
}
