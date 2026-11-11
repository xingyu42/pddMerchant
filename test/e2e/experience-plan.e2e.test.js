import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createExperiencePlanFixtures, createUpstreamOrderInsurance } from '../fixtures/test-data.js';

const DAY_MS = 86400000;

it('reports plan status, today fee, window counts and per-order fee records', () => {
  const result = runCli(['diagnose', 'experience-plan'], { fixtures: createExperiencePlanFixtures() });
  assert.equal(result.status, 0);
  const { command, data, meta } = result.envelope;
  assert.equal(command, 'diagnose.experience-plan');
  assert.equal(data.plan_status, 1);
  assert.equal(data.today_fee_per_order_yuan, 1.11);
  assert.equal(data.charged_order_count, 209);
  assert.equal(data.compensated_order_count, 3);
  assert.equal(data.total, 203);
  assert.equal(data.page, 1);
  assert.deepEqual(data.items[0], {
    order_sn: 'SYN-PLAN-ORDER-1', service_fee_yuan: 1.11, fee_status: '收费成功', service_status: '生效中',
    effective_at: '2025-11-07 15:20:00', shipped_at: '2025-11-07 12:33:20', is_free: false,
  });
  assert.equal(data.items[1].service_fee_yuan, 0.9);
  assert.equal(data.items[1].service_status, '已补偿运费');
  assert.equal(data.items[1].is_free, true);
  assert.deepEqual([data.items[2].service_status, data.items[2].fee_status, data.items[2].effective_at,
    data.items[2].shipped_at, data.items[2].is_free], ['未知(9)', '待收费', null, null, null]);
  assert.ok(data.headline.some((line) => line.includes('1.11 元/单')));
  assert.ok(data.headline.some((line) => line.includes('209') && line.includes('3')));
  assert.ok(data.headline.some((line) => line.includes('203')));
  assert.deepEqual(meta.warnings, []);
  const serialized = JSON.stringify(data);
  for (const forbidden of ['SYN-PLAN-BATCH', 'SYN-PLAN-ORDER-1-MI', 'SYN-PLAN-MALL', 'SYN-PLAN-UID', 'batchSn', 'mallId']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

it.each([1, 7, 30, 90])('accepts --days %s with a Shanghai window ending today', (days) => {
  const { envelope } = runCli(['diagnose', 'experience-plan', '--days', String(days)],
    { fixtures: createExperiencePlanFixtures() });
  assert.equal(envelope.ok, true);
  const { window } = envelope.data;
  assert.equal(window.days, days);
  assert.match(window.start_at, /^\d{4}-\d{2}-\d{2} 00:00:00$/);
  assert.match(window.end_at, /^\d{4}-\d{2}-\d{2} 23:59:59$/);
  const span = Date.parse(`${window.end_at.slice(0, 10)}T00:00:00Z`) - Date.parse(`${window.start_at.slice(0, 10)}T00:00:00Z`);
  assert.equal(span, (days - 1) * DAY_MS);
});

it.each(['0', '14', '2.5', 'x'])('rejects --days %s at parse time with usage exit 2', (days) => {
  const result = runCli(['diagnose', 'experience-plan', '--days', days], { fixtures: createExperiencePlanFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.command, 'diagnose.experience-plan');
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it('rejects a non-positive --page with usage exit 2', () => {
  const result = runCli(['diagnose', 'experience-plan', '--page', '0'], { fixtures: createExperiencePlanFixtures() });
  assert.equal(result.status, 2);
});

it('returns later pages with the upstream total and an empty list past the end', () => {
  const { envelope } = runCli(['diagnose', 'experience-plan', '--page', '2'], { fixtures: createExperiencePlanFixtures() });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.page, 2);
  assert.equal(envelope.data.total, 203);
  assert.deepEqual(envelope.data.items, []);
});

it('reports an empty plan factually with exit 0 and the raw config status', () => {
  const fixtures = createExperiencePlanFixtures({ configStatus: 0, price: null, orderCount: 0, compensationCount: 0,
    total: 0, rows: [] });
  const result = runCli(['diagnose', 'experience-plan'], { fixtures });
  assert.equal(result.status, 0);
  const { data } = result.envelope;
  assert.equal(data.plan_status, 0);
  assert.equal(data.today_fee_per_order_yuan, null);
  assert.equal(data.charged_order_count, 0);
  assert.equal(data.compensated_order_count, 0);
  assert.equal(data.total, 0);
  assert.deepEqual(data.items, []);
  assert.ok(data.headline.some((line) => line.includes('无收费记录')));
  assert.ok(data.headline.some((line) => line.includes('费率缺失')));
});

it('outputs null with a warning for non-YUAN money units', () => {
  const fixtures = createExperiencePlanFixtures({ price: { unit: 'FEN', value: '111', unitCode: 2 }, rows: [
    createUpstreamOrderInsurance({ serviceAmountVO: { unit: 'JIAO', value: '11', unitCode: 3 } }),
  ] });
  const { envelope } = runCli(['diagnose', 'experience-plan'], { fixtures });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.today_fee_per_order_yuan, null);
  assert.equal(envelope.data.items[0].service_fee_yuan, null);
  const warnings = envelope.meta.warnings.join('\n');
  assert.ok(warnings.includes('FEN'), warnings);
  assert.ok(warnings.includes('JIAO'), warnings);
});

it('fails with business exit 6 and the upstream message on an upstream business error', () => {
  const fixtures = { ...createExperiencePlanFixtures(),
    'endpoints/experiencePlan.orderInsuranceList.json': { success: false, errorCode: 4000, errorMsg: '合成上游错误原文', result: null } };
  const result = runCli(['diagnose', 'experience-plan'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.error.code, 'E_BUSINESS');
  assert.equal(result.envelope.error.message, '合成上游错误原文');
  assert.equal(result.envelope.data, null);
});
