import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';

const fixtures = vi.hoisted(() => ({ calls: [], responses: {}, errors: {}, pages: null }));
vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({ ...(await importOriginal()),
  async runEndpoint(_page, spec, params) {
    fixtures.calls.push({ name: spec.name, params });
    if (fixtures.errors[spec.name]) throw fixtures.errors[spec.name];
    if (spec.name === 'reviews.list' && fixtures.pages) return fixtures.pages(params.pageNo);
    return fixtures.responses[spec.name];
  },
}));
const { getReviewsView } = await import('../../src/services/reviews.js');
const ctx = { page: {}, mallCtx: { activeId: '900001' } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
  fixtures.calls = [];
  fixtures.errors = {};
  fixtures.pages = null;
  fixtures.responses = { 'reviews.keywordAgg': { positiveKeywordList: [], negativeKeywordList: [] },
    'reviews.typeAgg': { typeList: [] }, 'reviews.list': { data: [], totalRows: 0 } };
});

it.each([[30, 1], [60, 5], [90, 4], [180, 3]])('maps %s days to rangeType %s and second timestamps', async (days, rangeType) => {
  const view = await getReviewsView(ctx, { days });
  const params = fixtures.calls[0].params;
  assert.equal(params.endTime, 1793404800);
  assert.equal(params.startTime, 1793404800 - days * 86400);
  assert.equal(params.rangeType, rangeType);
  assert.equal(view.mall_id, '900001');
});

it('defaults to thirty days', async () => {
  assert.equal((await getReviewsView(ctx)).window_days, 30);
});

it.each([45, 0, 31, 30.5, '30', null, NaN])('rejects invalid days %s', async (days) => {
  await assert.rejects(getReviewsView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(fixtures.calls, []);
});

it('collects pages and preserves upstream totalRows', async () => {
  fixtures.pages = (page) => ({ totalRows: 11, data: Array.from({ length: page === 1 ? 10 : 1 },
    () => ({ goodsId: 101, score: 0, descScore: 3 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 11);
  assert.equal(view.negative_reviews.total, 11);
  assert.equal(view.negative_reviews.truncated, false);
  assert.deepEqual(fixtures.calls.filter((call) => call.name === 'reviews.list').map((call) => call.params.pageNo), [1, 2]);
});

it('caps collection at thirty full pages and marks truncation', async () => {
  fixtures.pages = () => ({ totalRows: 500, data: Array.from({ length: 10 }, () => ({ descScore: 1 })) });
  const view = await getReviewsView(ctx);
  assert.equal(view.negative_reviews.items.length, 300);
  assert.equal(view.negative_reviews.total, 500);
  assert.equal(view.negative_reviews.truncated, true);
  assert.equal(fixtures.calls.filter((call) => call.name === 'reviews.list').length, 30);
  assert.ok(view.hints.some((hint) => hint.includes('截断')));
});

it.each([['reviews.keywordAgg', 'keyword_tags'], ['reviews.typeAgg', 'issue_types'],
  ['reviews.list', 'negative_reviews']])('degrades independent %s failures', async (name, field) => {
  fixtures.errors[name] = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: 5 });
  const view = await getReviewsView(ctx);
  assert.equal(view[field], null);
  assert.equal(view.hints.length, 1);
  assert.equal(fixtures.calls.length, 3);
});

it('throws the last typed error when all three sources fail', async () => {
  for (const name of ['reviews.keywordAgg', 'reviews.typeAgg', 'reviews.list']) {
    fixtures.errors[name] = new PddCliError({ code: 'E_NETWORK', message: name, exitCode: 5 });
  }
  await assert.rejects(getReviewsView(ctx), (error) => error === fixtures.errors['reviews.list']);
});

it.each(['reviews.keywordAgg', 'reviews.typeAgg', 'reviews.list'])('propagates unexpected errors from %s', async (name) => {
  fixtures.errors[name] = new TypeError('fixture bug');
  await assert.rejects(getReviewsView(ctx), TypeError);
});

it('propagates cancellation before requests', async () => {
  await assert.rejects(getReviewsView({ ...ctx, signal: AbortSignal.abort() }), { code: 'E_TIMEOUT' });
  assert.deepEqual(fixtures.calls, []);
});
