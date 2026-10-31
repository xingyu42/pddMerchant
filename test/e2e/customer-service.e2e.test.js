import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createCustomerServiceFixtures } from '../fixtures/test-data.js';

it('emits desert summary and daily consultations with nulls and no account names', () => {
  const result = runCli(['diagnose', 'customer-service'], { fixtures: createCustomerServiceFixtures() });
  assert.equal(result.status, 0);
  assert.equal(result.envelope.command, 'diagnose.customer-service');
  const view = result.envelope.data;
  assert.equal(view.caliber, '多多客服-客服数据（人工回复）');
  assert.equal(view.summary.manual_reply_3min_rate_pct, 100);
  assert.equal(view.summary.avg_manual_response_seconds, 14.67);
  assert.equal(view.window.days, 30);
  assert.equal(view.trend.items.length, 2);
  assert.equal(view.trend.items[0].consult_user_count, null);
  assert.equal(view.trend.items[0].manual_reply_3min_rate_pct, null);
  assert.equal(view.trend.items[0].category_avg_response_seconds, 20);
  assert.equal(view.mall_id, '900001');
  for (const forbidden of ['cs_name', 'SYN-CS-PRIVATE', 'Compare', 'reply30sRateStapleRank']) {
    assert.equal(JSON.stringify(view).includes(forbidden), false, forbidden);
  }
});

it('returns exit two for days beyond sixty-three', () => {
  const result = runCli(['diagnose', 'customer-service', '--days', '64'], { fixtures: createCustomerServiceFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it('retains the mandatory summary when the optional trend fails', () => {
  const fixtures = { ...createCustomerServiceFixtures(), 'endpoints/cs.monthTrend.json': {
    __throws: true, __error: { code: 'E_NETWORK', message: 'fixture unavailable', exitCode: 5 },
  } };
  const { envelope } = runCli(['diagnose', 'customer-service'], { fixtures });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.trend, null);
  assert.equal(envelope.data.summary.consult_user_count, 3);
  assert.equal(envelope.data.hints.length, 1);
});

it('fails when the primary summary fails', () => {
  const fixtures = { ...createCustomerServiceFixtures(), 'endpoints/cs.overview.json': {
    __throws: true, __error: { code: 'E_BUSINESS', message: 'fixture unavailable', exitCode: 6 },
  } };
  const result = runCli(['diagnose', 'customer-service'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
});
