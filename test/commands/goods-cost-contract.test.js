import { it } from 'vitest';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/isolated-cli.js';
import { createCostCli, costArgs } from '../helpers/goods-cost-cli.js';

it.each([['--purchase-yuan', '-1'], ['--goods-id', 'bad'], ['--courier-yuan', '0.001']])('validates cost usage %s', (flag, value) => {
  const args = [...costArgs];
  args[args.indexOf(flag) + 1] = value;
  const result = runCli(['goods', 'cost', 'set', ...args, '--confirm']);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});

it('runs without auth verification or keys and rejects all-accounts', () => {
  const cli = createCostCli();
  try {
    cli.env.PDD_TEST_AUTH_INVALID = '1';
    cli.env.PDD_TEST_AUTH_INDETERMINATE = '1';
    const result = cli.execute(['goods', 'cost', 'set', ...costArgs, '--confirm']);
    assert.equal(result.envelope.ok, true);
    assert.equal(result.envelope.meta.xhr_count, 0);
    assert.equal(cli.execute(['goods', 'cost', 'list', '--all-accounts']).status, 2);
  } finally { cli.dispose(); }
});
