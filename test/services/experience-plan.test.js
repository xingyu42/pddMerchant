import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const mock = vi.hoisted(() => ({ calls: [] }));
vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()),
  async runEndpoint(_page, spec, params) {
    mock.calls.push({ name: spec.name, params, body: spec.buildPayload(params) });
    if (spec.name === 'experiencePlan.status') return { configStatus: 1 };
    if (spec.name === 'experiencePlan.availableInfo') return { price: { unit: 'YUAN', value: '1.11' } };
    if (spec.name === 'experiencePlan.profits') return { orderCount: 209, compensationCount: 3 };
    return { total: 0, items: [] };
  },
}));
const { getExperiencePlanView } = await import('../../src/services/experience-plan.js');
const ctx = { page: {}, mallCtx: { activeId: 'context-id' } };

// 2026-11-11 10:00 上海
const NOW = Date.parse('2026-11-11T02:00:00Z');
const bodyOf = (name) => mock.calls.find((call) => call.name === name).body;

beforeEach(() => {
  mock.calls = [];
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

it('requests the fee list like the page: pending + charged fees created within the Shanghai window', async () => {
  await getExperiencePlanView(ctx);
  assert.deepEqual(bodyOf('experiencePlan.orderInsuranceList'), {
    pageSize: 10, pageNumber: 0, queryFeeStatusList: [1, 2], clientType: 1,
    createBeginTime: Date.parse('2026-11-04T16:00:00Z'), createEndTime: Date.parse('2026-11-11T16:00:00Z') - 1,
  });
  assert.deepEqual(bodyOf('experiencePlan.profits'), { farDate: 6, closerDate: 0 });
});

it.each([[1, 0], [30, 29]])('maps --days %s to profits farDate %s and the matching create window', async (days, farDate) => {
  await getExperiencePlanView(ctx, { days, page: 2 });
  assert.deepEqual(bodyOf('experiencePlan.profits'), { farDate, closerDate: 0 });
  const list = bodyOf('experiencePlan.orderInsuranceList');
  assert.equal(list.pageNumber, 1);
  assert.equal(list.createEndTime - list.createBeginTime + 1, days * 86400000);
});

it('reports the active mall id like other diagnose reports', async () => {
  const { data } = await getExperiencePlanView(ctx);
  assert.equal(data.mall_id, 'context-id');
  assert.equal((await getExperiencePlanView({ page: {} })).data.mall_id, null);
});

it('rejects unsupported days before any request', async () => {
  await assert.rejects(getExperiencePlanView(ctx, { days: 14 }), { code: 'E_USAGE', exitCode: 2 });
  assert.deepEqual(mock.calls, []);
});
