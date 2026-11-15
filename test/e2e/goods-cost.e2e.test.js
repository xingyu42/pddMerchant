import { it } from 'vitest';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCostCli, costArgs, costInput } from '../helpers/goods-cost-cli.js';
import { openDatabase, closeDatabase, run } from '../../src/infra/db.js';
import { createProfitFixtures } from '../fixtures/test-data.js';

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

it('rejects the removed --insurance-yuan option as a usage error', () => {
  const cli = createCostCli();
  try {
    const result = cli.execute(['goods', 'cost', 'set', ...costArgs, '--insurance-yuan', '1']);
    assert.equal(result.status, 2);
    assert.equal(result.envelope.ok, false);
  } finally { cli.dispose(); }
});

it('fails an import carrying insurance_yuan with the automatic-fee message and imports files without it', () => {
  const cli = createCostCli();
  try {
    const file = join(cli.root, 'with-insurance.json');
    writeFileSync(file, JSON.stringify([costInput, { ...costInput, goods_id: '102', insurance_yuan: '0.3' }]));
    const result = cli.execute(['goods', 'cost', 'import', file, '--confirm']);
    assert.equal(result.status, 2);
    assert.equal(result.envelope.error.code, 'E_COST_IMPORT_INVALID');
    assert.deepEqual(result.envelope.error.detail.row_errors, [{ row: 2, field: 'insurance_yuan',
      message: '运费险已改为按平台收费记录自动计算，请删除 insurance_yuan' }]);
    assert.equal(cli.execute(['goods', 'cost', 'list']).envelope.data.total, 0);
    assert.equal(cli.execute(['goods', 'cost', 'import', cli.file, '--confirm']).envelope.data.inserted_count, 1);
  } finally { cli.dispose(); }
});

it('opens a database holding a historical manual insurance value and never outputs it', () => {
  const cli = createCostCli(createProfitFixtures());
  try {
    // 模拟旧版 CLI 写入的手填运费险 5 元
    openDatabase(cli.env.PDD_DB_PATH);
    try {
      run(`INSERT INTO goods_cost_entries (account_id, mall_id, goods_id, spec, purchase_fen, packaging_fen,
        courier_fen, insurance_fen, technical_service_fen, updated_at) VALUES (1, '900001', '101', '', 820, 50, 300, 500, 0, ?)`,
      '2026-10-01T00:00:00.000Z');
    } finally { closeDatabase(); }
    const list = cli.execute(['goods', 'cost', 'list']).envelope;
    assert.equal(list.ok, true);
    assert.deepEqual(Object.keys(list.data.items[0]),
      ['goods_id', 'spec', 'purchase_yuan', 'packaging_yuan', 'courier_yuan', 'technical_service_yuan', 'updated_at']);
    const profit = cli.execute(['goods', 'profit']).envelope;
    assert.equal(profit.ok, true, JSON.stringify(profit.error));
    assert.equal(profit.data.items[0].insurance_yuan, 0);
    assert.equal(profit.data.summary.insurance_yuan, 0);
    assert.equal(profit.data.items[0].net_profit_yuan, 3.1);
    const removed = cli.execute(['goods', 'cost', 'remove', '--goods-id', '101', '--confirm']).envelope;
    assert.equal(removed.ok, true);
    for (const data of [list.data, profit.data, removed.data]) assert.ok(!JSON.stringify(data).includes(':5,'));
  } finally { cli.dispose(); }
});
