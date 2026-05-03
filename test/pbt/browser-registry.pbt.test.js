import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { registerBrowser, unregisterBrowser, closeAllBrowsers } from '../../src/adapter/browser.js';

describe('Browser Registry PBT', () => {
  it('PROP-BR-1: register + unregister is idempotent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n) => {
        const fakeBrowser = { id: n, close: async () => {}, contexts: () => [] };
        registerBrowser(fakeBrowser);
        registerBrowser(fakeBrowser); // double register
        unregisterBrowser(fakeBrowser);
        unregisterBrowser(fakeBrowser); // double unregister — no throw
      }),
      { numRuns: 50 }
    );
  });

  it('PROP-BR-2: closeAllBrowsers is re-entrant safe', async () => {
    const closed = [];
    const fakeBrowsers = Array.from({ length: 3 }, (_, i) => ({
      id: i,
      contexts: () => [],
      close: async () => { closed.push(i); },
    }));
    for (const b of fakeBrowsers) registerBrowser(b);

    // Call closeAllBrowsers twice concurrently — should not throw
    await Promise.all([
      closeAllBrowsers({ timeoutMs: 1000 }),
      closeAllBrowsers({ timeoutMs: 1000 }),
    ]);

    // All browsers should have been attempted
    assert.ok(closed.length >= 3, `Expected >=3 close calls, got ${closed.length}`);
  });

  it('PROP-BR-3: registerBrowser(null/undefined) is a no-op', () => {
    // Should not throw
    registerBrowser(null);
    registerBrowser(undefined);
  });
});
