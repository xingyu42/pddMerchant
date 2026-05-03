import { randomBytes, scrypt, createCipheriv, createDecipheriv } from 'node:crypto';
import { credentialDecryptFailed } from './errors.js';

const CIPHER = 'aes-256-gcm';
const KDF = 'scrypt';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 67108864;
const AAD_PREFIX = 'pdd-cli:credential:v1:';

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function encryptCredential(payload, masterPassword, { accountSlug }) {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const aad = Buffer.from(AAD_PREFIX + accountSlug, 'utf8');

  const key = await deriveKey(masterPassword, salt);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad);

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kind: 'encrypted-credential',
    cipher: CIPHER,
    kdf: KDF,
    kdfParams: { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    aad: AAD_PREFIX + accountSlug,
    ciphertext: encrypted.toString('base64'),
  };
}

export async function decryptCredential(envelope, masterPassword, { accountSlug }) {
  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    const aad = Buffer.from(AAD_PREFIX + accountSlug, 'utf8');

    const key = await deriveKey(masterPassword, salt);
    const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    decipher.setAAD(aad);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    throw credentialDecryptFailed();
  }
}

export function resolveMasterPassword({ env = process.env } = {}) {
  const val = env.PDD_MASTER_PASSWORD;
  if (val && val.length > 0) return val;
  return null;
}

export function hasEncryptedCredential(account) {
  return account?.credential != null && typeof account.credential === 'object' && account.credential.kind === 'encrypted-credential';
}
