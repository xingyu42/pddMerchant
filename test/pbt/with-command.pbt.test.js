import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { withCommand } from '../../src/infra/command-runner.js';

describe('withCommand PBT', () => {
  it('PROP-WC-1: exactly-once envelope emit regardless of success/throw', async () => {
    const originalEnv = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.boolean(),
          async (shouldThrow) => {
            const cmd = withCommand({
              name: 'test.wc1',
              needsAuth: false,
              needsMall: 'none',
              async run() {
                if (shouldThrow) throw new Error('test throw');
                return { value: 42 };
              },
            });

            const envelope = await cmd({ json: true, noColor: true });
            assert.ok(envelope !== null && envelope !== undefined, 'must return envelope');
            assert.strictEqual(typeof envelope.ok, 'boolean');
            assert.strictEqual(envelope.command, 'test.wc1');

            if (shouldThrow) {
              assert.strictEqual(envelope.ok, false);
              assert.ok(envelope.error);
            } else {
              assert.strictEqual(envelope.ok, true);
            }
          }
        ),
        { numRuns: 4 }
      );
    } finally {
      if (originalEnv !== undefined) {
        process.env.PDD_TEST_ADAPTER = originalEnv;
      } else {
        delete process.env.PDD_TEST_ADAPTER;
      }
    }
  });
});
