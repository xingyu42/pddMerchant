import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, get, openDatabase } from '../../src/infra/db.js';
import { getMasterKey } from '../../src/infra/master-key.js';

let root;
let dbPath;
let keyPath;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-master-key-test-'));
  dbPath = join(root, 'pdd.db');
  keyPath = join(root, 'master.key');
  openDatabase(dbPath);
});

afterEach(() => {
  try {
    closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fingerprint(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function storedFingerprint() {
  return get('SELECT value FROM meta WHERE key = ?', 'master_key_fingerprint').value;
}

function startKeyCreator() {
  const script = `
    import { openDatabase, closeDatabase } from ${JSON.stringify(new URL('../../src/infra/db.js', import.meta.url).href)};
    import { getMasterKey } from ${JSON.stringify(new URL('../../src/infra/master-key.js', import.meta.url).href)};
    process.send('ready');
    await new Promise((resolve) => process.once('message', resolve));
    try {
      openDatabase(process.env.PDD_DB_PATH);
      process.stdout.write(getMasterKey().toString('hex'));
    } finally {
      closeDatabase();
      process.disconnect();
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, PDD_DB_PATH: dbPath },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true, timeout: 30_000,
  });
  let stdout = '';
  let stderr = '';
  let spawnError;
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', (error) => { spawnError = error; reject(error); });
    child.once('close', (code) => reject(new Error(`Key creator exited before readiness: ${code}; ${stderr}`)));
  });
  const completed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr, spawnError }));
  });
  return { child, ready, completed };
}

describe('master key', () => {
  it('generates a 32-byte key file and stores its fingerprint on first use', () => {
    assert.equal(existsSync(keyPath), false);
    assert.equal(get('SELECT value FROM meta WHERE key = ?', 'master_key_fingerprint'), undefined);
    const key = getMasterKey();
    assert.ok(Buffer.isBuffer(key));
    assert.equal(key.length, 32);
    assert.deepEqual(JSON.parse(readFileSync(keyPath, 'utf8')), { version: 1, key: key.toString('base64') });
    assert.equal(storedFingerprint(), fingerprint(key));
    if (process.platform !== 'win32') assert.equal(statSync(keyPath).mode & 0o7777, 0o600);
  });

  it('memoizes the same key even if its file is removed in the current database generation', () => {
    const key = getMasterKey();
    unlinkSync(keyPath);
    assert.strictEqual(getMasterKey(), key);
    assert.equal(existsSync(keyPath), false);
    assert.equal(storedFingerprint(), fingerprint(key));
  });

  it('reports a missing key after close and reopen without generating a replacement', () => {
    const key = getMasterKey();
    closeDatabase();
    unlinkSync(keyPath);
    openDatabase(dbPath);

    assert.throws(() => getMasterKey(), { code: 'E_MASTER_KEY_MISSING', exitCode: 3 });
    assert.equal(existsSync(keyPath), false);
    assert.equal(storedFingerprint(), fingerprint(key));
  });

  it('detects a replaced key file after close and reopen', () => {
    const key = getMasterKey();
    const replacement = Buffer.from(key);
    replacement[0] ^= 0xff;
    closeDatabase();
    writeFileSync(keyPath, JSON.stringify({ version: 1, key: replacement.toString('base64') }));
    openDatabase(dbPath);

    assert.throws(() => getMasterKey(), { code: 'E_MASTER_KEY_MISMATCH', exitCode: 3 });
    assert.equal(storedFingerprint(), fingerprint(key));
    assert.equal(JSON.parse(readFileSync(keyPath, 'utf8')).key, replacement.toString('base64'));
  });

  it.skipIf(process.platform === 'win32')('rejects a POSIX key file with mode 0644', () => {
    getMasterKey();
    closeDatabase();
    chmodSync(keyPath, 0o644);
    openDatabase(dbPath);
    assert.equal(statSync(keyPath).mode & 0o7777, 0o644);
    assert.throws(() => getMasterKey(), { code: 'E_MASTER_KEY_INSECURE', exitCode: 3 });
  });

  it('concurrent first-create from two processes produces one identical key', async () => {
    closeDatabase();
    assert.equal(existsSync(keyPath), false);
    const creators = [startKeyCreator(), startKeyCreator()];
    try {
      // Both processes import the modules before either opens the shared database or creates a key.
      assert.deepEqual(await Promise.all(creators.map((creator) => creator.ready)), ['ready', 'ready']);
      for (const { child } of creators) child.send('start');
      const results = await Promise.all(creators.map((creator) => creator.completed));
      for (const result of results) {
        assert.ifError(result.spawnError);
        assert.equal(result.signal, null, result.stderr);
        assert.equal(result.code, 0, result.stderr);
        assert.match(result.stdout, /^[0-9a-f]{64}$/);
      }
      assert.equal(results[0].stdout, results[1].stdout);
      openDatabase(dbPath);
      const key = getMasterKey();
      assert.equal(key.toString('hex'), results[0].stdout);
      assert.equal(storedFingerprint(), fingerprint(key));
      assert.equal(JSON.parse(readFileSync(keyPath, 'utf8')).key, key.toString('base64'));
    } finally {
      for (const { child } of creators) {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }
      await Promise.all(creators.map((creator) => creator.completed));
    }
  });
});
