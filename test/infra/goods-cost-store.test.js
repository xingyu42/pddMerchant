import { describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { insertAccount, removeAccount } from '../../src/infra/account-store.js';
import { all } from '../../src/infra/db.js';
import { listGoodsCosts, upsertGoodsCosts, removeGoodsCost } from '../../src/infra/goods-cost-store.js';

const entry = (overrides = {}) => ({ goods_id: '101', spec: null, purchase_fen: 820,
  packaging_fen: 50, courier_fen: 300, insurance_fen: 0, technical_service_fen: 0, ...overrides });
const account = (identity = '900001', kind = 'merchant') => insertAccount({ identity, kind, displayName: identity });
const scope = (accountId, mallId = '900001') => ({ accountId, mallId });

describe('goods cost store', () => {
  it('isolates accounts, malls, goods and exact specs, including long IDs', () => {
    const first = account();
    const second = account('900002');
    assert.deepEqual(listGoodsCosts(scope(first.id)), []);
    const entries = [entry(), entry({ spec: ' red ' }), entry({ goods_id: '90071992547409999' })];
    upsertGoodsCosts({ ...scope(first.id), entries });
    upsertGoodsCosts({ ...scope(first.id, '900003'), entries: [entry()] });
    upsertGoodsCosts({ ...scope(second.id), entries: [entry()] });
    assert.equal(listGoodsCosts(scope(first.id)).length, 3);
    assert.equal(listGoodsCosts({ ...scope(first.id), goodsId: '101' }).length, 2);
    assert.equal(removeGoodsCost({ ...scope(first.id), goodsId: '101', spec: null }).removed_count, 1);
    assert.equal(removeGoodsCost({ ...scope(first.id), goodsId: '101', spec: null }).removed_count, 0);
    assert.equal(listGoodsCosts(scope(second.id)).length, 1);
    assert.equal(listGoodsCosts(scope(first.id, '900003')).length, 1);
  });

  it('replaces the whole current row using the commit timestamp', () => {
    const stored = account();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const initial = upsertGoodsCosts({ ...scope(stored.id), entries: [entry()] });
    const next = upsertGoodsCosts({ ...scope(stored.id), entries: [entry({ purchase_fen: 0 })] });
    assert.equal(initial.inserted_count, 1);
    assert.equal(next.updated_count, 1);
    assert.equal(next.entries[0].purchase_fen, 0);
    assert.equal(next.entries[0].updated_at, initial.entries[0].updated_at);
  });

});

describe('goods cost transactions', () => {
  it('rolls back the entire batch on invalid money or missing accounts', () => {
    const stored = account();
    assert.throws(() => upsertGoodsCosts({ ...scope(stored.id), entries: [entry(), entry({ spec: 'bad', purchase_fen: -1 })] }), { code: 'E_COST_STORE_IO' });
    assert.deepEqual(listGoodsCosts(scope(stored.id)), []);
    assert.throws(() => upsertGoodsCosts({ ...scope(9999), entries: [entry()] }), { code: 'E_ACCOUNT_NOT_FOUND' });
    assert.throws(() => upsertGoodsCosts({ ...scope(account('consumer', 'consumer').id), entries: [entry()] }), { code: 'E_ACCOUNT_NOT_FOUND' });
  });

  it('rolls back an earlier SQL write when a later constraint fails', () => {
    const stored = account();
    assert.throws(() => upsertGoodsCosts({ ...scope(stored.id), entries: [entry(), entry({ goods_id: '' })] }), { code: 'E_COST_STORE_IO' });
    assert.deepEqual(listGoodsCosts(scope(stored.id)), []);
    assert.throws(() => upsertGoodsCosts({ ...scope(stored.id), entries: [entry({ purchase_fen: Number.MAX_SAFE_INTEGER + 1 })] }), { code: 'E_COST_STORE_IO' });
    assert.deepEqual(listGoodsCosts(scope(stored.id)), []);
  });

  it('cascades removal without reviving or reusing the old account', () => {
    const stored = account();
    upsertGoodsCosts({ ...scope(stored.id), entries: [entry()] });
    removeAccount(stored.slug);
    assert.deepEqual(all('SELECT * FROM goods_cost_entries'), []);
    const replacement = account();
    assert.notEqual(replacement.id, stored.id);
    assert.deepEqual(listGoodsCosts(scope(replacement.id)), []);
    assert.throws(() => upsertGoodsCosts({ ...scope(stored.id), entries: [entry()] }), { code: 'E_ACCOUNT_NOT_FOUND' });
  });
});
