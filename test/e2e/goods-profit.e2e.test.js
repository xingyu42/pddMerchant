import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createCostCli, costArgs } from '../helpers/goods-cost-cli.js';
import { createProfitFixtures } from '../fixtures/test-data.js';
import { runCli } from '../helpers/isolated-cli.js';

// 进程级守卫：单行 JSON、退出码、commander 参数解析与选项接线。
// 利润计算的各分支在 test/commands/goods-profit-contract.test.js 进程内断言。

function profit(fixtures, { costs = true, args = [] } = {}) {
  const cli = createCostCli(fixtures);
  try {
    if (costs) assert.equal(cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']).envelope.ok, true);
    const result = cli.execute(['goods', 'profit', ...args]);
    assert.equal(result.envelope.ok, true, JSON.stringify(result.envelope.error));
    assert.equal(result.status, 0);
    return result.envelope;
  } finally { cli.dispose(); }
}

it('reports profit from costs stored by a previous process', () => {
  const { data } = profit(createProfitFixtures());
  assert.equal(data.items[0].revenue_yuan, 24);
  assert.equal(data.items[0].net_profit_yuan, 3.1);
  assert.equal(data.summary.net_profit_yuan, 2.6);
  for (const forbidden of ['SYN-RECEIVER', 'receive_mobile', 'buyer_memo', 'raw']) {
    assert.equal(JSON.stringify(data).includes(forbidden), false, forbidden);
  }
});

it('exits 0 with null insurance-dependent amounts when fee records fail', () => {
  const failed = createProfitFixtures();
  failed['endpoints/experiencePlan.orderInsuranceList.json'] = { __throws: true, __error: { code: 'E_NETWORK', exitCode: 5 } };
  const { data } = profit(failed, { args: ['--days', '29'] });
  assert.equal(data.items[0].net_profit_yuan, null);
  assert.equal(data.items[0].revenue_yuan, 24);
  assert.equal(data.summary.data_quality.insurance_complete, false);
  assert.ok(data.hints.some((text) => text.includes('运费险') && text.includes('拉取失败')));
});

it('wires --goods-id to the goods filter without changing full-shop totals', () => {
  const cli = createCostCli(createProfitFixtures());
  try {
    cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']);
    const baseline = cli.execute(['goods', 'profit']).envelope.data;
    const filtered = cli.execute(['goods', 'profit', '--goods-id', '102']).envelope.data;
    assert.deepEqual(filtered.summary, baseline.summary);
    assert.equal(filtered.items[0].goods_id, '102');
    assert.equal(filtered.items[0].order_count, 0);
  } finally { cli.dispose(); }
});

it.each(['0', '91', '-1', '1.5', 'abc'])('rejects --days %s with E_USAGE', (days) => {
  const result = runCli(['goods', 'profit', '--days', days], { fixtures: createProfitFixtures() });
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it.each(['1', '90'])('accepts --days boundary %s', (days) => {
  assert.equal(profit(createProfitFixtures(), { costs: false, args: ['--days', days] }).data.window.days, Number(days));
});
