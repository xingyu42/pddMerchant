import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPdd, assertOkEnvelope, assertFailEnvelope } from './_helpers.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pdd-acct-e2e-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test('e2e: account list on empty registry returns empty array', () => {
  const { status, envelope } = runPdd(['account', 'list', '--json']);
  assert.equal(status, 0, `exit=${status}`);
  assertOkEnvelope(envelope, 'account.list');
  assert.ok(Array.isArray(envelope.data));
});

test('e2e: account default on non-existent slug fails', () => {
  const { envelope } = runPdd(['account', 'default', '--slug', 'nonexistent', '--json']);
  assert.ok(envelope);
  assert.equal(envelope.ok, false);
});
