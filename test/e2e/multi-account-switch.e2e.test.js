import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: --account flag passes through to command context', () => {
  const { status, envelope } = runPdd(['shops', 'current', '--json', '--account', 'default']);
  assert.equal(status, 0, `exit=${status}`);
  assertOkEnvelope(envelope, 'shops.current');
});

test('e2e: --account with unknown slug still runs (fixture mode)', () => {
  const { envelope } = runPdd(['shops', 'current', '--json', '--account', 'nonexistent']);
  assert.ok(envelope);
});
