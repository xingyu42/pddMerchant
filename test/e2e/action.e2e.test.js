import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope } from './_helpers.js';

test('e2e: action plan --json returns action plan envelope', () => {
  const { status, envelope, stderr } = runPdd(['action', 'plan', '--json', '--no-promo', '--no-segment']);
  assert.equal(status, 0, `stderr: ${stderr}`);
  assertOkEnvelope(envelope, 'action.plan');
  const d = envelope.data;
  assert.ok(typeof d.summary === 'object');
  assert.ok(Array.isArray(d.actions));
  assert.equal(d.summary.urgent + d.summary.important + d.summary.suggestion, d.summary.total);
  assert.ok(typeof d.data_completeness === 'object');
  assert.ok(typeof d.generated_at === 'string');
  assert.ok(!Number.isNaN(Date.parse(d.generated_at)));
});

test('e2e: action plan --limit 3 --json respects limit', () => {
  const { status, envelope } = runPdd(['action', 'plan', '--json', '--limit', '3', '--no-promo', '--no-segment']);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'action.plan');
  assert.ok(envelope.data.actions.length <= 3);
});
