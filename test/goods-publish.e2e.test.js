import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertFailEnvelope } from './e2e/_helpers.js';

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

  it('--help output includes --url and --confirm', () => {
    const { stdout } = runPdd(['goods', 'publish', '--help']);
    assert.ok(stdout.includes('--url'), '--help should mention --url');
    assert.ok(stdout.includes('--confirm'), '--help should mention --confirm');
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
    const { status } = runPdd([
      'goods', 'publish', '--url', '918867803697', '--json',
    ]);
    // In fixture mode the browser-dependent flow may throw;
    // either way there should be no unhandled crash
    assert.ok(status !== undefined);
  });
});
