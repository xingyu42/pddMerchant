import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { withEndpointPages } from '../../src/adapter/endpoint-pages.js';

function createPages() {
  const pages = Array.from({ length: 2 }, () => ({ close: vi.fn(async () => {}) }));
  const context = { newPage: vi.fn().mockResolvedValueOnce(pages[0]).mockResolvedValueOnce(pages[1]) };
  const page = { context: () => context, close: vi.fn() };
  return { page, pages, context };
}

describe('withEndpointPages', () => {
  it('closes partially created pages and preserves a creation failure', async () => {
    const { page, pages, context } = createPages();
    const creationError = new Error('second page creation failed');
    context.newPage.mockReset().mockResolvedValueOnce(pages[0]).mockRejectedValueOnce(creationError);
    const callback = vi.fn();

    await assert.rejects(withEndpointPages(page, 2, callback), (error) => error === creationError);
    assert.equal(pages[0].close.mock.calls.length, 1);
    assert.equal(callback.mock.calls.length, 0);
    assert.equal(page.close.mock.calls.length, 0);
  });

  it('returns the callback result and closes all leased pages after success', async () => {
    const { page, pages, context } = createPages();
    const result = { collected: true };
    const actual = await withEndpointPages(page, 2, async (leasedPages) => {
      assert.deepEqual(leasedPages, pages);
      assert.notEqual(leasedPages[0], leasedPages[1]);
      assert.ok(pages.every((leasedPage) => leasedPage.close.mock.calls.length === 0));
      return result;
    });

    assert.equal(actual, result);
    assert.equal(context.newPage.mock.calls.length, 2);
    assert.ok(pages.every((leasedPage) => leasedPage.close.mock.calls.length === 1));
    assert.equal(page.close.mock.calls.length, 0);
  });

  it.each(['sync', 'async'])('closes all leased pages after a %s callback failure', async (mode) => {
    const { page, pages } = createPages();
    const callbackError = new Error('collection failed');
    const fail = () => { throw callbackError; };
    const callback = mode === 'sync' ? fail : async () => fail();

    await assert.rejects(withEndpointPages(page, 2, callback), (error) => error === callbackError);
    assert.ok(pages.every((leasedPage) => leasedPage.close.mock.calls.length === 1));
    assert.equal(page.close.mock.calls.length, 0);
  });

  it.each(['success', 'failure'])('continues cleanup after a close failure on callback %s', async (outcome) => {
    const { page, pages } = createPages();
    pages[0].close.mockRejectedValueOnce(new Error('close failed'));
    const callbackError = new Error('collection failed');
    const pending = withEndpointPages(page, 2, async () => {
      if (outcome === 'failure') throw callbackError;
      return 'collected';
    });

    if (outcome === 'failure') await assert.rejects(pending, (error) => error === callbackError);
    else assert.equal(await pending, 'collected');
    assert.ok(pages.every((leasedPage) => leasedPage.close.mock.calls.length === 1));
  });

  it.each([null, undefined, { close: vi.fn() }, { context: {}, close: vi.fn() }])(
    'shares the supplied fixture page without owning it: %j', async (page) => {
      const result = await withEndpointPages(page, 2, async (pages) => {
        assert.equal(pages.length, 2);
        assert.ok(pages.every((leasedPage) => leasedPage === page));
        return 'fixture';
      });
      assert.equal(result, 'fixture');
      if (page?.close) assert.equal(page.close.mock.calls.length, 0);
    },
  );
});
