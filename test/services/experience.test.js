import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

const fixtures = vi.hoisted(() => ({ calls: [], responses: {}, errors: {} }));
vi.mock('../../src/adapter/run-endpoint.js', async (importOriginal) => ({
  ...(await importOriginal()),
  async runEndpoint(_page, spec, params) {
    fixtures.calls.push({ name: spec.name, params });
    if (fixtures.errors[spec.name]) throw fixtures.errors[spec.name];
    return fixtures.responses[spec.name];
  },
}));
const { getShopExperienceView } = await import('../../src/services/experience.js');
const ctx = { page: {}, mallCtx: { activeId: 'context-id' } };

beforeEach(() => {
  fixtures.calls = [];
  fixtures.errors = {};
  fixtures.responses = { 'experience.navigatorReadyDate': '2026-10-30',
    'experience.navigatorInfo': { timestamp: '2026-10-29', mallStarTomms: 4.6 },
    'experience.navigatorList': [{ pt: '2026-10-30', mallStarTomms: 4.6 },
      { pt: '2026-10-24', mallStarTomms: 4.5 }] };
});

it('defaults to seven days ending at ready date and reads ready date before info and list', async () => {
  const view = await getShopExperienceView(ctx);
  assert.deepEqual(fixtures.calls, [
    { name: 'experience.navigatorReadyDate', params: {} },
    { name: 'experience.navigatorInfo', params: {} },
    { name: 'experience.navigatorList', params: { beginDate: '2026-10-24', endDate: '2026-10-30' } },
  ]);
  assert.equal(view.snapshot.stat_date, '2026-10-29');
  assert.equal(view.mall_id, 'context-id');
  assert.deepEqual(view.trend.items.map((item) => item.date), ['2026-10-24', '2026-10-30']);
  assert.equal(view.status, '数据完整');
});

it.each([[1, '2026-10-30'], [30, '2026-10-01']])('accepts days=%s with an inclusive date window', async (days, start) => {
  const view = await getShopExperienceView(ctx, { days });
  assert.equal(view.trend.start_date, start);
  assert.equal(view.trend.end_date, '2026-10-30');
  assert.equal(view.trend.days, days);
});

it.each([0, 31, -1, 1.5, NaN, Infinity, '7', null])('rejects invalid days=%s before any endpoint', async (days) => {
  await assert.rejects(getShopExperienceView(ctx, { days }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(fixtures.calls, []);
});

it.each(['Pacific/Honolulu', 'Asia/Shanghai'])('uses calendar dates across leap day independently of TZ=%s', async (timezone) => {
  vi.stubEnv('TZ', timezone);
  fixtures.responses['experience.navigatorReadyDate'] = '2024-03-01';
  const view = await getShopExperienceView(ctx, { days: 3 });
  assert.equal(view.trend.start_date, '2024-02-28');
});

it.each(['experience.navigatorReadyDate', 'experience.navigatorList'])('degrades a typed %s failure and keeps info', async (endpoint) => {
  fixtures.errors[endpoint] = new PddCliError({ code: 'E_NETWORK', message: 'fixture failure', exitCode: ExitCodes.NETWORK });
  const view = await getShopExperienceView(ctx);
  assert.equal(view.status, '数据不完整');
  assert.equal(view.trend, null);
  assert.equal(view.snapshot.star, 4.6);
  assert.deepEqual(view.hints, [endpoint.endsWith('ReadyDate') ? '趋势就绪日期拉取失败' : '趋势数据拉取失败']);
  if (endpoint.endsWith('ReadyDate')) assert.equal(fixtures.calls.length, 2);
});

it('fails the whole command when info fails', async () => {
  const error = new PddCliError({ code: 'E_BUSINESS', message: 'fixture info failure', exitCode: ExitCodes.BUSINESS });
  fixtures.errors['experience.navigatorInfo'] = error;
  await assert.rejects(getShopExperienceView(ctx), (actual) => actual === error);
});
