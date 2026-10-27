import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { createCliSandbox, runCli } from '../helpers/isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { closeDatabase, get, getDatabasePath, openDatabase, run } from '../../src/infra/db.js';
import { loadAuthState } from '../../src/adapter/auth-state.js';
import { createLogger } from '../../src/infra/logger.js';
import { putCredential, putReloginState, insertPendingAction } from '../../src/infra/account-store.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const childPath = fileURLToPath(new URL('../helpers/auth-commit-child.js', import.meta.url));
const preloadPath = new URL('../helpers/offline-preload.js', import.meta.url).href;

function startCommitter(env) {
  const child = fork(childPath, ['1'], { env, silent: true, execArgv: ['--import', preloadPath] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('message', (message) => message.ready ? resolve() : reject(new Error('child setup failed')));
    child.once('exit', () => reject(new Error('child exited before ready')));
  });
  const result = new Promise((resolve, reject) => {
    let code;
    child.on('message', (message) => { if (message.code) code = message.code; });
    child.once('error', reject);
    child.once('exit', (status) => status === 0 && code ? resolve({ code, output }) : reject(new Error('child commit failed')));
  });
  return { child, ready, result };
}

it('two processes commit the same snapshot: one succeeds and one conflicts, leaving readable state', async () => {
  const sandbox = createCliSandbox();
  const previous = getDatabasePath();
  const committers = [];
  try {
    seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT] });
    committers.push(startCommitter(sandbox.env), startCommitter(sandbox.env));
    await Promise.all(committers.map((committer) => committer.ready));
    for (const committer of committers) committer.child.send('commit');
    const results = await Promise.all(committers.map((committer) => committer.result));
    assert.deepEqual(results.map((result) => result.code).sort(), ['E_AUTH_STATE_CONFLICT', 'OK']);
    openDatabase(sandbox.env.PDD_DB_PATH);
    assert.equal(get('PRAGMA integrity_check').integrity_check, 'ok');
    assert.equal(loadAuthState(1).revision, 1);
    assert.equal(loadAuthState(1).state.merchant_auth.mall_id, '900001');
    assert.equal(get('SELECT count(*) AS total FROM leases').total, 0);
  } finally {
    for (const committer of committers) committer.child.kill();
    closeDatabase();
    sandbox.dispose();
    openDatabase(previous);
  }
});

it('sealed cookies stay out of database bytes, command output and diagnostic logs', () => {
  const sandbox = createCliSandbox();
  const previous = getDatabasePath();
  const secret = 'SYNTHETIC-COOKIE-LEAK-ACCEPTANCE-29c84';
  try {
    seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT], authStates: [{ slug: DEFAULT_ACCOUNT.slug,
      state: { cookies: [{ name: 'PASS_ID', value: secret }], origins: [] } }] });
    assert.equal(readFileSync(sandbox.env.PDD_DB_PATH).includes(Buffer.from(secret)), false);
    openDatabase(sandbox.env.PDD_DB_PATH);
    const sealed = get('SELECT state_sealed FROM auth_states WHERE account_id = 1').state_sealed;
    const materials = Object.values(JSON.parse(sealed)).filter((value) => typeof value === 'string');
    const logs = [];
    const log = createLogger({ level: 'debug', destination: { write: (chunk) => logs.push(String(chunk)) } });
    log.info({ cookie: secret, state_sealed: sealed, ...JSON.parse(sealed) }, 'synthetic diagnostic');
    const result = spawnSync(process.execPath, ['--import', preloadPath, join(projectRoot, 'bin/pdd.js'), 'doctor', '--json'],
      { cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    const output = result.stdout + result.stderr + logs.join('');
    for (const sensitive of [secret, sealed, ...materials, sandbox.env.PDD_DB_PATH, join(dirname(sandbox.env.PDD_DB_PATH), 'master.key')]) {
      assert.equal(output.includes(sensitive), false, 'sensitive storage material must remain private');
    }
    assert.ok(!result.stdout.includes('state_sealed'));
  } finally {
    closeDatabase();
    sandbox.dispose();
    openDatabase(previous);
  }
});

it('requires login when no merchant account exists and ignores retired path environment overrides', () => {
  const result = runCli(['orders', 'list'], { accounts: [] });
  assert.equal(result.envelope.error.code, 'E_AUTH_EXPIRED');
  assert.equal(result.status, 3);
  assert.ok(result.envelope.error.hint.includes('pdd login'));
});

it('reports a low Node major before importing the SQLite driver', () => {
  const sandbox = createCliSandbox();
  try {
    const entry = new URL('../../bin/pdd.js', import.meta.url).href;
    const script = `import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === 'node:sqlite') throw new Error('driver loaded before version guard');
        return nextResolve(specifier, context);
      } });
      Object.defineProperty(process.versions, 'node', { value: '22.0.0' });
      await import(${JSON.stringify(entry)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: sandbox.env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.equal(envelope.meta.exit_code, 2);
    assert.ok(envelope.error.hint.includes('24'));
    assert.equal(result.stderr, '');
  } finally { sandbox.dispose(); }
});

it('hides the database path when account storage is inaccessible', () => {
  const sandbox = createCliSandbox();
  try {
    const blockedParent = join(sandbox.root, 'synthetic-blocked-parent');
    writeFileSync(blockedParent, 'synthetic');
    const env = { ...sandbox.env, PDD_DB_PATH: join(blockedParent, 'pdd.db') };
    const result = spawnSync(process.execPath, [join(projectRoot, 'bin/pdd.js'), 'account', 'list', '--json'], {
      cwd: projectRoot, env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 3);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    assert.equal(JSON.parse(result.stdout).error.code, 'E_AUTH_ACCOUNT_SAVE_FAILED');
    assert.equal((result.stdout + result.stderr).includes(blockedParent), false);
  } finally { sandbox.dispose(); }
});

it.each([{ flags: [] }, { flags: ['--remove-files'] }])('account removal always cascades with legacy option $flags', ({ flags }) => {
  const sandbox = createCliSandbox();
  const previous = getDatabasePath();
  try {
    seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT],
      authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: { cookies: [], origins: [] } }] });
    openDatabase(sandbox.env.PDD_DB_PATH);
    putCredential(1, 'synthetic-sealed-placeholder');
    putReloginState(1, { status: 'available' });
    insertPendingAction(1, { kind: 'human_verification', reason: 'synthetic' });
    const result = spawnSync(process.execPath, [join(projectRoot, 'bin/pdd.js'), 'account', 'remove',
      '--slug', DEFAULT_ACCOUNT.slug, ...flags, '--json'], { cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).ok, true);
    for (const table of ['accounts', 'auth_states', 'credentials', 'relogin_states', 'pending_actions']) {
      assert.equal(get(`SELECT count(*) AS total FROM ${table}`).total, 0);
    }
  } finally {
    closeDatabase();
    sandbox.dispose();
    openDatabase(previous);
  }
});

it.each(['missing-key', 'damaged-state'])('doctor preserves explicit encrypted storage error for %s', (failure) => {
  const sandbox = createCliSandbox();
  const previous = getDatabasePath();
  try {
    seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT],
      authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: { cookies: [], origins: [] } }] });
    if (failure === 'missing-key') {
      unlinkSync(join(dirname(sandbox.env.PDD_DB_PATH), 'master.key'));
    } else {
      openDatabase(sandbox.env.PDD_DB_PATH);
      run("UPDATE auth_states SET state_sealed = 'synthetic-damaged' WHERE account_id = 1");
      closeDatabase();
    }
    const result = spawnSync(process.execPath, [join(projectRoot, 'bin/pdd.js'), 'doctor', '--json'], {
      cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 3);
    assert.equal(JSON.parse(result.stdout).error.code, failure === 'missing-key' ? 'E_MASTER_KEY_MISSING' : 'E_SECRET_DECRYPT_FAILED');
    assert.equal((result.stdout + result.stderr).includes(sandbox.env.PDD_DB_PATH), false);
  } finally {
    closeDatabase();
    sandbox.dispose();
    openDatabase(previous);
  }
});

it('doctor reports an undecryptable account and continues checking the next merchant account', () => {
  const sandbox = createCliSandbox();
  const previous = getDatabasePath();
  const damaged = { slug: 'damaged-shop', display_name: 'Damaged Shop', identity: '900002' };
  try {
    const accounts = [damaged, DEFAULT_ACCOUNT];
    seedDb(sandbox.env.PDD_DB_PATH, { accounts,
      authStates: accounts.map((account) => ({ slug: account.slug, state: { cookies: [], origins: [] } })) });
    openDatabase(sandbox.env.PDD_DB_PATH);
    const original = get('SELECT state_sealed FROM auth_states WHERE account_id = 1').state_sealed;
    const sealed = JSON.parse(original);
    const ciphertext = Buffer.from(sealed.ct, 'base64');
    ciphertext[0] ^= 1;
    sealed.ct = ciphertext.toString('base64');
    const tampered = JSON.stringify(sealed);
    run('UPDATE auth_states SET state_sealed = ? WHERE account_id = 1', tampered);
    const result = spawnSync(process.execPath, ['--import', preloadPath, join(projectRoot, 'bin/pdd.js'), 'doctor', '--json'],
      { cwd: projectRoot, env: sandbox.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data.accounts.map((account) => account.slug), [damaged.slug, DEFAULT_ACCOUNT.slug]);
    assert.deepEqual(envelope.data.accounts[0].auth_file, { ok: false, detail: { error: '登录态文件无法解密' } });
    assert.equal(envelope.data.accounts[1].auth_file.ok, true);
    for (const material of [original, tampered, sealed.ct, sealed.iv, sealed.tag]) {
      assert.equal((result.stdout + result.stderr).includes(material), false, 'encrypted state must remain private');
    }
  } finally {
    closeDatabase();
    sandbox.dispose();
    openDatabase(previous);
  }
});
