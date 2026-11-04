import { it } from 'vitest';
import assert from 'node:assert/strict';
import { createCostCli, costArgs } from '../helpers/goods-cost-cli.js';

it('previews, sets, lists, imports, removes and cascades local costs', () => {
  const cli = createCostCli();
  try {
    const invoke = (...args) => cli.execute(['goods', 'cost', ...args]).envelope;
    assert.equal(invoke('set', ...costArgs).data.dry_run, true);
    assert.equal(invoke('list').data.total, 0);
    assert.equal(invoke('set', ...costArgs, '--confirm').data.dry_run, false);
    assert.equal(invoke('list').data.items[0].purchase_yuan, 8.2);
    assert.equal(invoke('import', cli.file, '--confirm').data.updated_count, 1);
    assert.equal(invoke('remove', '--goods-id', '101').data.removed_count, 0);
    assert.equal(invoke('remove', '--goods-id', '101', '--confirm').data.removed_count, 1);
    invoke('import', cli.file, '--confirm');
    assert.equal(cli.execute(['account', 'remove', '--slug', 'synthetic-shop', '--confirm']).envelope.ok, true);
    assert.equal(invoke('list').error.code, 'E_ACCOUNT_REQUIRED');
  } finally { cli.dispose(); }
});
