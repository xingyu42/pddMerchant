import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { property, gen } from './_harness.js';
import {
  encryptCredential,
  decryptCredential,
  resolveMasterPassword,
  hasEncryptedCredential,
} from '../../src/infra/credential-vault.js';

const genPassword = gen.string({ minLen: 4, maxLen: 20 });
const genSlug = gen.string({ minLen: 1, maxLen: 16, chars: 'abcdefghijklmnopqrstuvwxyz0123456789-_' });
const genMobile = gen.string({ minLen: 8, maxLen: 15, chars: '0123456789' });

const genPayload = (rng) => ({
  version: 1,
  mobile: genMobile(rng),
  password: genPassword(rng),
  createdAt: '2026-05-03T00:00:00Z',
});

describe('credential-vault PBT', () => {
  it('round-trip: decrypt(encrypt(payload)) === payload', async () => {
    await property(
      'round-trip',
      gen.tuple(genPayload, genPassword, genSlug),
      async ([payload, pwd, slug]) => {
        const envelope = await encryptCredential(payload, pwd, { accountSlug: slug });
        const recovered = await decryptCredential(envelope, pwd, { accountSlug: slug });
        assert.deepStrictEqual(recovered, payload);
      },
      { runs: 20 },
    );
  });

  it('wrong key rejection', async () => {
    await property(
      'wrong-key-rejection',
      gen.tuple(genPayload, genPassword, genPassword, genSlug),
      async ([payload, correctPwd, wrongPwd, slug]) => {
        if (correctPwd === wrongPwd) return;
        const envelope = await encryptCredential(payload, correctPwd, { accountSlug: slug });
        await assert.rejects(
          () => decryptCredential(envelope, wrongPwd, { accountSlug: slug }),
          (err) => err.code === 'E_CREDENTIAL_DECRYPT_FAILED',
        );
      },
      { runs: 20 },
    );
  });

  it('AAD binding: mismatched slug rejects', async () => {
    await property(
      'aad-binding',
      gen.tuple(genPayload, genPassword, genSlug, genSlug),
      async ([payload, pwd, slugA, slugB]) => {
        if (slugA === slugB) return;
        const envelope = await encryptCredential(payload, pwd, { accountSlug: slugA });
        await assert.rejects(
          () => decryptCredential(envelope, pwd, { accountSlug: slugB }),
          (err) => err.code === 'E_CREDENTIAL_DECRYPT_FAILED',
        );
      },
      { runs: 20 },
    );
  });

  it('no plaintext leak in encrypted envelope', async () => {
    await property(
      'no-plaintext-leak',
      gen.tuple(genPayload, genPassword, genSlug),
      async ([payload, pwd, slug]) => {
        const envelope = await encryptCredential(payload, pwd, { accountSlug: slug });
        const serialized = JSON.stringify(envelope);
        if (payload.password.length >= 4) {
          assert.ok(!serialized.includes(payload.password), 'password leaked in envelope');
        }
        if (payload.mobile.length >= 4) {
          assert.ok(!serialized.includes(payload.mobile), 'mobile leaked in envelope');
        }
      },
      { runs: 20 },
    );
  });

  it('salt/IV uniqueness across repeated encryptions', async () => {
    await property(
      'salt-iv-uniqueness',
      gen.tuple(genPayload, genPassword, genSlug),
      async ([payload, pwd, slug]) => {
        const a = await encryptCredential(payload, pwd, { accountSlug: slug });
        const b = await encryptCredential(payload, pwd, { accountSlug: slug });
        assert.notEqual(a.salt, b.salt, 'salt reused');
        assert.notEqual(a.iv, b.iv, 'iv reused');
      },
      { runs: 10 },
    );
  });
});

describe('resolveMasterPassword', () => {
  it('returns value when env var is set', () => {
    assert.equal(resolveMasterPassword({ env: { PDD_MASTER_PASSWORD: 'my-key' } }), 'my-key');
  });

  it('returns null when env var is unset', () => {
    assert.equal(resolveMasterPassword({ env: {} }), null);
  });

  it('returns null when env var is empty string', () => {
    assert.equal(resolveMasterPassword({ env: { PDD_MASTER_PASSWORD: '' } }), null);
  });
});

describe('hasEncryptedCredential', () => {
  it('returns true for encrypted credential', () => {
    assert.ok(hasEncryptedCredential({ credential: { kind: 'encrypted-credential' } }));
  });

  it('returns false for null credential', () => {
    assert.ok(!hasEncryptedCredential({ credential: null }));
  });

  it('returns false for missing account', () => {
    assert.ok(!hasEncryptedCredential(null));
  });
});
