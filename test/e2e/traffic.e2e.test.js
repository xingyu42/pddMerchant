import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createTrafficFixtures } from '../fixtures/test-data.js';

it('emits daily flow and platform peers in one JSON envelope', () => {
  const { status, envelope } = runCli(['diagnose', 'traffic'], { fixtures: createTrafficFixtures() });
  assert.equal(status, 0);
  assert.equal(envelope.command, 'diagnose.traffic');
  assert.deepEqual(envelope.data.window, { start_date: '2026-10-01', end_date: '2026-10-30', days: 30 });
  assert.deepEqual(envelope.data.summary, { shop_visitor_count: 30, pay_order_count: 8, pay_amount_yuan: 35.79 });
  assert.equal(envelope.data.items[0].shop_visitor_count_peer_avg, 5);
});

it('rejects thirty-one days with exit two', () => {
  const result = runCli(['diagnose', 'traffic', '--days', '31']);
  assert.equal(result.status, 2);
});

it('fails the command on main source failure', () => {
  const fixtures = { ...createTrafficFixtures(), 'endpoints/traffic.overviewList.json': {
    __throws: true, __error: { code: 'E_BUSINESS', message: 'synthetic failure', exitCode: 6 } } };
  const result = runCli(['diagnose', 'traffic'], { fixtures });
  assert.equal(result.status, 6);
  assert.equal(result.envelope.data, null);
});
