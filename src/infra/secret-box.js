import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { getMasterKey } from './master-key.js';
import { secretDecryptFailed } from './errors.js';

export function aad(table, id) {
  return `pdd-cli:v1:${table}:${id}`;
}

export function seal(obj, additionalData) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getMasterKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(additionalData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  });
}

function decodeEnvelope(sealed) {
  const envelope = JSON.parse(sealed);
  if (envelope.v !== 1) throw secretDecryptFailed();
  const decoded = {};
  for (const field of ['iv', 'tag', 'ct']) {
    decoded[field] = Buffer.from(envelope[field], 'base64');
    if (decoded[field].toString('base64') !== envelope[field]) throw secretDecryptFailed();
  }
  if (decoded.iv.length !== 12 || decoded.tag.length !== 16) throw secretDecryptFailed();
  return decoded;
}

export function open(sealed, additionalData) {
  const key = getMasterKey();
  try {
    const envelope = decodeEnvelope(sealed);
    const decipher = createDecipheriv('aes-256-gcm', key, envelope.iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(additionalData));
    decipher.setAuthTag(envelope.tag);
    const plaintext = Buffer.concat([decipher.update(envelope.ct), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw secretDecryptFailed();
  }
}
