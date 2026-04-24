import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createPageSession } from '../../src/adapter/page-session.js';
import { createFakeClock } from './helpers/fake-clock.js';
import { createFakeContext, createFakePage } from './helpers/fake-playwright.js';

describe('PageSession PBT', () => {
  it('PROP-PS-1: same key within TTL → sibling page', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl(),
        async (url) => {
          const clock = createFakeClock(1000);
          const context = createFakeContext();
          const session = createPageSession(context, { now: clock.now, ttlMs: 1000 });
          const page = createFakePage();

          const p1 = await session.goto(page, url, {});
          assert.strictEqual(p1, page);

          clock.advance(500);
          const p2 = await session.goto(page, url, {});
          assert.notStrictEqual(p2, page, 'should allocate sibling within TTL');
        }
      ),
      { numRuns: 30 }
    );
  });

  it('PROP-PS-2: different key OR delta >= TTL → no sibling', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl(),
        fc.webUrl(),
        async (url1, url2) => {
          const clock = createFakeClock(1000);
          const context = createFakeContext();
          const session = createPageSession(context, { now: clock.now, ttlMs: 1000 });
          const page = createFakePage();

          await session.goto(page, url1, {});
          clock.advance(1500);
          const p2 = await session.goto(page, url1, {});
          assert.strictEqual(p2, page, 'should reuse page after TTL');
        }
      ),
      { numRuns: 30 }
    );
  });
});
