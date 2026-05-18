import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope, assertFailEnvelope } from './_helpers.js';

test('e2e: login --consumer --qr --json returns ok envelope in mock mode', () => {
  const { status, envelope, stderr } = runPdd(['login', '--consumer', '--qr', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'login.consumer');
  assert.equal(envelope.data.mode, 'qr');
  assert.ok(envelope.data.path.includes('consumer-auth-state'));
  assert.ok(envelope.data.message.includes('消费端'));
});

test('e2e: login --consumer --json returns ok envelope in mock mode (headed fallback)', () => {
  const { status, envelope, stderr } = runPdd(['login', '--consumer', '--json']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'login.consumer');
  assert.equal(envelope.data.mode, 'headed');
  assert.ok(envelope.data.path.includes('consumer-auth-state'));
});

test('e2e: login --consumer --password --json returns E_USAGE', () => {
  const { status, envelope } = runPdd(['login', '--consumer', '--password', '--json']);
  assert.notEqual(status, 0);
  assertFailEnvelope(envelope, 'login.consumer', 'E_USAGE');
  assert.ok(envelope.error.message.includes('消费端'));
});
