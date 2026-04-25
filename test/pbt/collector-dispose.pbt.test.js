import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createCollector, _resetCollectorState } from '../../src/adapter/xhr-collector.js';

function fakePage() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    off(event, fn) {
      const fns = listeners.get(event);
      if (!fns) return;
      const idx = fns.indexOf(fn);
      if (idx >= 0) fns.splice(idx, 1);
    },
    emit(event, ...args) {
      const fns = listeners.get(event) || [];
      for (const fn of fns) fn(...args);
    },
  };
}

describe('Collector Dispose PBT', () => {
  it('PROP-CD-1: dispose always settles promise (no unhandled rejection)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 500 }),
        async (timeout) => {
          _resetCollectorState();
          const page = fakePage();
          const collector = createCollector(page, {
            pattern: /test/,
            timeout,
          });

          // Dispose immediately before timeout fires
          collector.dispose();

          // waitFor should reject with E_GENERAL (disposed), NOT hang
          try {
            await collector.waitFor();
            assert.fail('should have rejected');
          } catch (err) {
            assert.strictEqual(err.code, 'E_GENERAL');
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  it('PROP-CD-2: double dispose is safe', () => {
    _resetCollectorState();
    const page = fakePage();
    const collector = createCollector(page, {
      pattern: /test/,
      timeout: 5000,
    });

    collector.dispose();
    collector.dispose(); // should not throw
  });

  it('PROP-CD-3: promise.catch attached prevents unhandled rejection on timeout', async () => {
    _resetCollectorState();
    const page = fakePage();
    const collector = createCollector(page, {
      pattern: /never-match/,
      timeout: 50, // very short timeout
    });

    // Don't call waitFor — let the timeout fire naturally
    // The promise.catch(() => {}) in createCollector should prevent unhandled rejection
    await new Promise((resolve) => setTimeout(resolve, 100));

    // If we get here without an unhandledRejection crash, the test passes
    assert.ok(true);
  });
});
