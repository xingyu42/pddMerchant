import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getShopExperienceView } from '../../src/services/experience.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const ok = (result) => ({ success: true, errorCode: 0, result });

let transport;
let ctx;

beforeEach(() => {
  transport = createMemoryEndpointTransport({
    responses: {
      'experience.navigatorReadyDate': ok('2026-10-30'),
      'experience.navigatorInfo': ok({ timestamp: '2026-10-29', mallStarTomms: 4.6 }),
      'experience.navigatorList': ok([
        { pt: '2026-10-30', mallStarTomms: 4.6 },
        { pt: '2026-10-24', mallStarTomms: 4.5 },
      ]),
    },
  });
  ctx = createTestCtx({ transport, mallId: 'context-id' });
});

it('defaults to seven days ending at ready date and reads ready date before info and list', async () => {
  const view = await getShopExperienceView(ctx);
  assert.deepEqual(transport.calls.map(({ name, params }) => ({ name, params })), [
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
  assert.deepEqual(transport.calls, []);
});

it.each(['Pacific/Honolulu', 'Asia/Shanghai'])('uses calendar dates across leap day independently of TZ=%s', async (timezone) => {
  vi.stubEnv('TZ', timezone);
  transport.set('experience.navigatorReadyDate', ok('2024-03-01'));
  const view = await getShopExperienceView(ctx, { days: 3 });
  assert.equal(view.trend.start_date, '2024-02-28');
});

it.each(['experience.navigatorReadyDate', 'experience.navigatorList'])('degrades a typed %s failure and keeps info', async (endpoint) => {
  transport.set(endpoint, { status: 500, raw: null });
  const view = await getShopExperienceView(ctx);
  assert.equal(view.status, '数据不完整');
  assert.equal(view.trend, null);
  assert.equal(view.snapshot.star, 4.6);
  assert.deepEqual(view.hints, [endpoint.endsWith('ReadyDate') ? '趋势就绪日期拉取失败' : '趋势数据拉取失败']);
  if (endpoint.endsWith('ReadyDate')) assert.equal(transport.calls.length, 2);
});

it('fails the whole command when info fails', async () => {
  transport.set('experience.navigatorInfo', { success: false, errorCode: 40001, errorMsg: 'fixture info failure' });
  await assert.rejects(getShopExperienceView(ctx), {
    code: 'E_BUSINESS',
    exitCode: ExitCodes.BUSINESS,
  });
});
