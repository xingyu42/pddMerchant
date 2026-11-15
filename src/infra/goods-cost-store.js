import { all, run, transaction } from './db.js';
import { getAccountById } from './account-store.js';
import { accountNotFound, PddCliError, ExitCodes } from './errors.js';

// insurance_fen 列已停用：保留在表中（不升级 user_version），不读不写，插入时取默认值 0。
const MONEY_COLUMNS = ['purchase_fen', 'packaging_fen', 'courier_fen', 'technical_service_fen'];

function storageOperation(callback) {
  try { return callback(); }
  catch (error) {
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_COST_STORE_IO', message: '商品成本存储暂不可用', exitCode: ExitCodes.GENERAL });
  }
}

function assertMerchant(accountId) {
  if (getAccountById(accountId)?.kind !== 'merchant') throw accountNotFound(String(accountId));
}

function toEntry(row) {
  return { ...row, spec: row.spec === '' ? null : row.spec };
}

export function listGoodsCosts({ accountId, mallId, goodsId }) {
  return storageOperation(() => {
    assertMerchant(accountId);
    const params = [accountId, mallId, ...(goodsId == null ? [] : [goodsId])];
    return all(`SELECT goods_id, spec, purchase_fen, packaging_fen, courier_fen, technical_service_fen, updated_at
      FROM goods_cost_entries WHERE account_id = ? AND mall_id = ?
      ${goodsId == null ? '' : 'AND goods_id = ?'} ORDER BY goods_id, spec`, ...params).map(toEntry);
  });
}

function saveEntry(scope, entry, updatedAt) {
  if (MONEY_COLUMNS.some((column) => !Number.isSafeInteger(entry[column]) || entry[column] < 0)) {
    throw new Error('invalid cost');
  }
  const values = MONEY_COLUMNS.map((column) => entry[column]);
  run(`INSERT INTO goods_cost_entries (account_id, mall_id, goods_id, spec, purchase_fen, packaging_fen,
    courier_fen, technical_service_fen, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, mall_id, goods_id, spec) DO UPDATE SET
    purchase_fen = excluded.purchase_fen, packaging_fen = excluded.packaging_fen, courier_fen = excluded.courier_fen,
    technical_service_fen = excluded.technical_service_fen, updated_at = excluded.updated_at`,
  scope.accountId, scope.mallId, entry.goods_id, entry.spec ?? '', ...values, updatedAt);
  return { ...entry, updated_at: updatedAt };
}

export function upsertGoodsCosts({ accountId, mallId, entries }) {
  return storageOperation(() => transaction(() => {
    assertMerchant(accountId);
    const existing = listGoodsCosts({ accountId, mallId });
    const keys = new Set(existing.map((entry) => JSON.stringify([entry.goods_id, entry.spec])));
    const updatedCount = entries.filter((entry) => keys.has(JSON.stringify([entry.goods_id, entry.spec]))).length;
    const updatedAt = new Date().toISOString();
    const saved = entries.map((entry) => saveEntry({ accountId, mallId }, entry, updatedAt));
    return { entries: saved, inserted_count: entries.length - updatedCount, updated_count: updatedCount };
  }));
}

export function removeGoodsCost({ accountId, mallId, goodsId, spec }) {
  return storageOperation(() => transaction(() => {
    assertMerchant(accountId);
    const result = run('DELETE FROM goods_cost_entries WHERE account_id = ? AND mall_id = ? AND goods_id = ? AND spec = ?',
      accountId, mallId, goodsId, spec ?? '');
    return { matched_count: Number(result.changes), removed_count: Number(result.changes) };
  }));
}
