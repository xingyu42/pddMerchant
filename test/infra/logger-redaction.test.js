import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it, vi } from 'vitest';
import { SECRET_KEYS, REDACT_KEYS, redactRecursive, createLogger } from '../../src/infra/logger.js';
import { emit as emitEnvelope, buildEnvelope } from '../../src/infra/output.js';

const secret = 'synthetic-private-value-103984';
const fingerprint = 'fp:' + createHash('sha256').update(secret).digest('hex').slice(0, 8);

it.each(SECRET_KEYS)('redacts %s in objects, nested arrays, Maps and errors without fingerprints', (key) => {
  assert.ok(REDACT_KEYS.includes(key));
  const error = Object.assign(new Error('safe message'), { [key]: secret });
  const result = redactRecursive({ [key]: secret, nested: [{ [key]: secret }], map: new Map([[key, secret]]), err: error });
  assert.equal(result[key], '[REDACTED]');
  assert.equal(result.nested[0][key], '[REDACTED]');
  assert.equal(result.map.get(key), '[REDACTED]');
  assert.equal(result.err[key], '[REDACTED]');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(fingerprint), false);
});

it.each(SECRET_KEYS)('redacts every value type for %s', (key) => {
  const circular = {};
  circular.self = circular;
  for (const value of [null, undefined, 0, false, 1n, Symbol('private'), () => secret, circular, { nested: secret }, new Map([['value', secret]])]) {
    assert.equal(redactRecursive({ [key]: value })[key], '[REDACTED]');
    assert.equal(redactRecursive(new Map([[key, value]])).get(key), '[REDACTED]');
  }
});

it('keeps fingerprint behavior for other keys and serializes logger errors safely', () => {
  const chunks = [];
  const logger = createLogger({ destination: { write: (chunk) => chunks.push(chunk) } });
  const secrets = Object.fromEntries(SECRET_KEYS.map((key) => [key, secret]));
  logger.info({ ...secrets, nested: secrets, err: Object.assign(new Error('safe'), secrets), cookies: secret });
  const output = chunks.join('');
  const logged = JSON.parse(output);
  for (const key of SECRET_KEYS) {
    assert.equal(logged[key], '[REDACTED]');
    assert.equal(logged.nested[key], '[REDACTED]');
    assert.equal(logged.err[key], '[REDACTED]');
  }
  assert.equal(logged.cookies, fingerprint);
  assert.equal(output.includes(secret), false);
  assert.deepEqual(redactRecursive({ cookies: null, authorization: 'fp:existing' }), { cookies: null, authorization: 'fp:existing' });
});

it('uses fixed secret markers in PDD_DEBUG_RAW stderr and JSON output', () => {
  vi.stubEnv('PDD_DEBUG_RAW', '1');
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const secrets = Object.fromEntries(SECRET_KEYS.map((key) => [key, secret]));
  emitEnvelope(buildEnvelope({ command: 'synthetic', data: { ...secrets, raw: secrets } }), { json: true });
  for (const stream of [stderr, stdout]) {
    const output = stream.mock.calls.map(([chunk]) => chunk).join('');
    assert.ok(output.includes('[REDACTED]'));
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes(fingerprint), false);
  }
});
