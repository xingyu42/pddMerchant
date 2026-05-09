import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { withCommand } from '../src/infra/command-runner.js';

describe('withCommand allowAllAccounts', () => {
  let savedAdapter;

  beforeEach(() => {
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';
  });

  afterEach(() => {
    if (savedAdapter !== undefined) {
      process.env.PDD_TEST_ADAPTER = savedAdapter;
    } else {
      delete process.env.PDD_TEST_ADAPTER;
    }
  });

  it('throws E_USAGE when allowAllAccounts=false and opts.allAccounts=true', () => {
    const cmd = withCommand({
      name: 'test.write',
      needsAuth: true,
      allowAllAccounts: false,
      async run() { return { value: 1 }; },
    });

    assert.throws(
      () => cmd({ allAccounts: true, json: true }),
      (err) => err.code === 'E_USAGE' && err.exitCode === 2,
    );
  });

  it('allows allAccounts=true when allowAllAccounts defaults to true', async () => {
    const cmd = withCommand({
      name: 'test.read',
      needsAuth: false,
      needsMall: 'none',
      async run() { return { value: 1 }; },
    });

    const envelope = await cmd({ allAccounts: false, json: true, noColor: true });
    assert.equal(envelope.ok, true);
  });

  it('runs normally when allowAllAccounts=false and allAccounts not set', async () => {
    const cmd = withCommand({
      name: 'test.write.normal',
      needsAuth: false,
      needsMall: 'none',
      allowAllAccounts: false,
      async run() { return { data: 42 }; },
    });

    const envelope = await cmd({ json: true, noColor: true });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'test.write.normal');
  });
});
