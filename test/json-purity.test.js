import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'pdd.js');

const ANSI_RE = /\u001b\[[0-9;]*m/;

function runDoctorWithMissingAuth() {
  const root = mkdtempSync(join(tmpdir(), 'pdd-doctor-json-'));
  try {
    return spawnSync(process.execPath, [BIN, 'doctor', '--json'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PDD_TEST_ADAPTER: 'fixture',
        PDD_AUTH_STATE_PATH: join(root, 'missing-auth.json'),
        PDD_CONSUMER_AUTH_STATE_PATH: join(root, 'missing-consumer-auth.json'),
        PDD_ACCOUNT_REGISTRY_PATH: join(root, 'missing-accounts.json'),
        PDD_ACCOUNTS_DIR: join(root, 'accounts'),
        NO_COLOR: '1',
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runDoctorWithConsumerOnly() {
  const root = mkdtempSync(join(tmpdir(), 'pdd-doctor-consumer-'));
  const consumerAuthPath = join(root, 'consumer-auth.json');
  writeFileSync(consumerAuthPath, JSON.stringify({ cookies: [], origins: [] }));
  try {
    return spawnSync(process.execPath, [BIN, 'doctor', '--json'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PDD_TEST_ADAPTER: 'fixture',
        PDD_AUTH_STATE_PATH: join(root, 'missing-merchant-auth.json'),
        PDD_CONSUMER_AUTH_STATE_PATH: consumerAuthPath,
        PDD_ACCOUNT_REGISTRY_PATH: join(root, 'missing-accounts.json'),
        PDD_ACCOUNTS_DIR: join(root, 'accounts'),
        NO_COLOR: '1',
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('pdd doctor --json outputs single-line valid JSON on stdout', () => {
  const result = runDoctorWithMissingAuth();

  const stdout = result.stdout ?? '';
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `expected 1 stdout line, got ${lines.length}:\n${stdout}`);

  const envelope = JSON.parse(lines[0]);
  assert.equal(typeof envelope.ok, 'boolean');
  assert.equal(typeof envelope.command, 'string');
  assert.ok('meta' in envelope);
  assert.equal(typeof envelope.meta.latency_ms, 'number');
});

test('pdd doctor --json stdout contains no ANSI color codes', () => {
  const result = runDoctorWithMissingAuth();
  assert.equal(
    ANSI_RE.test(result.stdout ?? ''),
    false,
    `stdout must be ANSI-free under --json mode, got: ${JSON.stringify(result.stdout)}`
  );
});

test('pdd unknown-cmd exits with code 2 (USAGE)', () => {
  const result = spawnSync(process.execPath, [BIN, 'does-not-exist'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 2, `expected exit=2, got ${result.status}\nstderr: ${result.stderr}`);
});

test('pdd --help exits 0 and mentions domain groups', () => {
  const result = spawnSync(process.execPath, [BIN, '--help'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0);
  const out = result.stdout ?? '';
  assert.match(out, /orders/);
  assert.match(out, /goods/);
  assert.match(out, /promo/);
  assert.match(out, /diagnose/);
  assert.match(out, /shops/);
});

test('pdd doctor exits with AUTH=3 when auth-state missing (exit code mapping)', () => {
  const result = runDoctorWithMissingAuth();
  const stdout = result.stdout ?? '';
  const envelope = JSON.parse(stdout.trim());
  assert.equal(envelope.ok, false, 'envelope.ok should be false when auth-state missing');
  assert.match(envelope.error.code, /AUTH/, `error code should contain AUTH, got: ${envelope.error.code}`);
  assert.equal(
    result.status,
    3,
    `expected exit=3 (AUTH) for ${envelope.error.code}, got ${result.status}. mapErrorToExit bug regression?`
  );
});

test('pdd doctor reports consumer health even when merchant auth is missing', () => {
  const result = runDoctorWithConsumerOnly();
  const envelope = JSON.parse((result.stdout ?? '').trim());

  assert.equal(result.status, 3);
  assert.equal(envelope.error.code, 'E_AUTH_STATE_MISSING');
  assert.equal(envelope.error.detail.auth_file.ok, false);
  assert.equal(envelope.error.detail.consumer_auth_file.ok, true);
  assert.equal(envelope.error.detail.consumer_logged_in.ok, true);
});
