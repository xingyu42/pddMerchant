import { it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { insertAccount } from '../../src/infra/account-store.js';
import { importGoodsCostView, listGoodsCostView } from '../../src/services/goods-cost.js';
import { parseCostImport } from '../../src/services/goods-cost-import.js';

const row = (overrides = {}) => ({ goods_id: '101', purchase_yuan: '1.01', packaging_yuan: 0, courier_yuan: 0, ...overrides });
async function withFile(content, action) {
  const root = mkdtempSync(join(tmpdir(), 'pdd-cost-import-'));
  const path = join(root, 'costs.json');
  try { writeFileSync(path, content); await action(path); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

it('accepts BOM and exact special-character specs', async () => {
  await withFile('\uFEFF' + JSON.stringify([row({ spec: ' red, "large"\n ' })]), async (file) => {
    const entries = await parseCostImport(file);
    assert.equal(entries[0].spec, ' red, "large"\n ');
    assert.equal(entries[0].purchase_fen, 101);
  });
});

it.each(['{bad', '{}', '[]', JSON.stringify(Array(5001).fill(row())), ' '.repeat(1024 * 1024 + 1)])('rejects invalid files safely', async (content) => {
  await withFile(content, async (file) => {
    await assert.rejects(() => parseCostImport(file), (error) => {
      assert.equal(error.code, 'E_COST_IMPORT_INVALID');
      assert.equal(error.exitCode, 2);
      assert.equal(error.detail.row_errors[0].row, null);
      assert.equal(JSON.stringify(error).includes(file), false);
      assert.equal(Object.hasOwn(error.detail.row_errors[0], 'line'), false);
      return true;
    });
  });
});

it('collects bad rows, including duplicates and foreign scope, and never writes them', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic' });
  const ctx = { account, accountId: account.id, config: {} };
  const rows = [row(), row(), row({ goods_id: '102', mall_id: 'secret' }), row({ goods_id: '103', purchase_yuan: '-1' })];
  await withFile(JSON.stringify(rows), async (file) => {
    await assert.rejects(() => importGoodsCostView(ctx, { file, confirm: true }), (error) => {
      assert.deepEqual(error.detail.row_errors.map((item) => item.row), [2, 3, 4]);
      assert.equal(JSON.stringify(error).includes('secret'), false);
      return true;
    });
    assert.equal((await listGoodsCostView(ctx)).total, 0);
  });
});

it('previews then atomically imports and replaces current values', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic' });
  const ctx = { account, accountId: account.id, config: {} };
  await withFile(JSON.stringify([row(), row({ spec: 'red' })]), async (file) => {
    assert.equal((await importGoodsCostView(ctx, { file })).inserted_count, 2);
    assert.equal((await listGoodsCostView(ctx)).total, 0);
    assert.equal((await importGoodsCostView(ctx, { file, confirm: true })).inserted_count, 2);
    assert.equal((await importGoodsCostView(ctx, { file, confirm: true })).updated_count, 2);
    assert.equal((await listGoodsCostView(ctx)).total, 2);
  });
});

it('maps unreadable files to path-free usage errors', async () => {
  await assert.rejects(() => parseCostImport('missing-private-file.json'), (error) => {
    assert.equal(error.code, 'E_COST_IMPORT_IO');
    assert.equal(error.exitCode, 2);
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  });
});

it('rejects invalid UTF-8 as a file-format error without leaking content', async () => {
  await withFile(Buffer.from([0xff, 0xfe, 0x7b]), async (file) => {
    await assert.rejects(() => parseCostImport(file), (error) => {
      assert.equal(error.code, 'E_COST_IMPORT_INVALID');
      assert.deepEqual(error.detail.row_errors, [{ row: null, field: null, message: '需要 UTF-8 编码的 JSON 文件' }]);
      return true;
    });
  });
});
