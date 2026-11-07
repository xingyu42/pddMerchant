import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError } from '../../src/infra/errors.js';
import { createReport, defineReport, reportHints, runReport, validateReportDays } from '../../src/services/operating-report.js';
import { CUSTOMER_SERVICE_REPORT, toCustomerServiceView } from '../../src/services/views/customer-service.js';
import { REVIEWS_REPORT, toReviewsView } from '../../src/services/views/reviews.js';
import { EXPERIENCE_REPORT, toExperienceView } from '../../src/services/views/experience.js';
import { TRAFFIC_REPORT } from '../../src/services/views/traffic.js';
import { GOODS_TRAFFIC_REPORT, toGoodsTrafficView } from '../../src/services/views/goods-traffic.js';
import { GOODS_PROFIT_REPORT, toGoodsProfitView } from '../../src/services/views/goods-profit.js';

const definitions = [CUSTOMER_SERVICE_REPORT, REVIEWS_REPORT, EXPERIENCE_REPORT,
  TRAFFIC_REPORT, GOODS_TRAFFIC_REPORT, GOODS_PROFIT_REPORT];
const failure = (code = 'E_NETWORK') => new PddCliError({ code, message: '测试数据源失败', exitCode: 5 });
const rejectSource = async () => { throw failure(); };

it('returns successful values unchanged without recording a fallback hint', async () => {
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  const value = { items: [] };
  const fallback = vi.fn();
  assert.equal(await report.optional('trend_unavailable', async () => value, fallback), value);
  assert.deepEqual(report.hints, []);
  assert.equal(fallback.mock.calls.length, 0);
});

it.each([null, new Map(), { complete: false, items: [] }])('preserves caller fallback identity: %s', async (fallback) => {
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  assert.equal(await report.optional('trend_unavailable', rejectSource, fallback), fallback);
  assert.deepEqual(report.hints, ['trend_unavailable']);
});

it.each(['E_NETWORK', 'E_RATE_LIMIT', 'E_BUSINESS', 'E_AUTH_EXPIRED'])('lets the fallback observe %s and retain partial state', async (code) => {
  const error = failure(code);
  const partial = { byGoods: new Map([['101', 200]]), request_count: 2 };
  const report = createReport({}, GOODS_PROFIT_REPORT);
  let lastError = null;
  const result = await report.optional('promo_unavailable', async () => { throw error; }, (observed) => {
    lastError = observed;
    return { ...partial, complete: false, ratelimited: observed.code === 'E_RATE_LIMIT' };
  });
  assert.equal(lastError, error);
  assert.equal(result.byGoods, partial.byGoods);
  assert.equal(result.request_count, 2);
  assert.equal(result.ratelimited, code === 'E_RATE_LIMIT');
  assert.deepEqual(report.hints, ['promo_unavailable']);
});

it.each([failure('E_TIMEOUT'), Object.assign(new Error('取消'), { name: 'AbortError' }),
  new TypeError('测试程序异常'), new ReferenceError('测试引用异常'), new Error('测试异常'),
  Object.assign(new Error('非领域错误'), { code: 'E_NETWORK' }), null])('propagates fatal errors unchanged: %s', async (error) => {
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  const fallback = vi.fn();
  let actual = Symbol('尚未抛出');
  try { await report.optional('trend_unavailable', async () => { throw error; }, fallback); }
  catch (caught) { actual = caught; }
  assert.equal(actual, error);
  assert.deepEqual(report.hints, []);
  assert.equal(fallback.mock.calls.length, 0);
});

it('honors cancellation before collection starts', async () => {
  const report = createReport({ signal: AbortSignal.abort() }, CUSTOMER_SERVICE_REPORT);
  const collect = vi.fn();
  await assert.rejects(report.optional('trend_unavailable', collect), { code: 'E_TIMEOUT', exitCode: 5 });
  assert.equal(collect.mock.calls.length, 0);
  assert.deepEqual(report.hints, []);
});

it.each(['success', 'domain_failure', 'unexpected_failure'])('honors cancellation after %s', async (outcome) => {
  const controller = new AbortController();
  const report = createReport({ signal: controller.signal }, CUSTOMER_SERVICE_REPORT);
  const fallback = vi.fn();
  await assert.rejects(report.optional('trend_unavailable', async () => {
    controller.abort();
    if (outcome === 'domain_failure') throw failure();
    if (outcome === 'unexpected_failure') throw new TypeError('测试异常');
    return [];
  }, fallback), { code: 'E_TIMEOUT', exitCode: 5 });
  assert.deepEqual(report.hints, []);
  assert.equal(fallback.mock.calls.length, 0);
});

it('propagates fallback errors without retrying or replacing them', async () => {
  const error = new TypeError('回退异常');
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  await assert.rejects(report.optional('trend_unavailable', rejectSource, () => { throw error; }),
    (actual) => actual === error);
  assert.deepEqual(report.hints, ['trend_unavailable']);
});

it('keeps an unregistered hint fatal even when emitted inside an optional collector', async () => {
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  const fallback = vi.fn();
  await assert.rejects(report.optional('trend_unavailable', async () => report.hint('unregistered'), fallback),
    { code: 'E_INTERNAL', exitCode: 1 });
  assert.deepEqual(report.hints, []);
  assert.equal(fallback.mock.calls.length, 0);
});

it('validates optional-source hint registration before calling the collector', async () => {
  const report = createReport({}, CUSTOMER_SERVICE_REPORT);
  const collect = vi.fn();
  await assert.rejects(report.optional('unregistered', collect), { code: 'E_INTERNAL', exitCode: 1 });
  assert.equal(collect.mock.calls.length, 0);
  assert.throws(() => reportHints(CUSTOMER_SERVICE_REPORT, Array(1)), { code: 'E_INTERNAL', exitCode: 1 });
});

it('shares the window and hint array with the report callback', async () => {
  const window = { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 };
  const hints = [];
  const result = await runReport({}, CUSTOMER_SERVICE_REPORT, { days: 30, window: async () => window, hints }, async (report) => {
    assert.equal(report.window, window);
    assert.equal(report.hints, hints);
    report.hint('trend_unavailable');
    return { window, hints };
  });
  assert.equal(result.window, window);
  assert.deepEqual(result.hints, ['trend_unavailable']);
});

it('validates days before constructing a window or calling collectors', async () => {
  const window = vi.fn();
  const collect = vi.fn();
  await assert.rejects(runReport({}, CUSTOMER_SERVICE_REPORT, { days: NaN, window }, collect), { code: 'E_USAGE', exitCode: 2 });
  assert.equal(window.mock.calls.length, 0);
  assert.equal(collect.mock.calls.length, 0);
});

it.each(['before_window', 'after_window', 'after_collect'])('checks command cancellation %s', async (stage) => {
  const controller = new AbortController();
  if (stage === 'before_window') controller.abort();
  const window = vi.fn(async () => { if (stage === 'after_window') controller.abort(); return {}; });
  const collect = vi.fn(async () => { controller.abort(); return {}; });
  await assert.rejects(runReport({ signal: controller.signal }, CUSTOMER_SERVICE_REPORT, { window }, collect), { code: 'E_TIMEOUT' });
  assert.equal(collect.mock.calls.length, stage === 'after_collect' ? 1 : 0);
  assert.equal(window.mock.calls.length, stage === 'before_window' ? 0 : 1);
});

it.each(definitions)('registers Chinese hints and rejects unknown or inherited keys: %s', (definition) => {
  assert.ok(reportHints(definition, Object.keys(definition.hints)).every((hint) => /[\u3400-\u9fff]/u.test(hint)));
  const report = createReport({}, definition);
  for (const key of ['unregistered', 'constructor', '__proto__']) {
    assert.throws(() => report.hint(key), { code: 'E_INTERNAL', exitCode: 1 });
    assert.throws(() => reportHints(definition, [key]), { code: 'E_INTERNAL', exitCode: 1 });
  }
});

it.each([undefined, null, '', '   ', 'untranslated_hint'])('rejects invalid registered hint text: %s', (text) => {
  const definition = defineReport({ days: CUSTOMER_SERVICE_REPORT.days, hints: { invalid: text } });
  assert.throws(() => reportHints(definition, ['invalid']), { code: 'E_INTERNAL' });
});

it('fails loudly through report views rather than returning null or filtering unknown hints', () => {
  const hints = ['unregistered'];
  const window = { days: 1 };
  const views = [
    () => toCustomerServiceView({}, { window, hints }),
    () => toReviewsView({}, { days: 30, hints }),
    () => toExperienceView({}, { hints }),
    () => toGoodsTrafficView([], { window, hints, promotions: new Map() }),
    () => toGoodsProfitView({ items: [], summary: {} }, { window, quality: {}, reasons: hints }),
  ];
  for (const project of views) assert.throws(project, { code: 'E_INTERNAL', exitCode: 1 });
});

it.each([
  [CUSTOMER_SERVICE_REPORT, '--days 需为 1-63 的整数'],
  [REVIEWS_REPORT, '--days 需为 30、60、90 或 180'],
  [EXPERIENCE_REPORT, '--days 需为 1–30 的整数'],
  [TRAFFIC_REPORT, '--days 需为 1-30 的整数'],
  [GOODS_TRAFFIC_REPORT, '--days 仅接受 1、7、30'],
  [GOODS_PROFIT_REPORT, '--days 需要 1–90 的整数，默认 30'],
])('preserves the service validation message: %s', (definition, message) => {
  assert.throws(() => validateReportDays(definition, NaN), { code: 'E_USAGE', exitCode: 2, message });
});
