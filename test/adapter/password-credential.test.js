import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, it } from 'vitest';
import { insertAccount, getCredential, putCredential, getReloginState } from '../../src/infra/account-store.js';
import { run, getDatabasePath } from '../../src/infra/db.js';
import { aad, open, seal } from '../../src/infra/secret-box.js';
import { PddCliError } from '../../src/infra/errors.js';
import { savePasswordCredential, loadPasswordCredential, hasPasswordCredential, deletePasswordCredential } from '../../src/adapter/password-credential.js';
import { seedDb } from '../helpers/seed-db.js';

const credential = { loginName: 'synthetic-login-182649', password: 'synthetic-password-183749' };
let account;
beforeEach(() => { account = insertAccount({ identity: '1', displayName: 'Shop' }); });

function safeError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PddCliError);
    assert.equal(error.code, code);
    const output = `${error.message} ${error.hint} ${JSON.stringify(error.detail)} ${error.stack}`;
    for (const value of Object.values(credential)) assert.equal(output.includes(value), false);
    assert.equal(error.cause, undefined);
    return true;
  });
}

it('round trips versioned credentials without plaintext in the database or WAL', () => {
  assert.equal(loadPasswordCredential(account.id), null);
  savePasswordCredential(account.id, credential);
  assert.deepEqual(loadPasswordCredential(account.id), credential);
  const row = getCredential(account.id);
  assert.deepEqual(open(row.password_sealed, aad('credentials', account.id)), { v: 1, login_name: credential.loginName, password: credential.password });
  for (const path of [getDatabasePath(), `${getDatabasePath()}-wal`]) {
    for (const value of Object.values(credential)) assert.equal(readFileSync(path).includes(Buffer.from(value)), false);
  }
});

it('binds AAD to the account id when copying ciphertext', () => {
  const other = insertAccount({ identity: '2', displayName: 'Other' });
  savePasswordCredential(account.id, credential);
  putCredential(other.id, getCredential(account.id).password_sealed);
  assert.throws(() => loadPasswordCredential(other.id), (error) => {
    assert.equal(error.code, 'E_SECRET_DECRYPT_FAILED');
    assert.deepEqual(error.detail, { slug: other.slug, kind: 'merchant', table: 'credentials' });
    return true;
  });
});

it.each(['iv', 'tag', 'ct'])('rejects tampered %s with safe account detail', (field) => {
  savePasswordCredential(account.id, credential);
  const sealed = JSON.parse(getCredential(account.id).password_sealed);
  const bytes = Buffer.from(sealed[field], 'base64');
  bytes[0] ^= 255;
  sealed[field] = bytes.toString('base64');
  putCredential(account.id, JSON.stringify(sealed));
  safeError(() => loadPasswordCredential(account.id), 'E_SECRET_DECRYPT_FAILED');
  assert.equal(hasPasswordCredential(account.id), true);
});

it.each([null, {}, { v: 2 }, { v: 1, login_name: 1, password: 'safe' }])('rejects invalid decrypted credential shape %#', (value) => {
  putCredential(account.id, seal(value, aad('credentials', account.id)));
  safeError(() => loadPasswordCredential(account.id), 'E_SECRET_DECRYPT_FAILED');
});

it.each(['loginName', 'password'])('validates %s without including the submitted value', (field) => {
  for (const value of ['', ' ', null, undefined, 1, {}, 'private'.repeat(20)]) {
    safeError(() => savePasswordCredential(account.id, { ...credential, [field]: value }), 'E_USAGE');
    assert.equal(getCredential(account.id), null);
  }
  savePasswordCredential(account.id, { ...credential, [field]: 'x'.repeat(128) });
  assert.equal(loadPasswordCredential(account.id)[field].length, 128);
});

it('rejects missing or consumer accounts across credential APIs without input values', () => {
  const consumer = insertAccount({ kind: 'consumer', identity: '2', displayName: 'Consumer' });
  for (const accountId of [9999, consumer.id]) {
    for (const callback of [() => savePasswordCredential(accountId, credential), () => loadPasswordCredential(accountId),
      () => hasPasswordCredential(accountId), () => deletePasswordCredential(accountId)]) safeError(callback, 'E_ACCOUNT_NOT_FOUND');
  }
});

it('checks presence without decrypting and deletes idempotently', () => {
  assert.equal(hasPasswordCredential(account.id), false);
  assert.equal(deletePasswordCredential(account.id), false);
  putCredential(account.id, 'invalid synthetic ciphertext');
  assert.equal(hasPasswordCredential(account.id), true);
  assert.equal(deletePasswordCredential(account.id), true);
  assert.equal(deletePasswordCredential(account.id), false);
  assert.equal(loadPasswordCredential(account.id), null);
});

it('wraps native failures into a fixed PddCliError', () => {
  const unsafe = { get loginName() { throw new Error(credential.loginName); } };
  safeError(() => savePasswordCredential(account.id, unsafe), 'E_AUTH_ACCOUNT_SAVE_FAILED');
  run(`CREATE TRIGGER reject_credential BEFORE INSERT ON credentials
    BEGIN SELECT RAISE(ABORT, '${credential.password}'); END`);
  safeError(() => savePasswordCredential(account.id, credential), 'E_AUTH_ACCOUNT_SAVE_FAILED');
});

it('seeds credentials and optional relogin states through the shared helper', () => {
  seedDb(getDatabasePath(), { accounts: [{ slug: 'seeded', identity: '3' }],
    passwordCredentials: [{ slug: 'seeded', ...credential }],
    reloginStates: [{ slug: 'seeded', status: 'blocked', reason: 'wrong_password' }] });
  assert.deepEqual(loadPasswordCredential(2), credential);
  assert.equal(getReloginState(2).status, 'blocked');
  assert.equal(getReloginState(2).reason, 'wrong_password');
});
