import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { withBrowser } from '../../src/adapter/browser.js';

describe('withBrowser PBT', () => {
  it('PROP-WB-1: body throw → error identity preserved, cleanup called', async () => {
    const originalEnv = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';

    try {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 50 }),
          async (errorMsg) => {
            const thrownError = new Error(errorMsg);
            let caughtError = null;

            try {
              await withBrowser({}, async ({ browser, context, page }) => {
                assert.ok(browser);
                throw thrownError;
              });
            } catch (err) {
              caughtError = err;
            }

            assert.ok(caughtError !== null, 'should have thrown');
            assert.strictEqual(caughtError, thrownError, 'error identity must be preserved');
            assert.strictEqual(caughtError.message, errorMsg);
          }
        ),
        { numRuns: 10 }
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
