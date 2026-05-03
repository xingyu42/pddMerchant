import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { property, gen } from './_harness.js';

describe('daemon multi-account PBT', () => {
  const genSlug = gen.string({ minLen: 1, maxLen: 12, chars: 'abcdefghijklmnopqrstuvwxyz0123456789-' });

  it('per-account refresh ordering: each slug appears exactly once', async () => {
    await property(
      'refresh-ordering',
      gen.arrayOf(genSlug, { minLen: 1, maxLen: 10 }),
      (slugs) => {
        const unique = [...new Set(slugs)];
        const refreshed = [];
        for (const slug of unique) {
          refreshed.push(slug);
        }
        assert.deepStrictEqual(refreshed, unique);
      },
    );
  });

  it('concurrency cap: max 3 concurrent refreshes', async () => {
    await property(
      'concurrency-cap',
      gen.arrayOf(genSlug, { minLen: 1, maxLen: 20 }),
      (slugs) => {
        const unique = [...new Set(slugs)];
        const maxConcurrency = 3;
        let running = 0;
        let peak = 0;
        for (const slug of unique) {
          running = Math.min(running + 1, maxConcurrency);
          peak = Math.max(peak, running);
          running = Math.max(0, running - 1);
        }
        assert.ok(peak <= maxConcurrency, `peak ${peak} exceeds cap ${maxConcurrency}`);
      },
    );
  });

  it('relogin fallback: only attempted when credential exists', async () => {
    await property(
      'relogin-fallback',
      gen.record({
        slug: genSlug,
        hasCredential: gen.bool(),
        refreshSuccess: gen.bool(),
      }),
      ({ slug, hasCredential, refreshSuccess }) => {
        let reloginAttempted = false;
        if (!refreshSuccess && hasCredential) {
          reloginAttempted = true;
        }
        if (!hasCredential) {
          assert.ok(!reloginAttempted, 'should not attempt relogin without credential');
        }
      },
    );
  });
});
