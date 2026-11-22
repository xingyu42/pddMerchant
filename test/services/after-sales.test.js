import assert from 'node:assert/strict';
import { it } from 'vitest';
import { getAfterSalesView } from '../../src/services/after-sales.js';
import { createUpstreamAfterSalesCase, createUpstreamAfterSalesParams } from '../fixtures/test-data.js';

function fixtureContext(listPage) {
  const payloads = [];
  const ctx = { client: {
    async execute(spec, params) {
      if (spec.name === 'after_sales.params') return { data: spec.normalize({ result: createUpstreamAfterSalesParams() }) };
      assert.equal(spec.name, 'after_sales.list');
      const payload = spec.buildPayload(params);
      payloads.push(payload);
      return { data: spec.normalize({ result: listPage(payload.pageNumber) }) };
    },
  } };
  return { ctx, payloads };
}

it.each([
  ['open', [1, 2, 3, 4, 7, 9, 10, 11, 14, 15, 18, 21, 22, 27, 31, 32]],
  ['refunded', [5]],
  ['closed', [6, 12, 17, 24]],
  ['all', undefined],
])('pushes down status %s and retains rows with unmapped status codes', async (status, codes) => {
  const { ctx, payloads } = fixtureContext(() => ({
    total: 11, list: [createUpstreamAfterSalesCase({ afterSalesStatus: 99 })],
  }));
  const view = await getAfterSalesView(ctx, { status });
  assert.equal(payloads.length, 1);
  if (codes === undefined) assert.equal(Object.hasOwn(payloads[0], 'afterSalesStatusList'), false);
  else assert.deepEqual(payloads[0].afterSalesStatusList, codes);
  assert.equal(view.total, 11);
  assert.equal(view.fetched_count, 1);
  assert.deepEqual(view.items.map((item) => item.status), ['未知(99)']);
});

it('keeps the first page total and skips truncation when page twenty is short', async () => {
  const { ctx, payloads } = fixtureContext((page) => ({
    total: page === 1 ? 2050 : 0,
    list: Array.from({ length: page === 20 ? 50 : 100 }, (_, index) =>
      createUpstreamAfterSalesCase({ id: (page - 1) * 100 + index })),
  }));
  const view = await getAfterSalesView(ctx);
  assert.deepEqual(payloads.map(({ pageNumber }) => pageNumber), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(view.total, 2050);
  assert.equal(view.fetched_count, 1950);
  assert.equal(view.items.length, 1950);
  assert.equal(view.truncated, false);
  assert.deepEqual(view.hints, []);
  assert.ok(view.headline.every((line) => !line.includes('上限')));
});
