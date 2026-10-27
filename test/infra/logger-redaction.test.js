import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { it, vi } from 'vitest';
import { SECRET_KEYS, REDACT_KEYS, redactRecursive, createLogger, DailyRotatingFileDestination, resolveDefaultLogDirectory } from '../../src/infra/logger.js';
import { CLI_LOG_DIR, DAEMON_LOG_DIR, LOG_DIR } from '../../src/infra/paths.js';
import { getDatabasePath } from '../../src/infra/db.js';
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

it.each(['consoleToken', 'consoleSession'])('registers console secret key %s with fixed redaction', (key) => {
  assert.ok(SECRET_KEYS.includes(key));
  assert.equal(redactRecursive({ [key]: secret })[key], '[REDACTED]');
});

it.each(['qrImage', 'frameJpeg'])('fingerprints console media key %s in logs and envelopes', (key) => {
  assert.ok(REDACT_KEYS.includes(key));
  assert.equal(redactRecursive({ nested: [{ [key]: secret }] }).nested[0][key], fingerprint);
  const chunks = [];
  const logger = createLogger({ destination: { write: (chunk) => chunks.push(chunk) } });
  logger.info({ [key]: secret });
  assert.equal(JSON.parse(chunks.join(''))[key], fingerprint);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  emitEnvelope(buildEnvelope({ ok: true, command: 'test', data: { [key]: secret } }), { json: true });
  assert.equal(JSON.parse(stdout.mock.calls.at(-1)[0]).data[key], fingerprint);
});

it('preserves batch account entries keyed by console-like slugs', () => {
  const accounts = Object.fromEntries(['token', 'session', 'jpeg', 'qr_image', 'pdd_console'].map((slug) => [
    slug, { ok: true, data: { headline: [slug], items: [{ id: 1 }] } },
  ]));
  const data = { accounts };
  assert.deepEqual(redactRecursive(data), data);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  emitEnvelope(buildEnvelope({ ok: true, command: 'test', data }), { json: true });
  assert.deepEqual(JSON.parse(stdout.mock.calls.at(-1)[0]).data, data);
});

it('routes the daemon channel to its own daily destination without requiring runtime config', () => {
  assert.equal(DAEMON_LOG_DIR, join(LOG_DIR, 'daemon'));
  assert.equal(resolveDefaultLogDirectory({ channel: 'daemon' }), DAEMON_LOG_DIR);
  assert.equal(resolveDefaultLogDirectory({ channel: 'daemon', config: {} }), DAEMON_LOG_DIR);
  assert.equal(resolveDefaultLogDirectory({ config: {} }), CLI_LOG_DIR);
  assert.equal(resolveDefaultLogDirectory({ channel: 'foreground', config: {} }), null);
  assert.equal(resolveDefaultLogDirectory(), null);
  const destinations = [];
  vi.spyOn(DailyRotatingFileDestination.prototype, 'write').mockImplementation(function (chunk) {
    destinations.push(this.logDirectory);
    assert.equal(JSON.parse(chunk).consoleToken, '[REDACTED]');
  });
  createLogger({ channel: 'daemon' }).info({ consoleToken: secret });
  assert.deepEqual(destinations, [DAEMON_LOG_DIR]);
});

it('rotates redacted daemon log files across local midnight while retaining history', () => {
  let now = new Date(2026, 9, 27, 23, 59, 59);
  const directory = join(dirname(getDatabasePath()), 'log', 'daemon');
  const destination = new DailyRotatingFileDestination(directory, { now: () => now });
  const logger = createLogger({ channel: 'daemon', destination });
  try {
    logger.info({ consoleToken: secret, consoleSession: secret }, 'before midnight');
    destination.flushSync();
    now = new Date(2026, 9, 28, 0, 0, 0);
    logger.info({ qrImage: secret, frameJpeg: secret }, 'after midnight');
    destination.flushSync();
    const first = JSON.parse(readFileSync(join(directory, '2026-10-27.log'), 'utf8'));
    const second = JSON.parse(readFileSync(join(directory, '2026-10-28.log'), 'utf8'));
    assert.equal(first.consoleToken, '[REDACTED]');
    assert.equal(first.consoleSession, '[REDACTED]');
    assert.equal(second.qrImage, fingerprint);
    assert.equal(second.frameJpeg, fingerprint);
    assert.equal(JSON.stringify([first, second]).includes(secret), false);
  } finally {
    destination.end();
  }
});
