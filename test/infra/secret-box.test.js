import { afterEach, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openDatabase } from '../../src/infra/db.js';
import { aad, open, seal } from '../../src/infra/secret-box.js';
import { secretDecryptFailed } from '../../src/infra/errors.js';

let root;
const PLAINTEXT = {
  cookies: [{ name: 'synthetic_session', value: 'synthetic-cookie-secret-123456789' }],
  origins: [{ origin: 'https://synthetic.invalid', localStorage: [{ name: 'token', value: 'synthetic-local-token-987654321' }] }],
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdd-secret-box-test-'));
  openDatabase(join(root, 'pdd.db'));
});

afterEach(() => {
  try {
    closeDatabase();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function tamper(sealed, field) {
  const envelope = JSON.parse(sealed);
  const bytes = Buffer.from(envelope[field], 'base64');
  bytes[0] ^= 0xff;
  envelope[field] = bytes.toString('base64');
  return JSON.stringify(envelope);
}

describe('secret box', () => {
  it('explains account removal before re-login and accepts safe account detail', () => {
    const detail = { slug: 'synthetic-shop', kind: 'merchant' };
    const error = secretDecryptFailed(detail);
    assert.equal(error.code, 'E_SECRET_DECRYPT_FAILED');
    assert.equal(error.exitCode, 3);
    assert.match(error.hint, /恢复原主密钥文件/);
    assert.match(error.hint, /先执行 pdd account remove --slug <slug> 再重新登录/);
    assert.deepEqual(error.detail, detail);
    assert.equal(secretDecryptFailed().detail, null);
  });

  it('round-trips structured JSON through a versioned AES-GCM envelope', () => {
    const additionalData = aad('auth_states', 42);
    const sealed = seal(PLAINTEXT, additionalData);
    const envelope = JSON.parse(sealed);
    assert.deepEqual(Object.keys(envelope).sort(), ['ct', 'iv', 'tag', 'v']);
    assert.equal(envelope.v, 1);
    assert.equal(Buffer.from(envelope.iv, 'base64').length, 12);
    assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
    assert.deepEqual(open(sealed, additionalData), PLAINTEXT);
    assert.equal(sealed.includes(PLAINTEXT.cookies[0].value), false);
    assert.equal(sealed.includes(PLAINTEXT.origins[0].localStorage[0].value), false);
  });

  it.each(['ct', 'tag', 'iv'])('rejects tampering with %s even when base64 and length remain valid', (field) => {
    const additionalData = aad('auth_states', 42);
    const sealed = seal(PLAINTEXT, additionalData);
    assert.throws(() => open(tamper(sealed, field), additionalData), { code: 'E_SECRET_DECRYPT_FAILED', exitCode: 3 });
  });

  it('rejects AAD bound to another table or account', () => {
    const sealed = seal(PLAINTEXT, aad('auth_states', 42));
    for (const wrongAad of [aad('credentials', 42), aad('auth_states', 43)]) {
      assert.throws(() => open(sealed, wrongAad), { code: 'E_SECRET_DECRYPT_FAILED', exitCode: 3 });
    }
  });

  it('excludes plaintext and ciphertext fragments from serialized decryption errors', () => {
    const additionalData = aad('auth_states', 42);
    const sealed = seal(PLAINTEXT, additionalData);
    const damaged = tamper(sealed, 'ct');
    assert.throws(() => open(damaged, additionalData), (error) => {
      assert.equal(error.code, 'E_SECRET_DECRYPT_FAILED');
      const serialized = JSON.stringify(error);
      const secrets = [
        PLAINTEXT.cookies[0].value, PLAINTEXT.origins[0].localStorage[0].value,
        ...[sealed, damaged].flatMap((value) => {
          const envelope = JSON.parse(value);
          return [envelope.ct, envelope.ct.slice(0, 16), envelope.ct.slice(-16), envelope.tag, envelope.iv];
        }),
      ];
      for (const secret of secrets) assert.equal(serialized.includes(secret), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  });

  it('formats AAD using the version, table, and immutable account id', () => {
    assert.equal(aad('auth_states', 42), 'pdd-cli:v1:auth_states:42');
    assert.equal(aad('credentials', 7), 'pdd-cli:v1:credentials:7');
  });
});
