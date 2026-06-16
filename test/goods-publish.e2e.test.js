import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { PROJECT_ROOT, runPdd, assertOkEnvelope, assertFailEnvelope } from './e2e/_helpers.js';

const EMPTY_TEMPLATE_FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'goods-publish-empty-template');
const SUBMIT_ERROR_FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'goods-publish-submit-error');

// E2E tests for `goods publish` command.
// Fixture adapter is used (PDD_TEST_ADAPTER=fixture) via runPdd().
// Full pipeline requires a real browser context that is not available in
// fixture mode, so these tests cover CLI argument parsing and error-path
// envelope shape only.

describe('goods publish — CLI argument validation', () => {
  it('missing --url exits with E_USAGE envelope', () => {
    const { status } = runPdd(['goods', 'publish', '--json']);
    assert.notEqual(status, 0, 'should fail without --url');
  });

  it('--help output includes --url, --confirm, and --cost-template', () => {
    const { stdout } = runPdd(['goods', 'publish', '--help']);
    assert.ok(stdout.includes('--url'), '--help should mention --url');
    assert.ok(stdout.includes('--confirm'), '--help should mention --confirm');
    assert.ok(stdout.includes('--cost-template'), '--help should mention --cost-template');
  });

  it('invalid URL value exits non-zero', () => {
    const { status } = runPdd([
      'goods', 'publish', '--url', 'not-a-valid-thing', '--json',
    ]);
    assert.notEqual(status, 0, 'invalid URL should fail');
  });

  it('invalid URL with --json returns E_USAGE envelope', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', 'not-a-valid-thing', '--json',
    ]);
    if (envelope) {
      assertFailEnvelope(envelope, 'goods.publish', 'E_USAGE');
    } else {
      assert.notEqual(status, 0);
    }
  });

  it('numeric --url creates draft (default mode)', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--json',
    ]);
    assert.equal(status, 0);
    assertOkEnvelope(envelope, 'goods.publish');
    assert.equal(envelope.data.status, 'draft');
    assert.equal(envelope.data.cost_template_id, 544142245494784);
    assert.equal(envelope.meta.cost_template_id, 544142245494784);
  });

  it('--confirm submits in fixture mode', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--confirm', '--json',
    ]);
    assert.equal(status, 0);
    assertOkEnvelope(envelope, 'goods.publish');
    assert.equal(envelope.data.status, 'submitted');
    assert.equal(envelope.meta.status, 'submitted');
    assert.deepEqual(envelope.data.submit, { success: true });
  });

  it('--cost-template is accepted and reflected in the envelope', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--cost-template', '544142245494784', '--json',
    ]);
    assert.equal(status, 0);
    assertOkEnvelope(envelope, 'goods.publish');
    assert.equal(envelope.data.cost_template_id, 544142245494784);
    assert.equal(envelope.meta.cost_template_id, 544142245494784);
  });

  it('--all-accounts is rejected for publish writes', () => {
    const { status, envelope } = runPdd([
      '--all-accounts', 'goods', 'publish', '--url', '918867803697', '--json',
    ]);
    assert.notEqual(status, 0);
    assertFailEnvelope(envelope, 'goods.publish', 'E_USAGE');
  });

  it('unavailable --cost-template returns E_USAGE', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--cost-template', '999', '--json',
    ]);
    assert.notEqual(status, 0);
    assertFailEnvelope(envelope, 'goods.publish', 'E_USAGE');
  });

  it('empty cost-template list returns E_BUSINESS', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--json',
    ], { PDD_TEST_FIXTURE_DIR: EMPTY_TEMPLATE_FIXTURE_DIR });
    assert.notEqual(status, 0);
    assertFailEnvelope(envelope, 'goods.publish', 'E_BUSINESS');
  });

  it('submit business error returns mapped envelope', () => {
    const { status, envelope } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--confirm', '--json',
    ], { PDD_TEST_FIXTURE_DIR: SUBMIT_ERROR_FIXTURE_DIR });
    assert.notEqual(status, 0);
    assertFailEnvelope(envelope, 'goods.publish', 'E_BUSINESS');
  });
});
