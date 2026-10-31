import { it } from 'vitest';
import assert from 'node:assert/strict';
import { insertAccount } from '../../src/infra/account-store.js';
import { listGoodsCostView, setGoodsCostView, removeGoodsCostView } from '../../src/services/goods-cost.js';
import { validateCostEntry } from '../../src/services/goods-cost-input.js';

const input = (overrides = {}) => ({ goods_id: '90071992547409999', purchase_yuan: '8.20', packaging_yuan: '0', courier_yuan: '3.00', ...overrides });
function context() {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic' });
  return { account, accountId: account.id, config: {} };
}

it.each([-1, '0.001', true, '1e2', 'NaN', 'Infinity', '999999999999999'])('rejects invalid money %s', (value) => {
  assert.throws(() => validateCostEntry(input({ purchase_yuan: value })), { code: 'E_USAGE' });
});

it('validates zero, precision, default and exact spec without losing IDs', () => {
  const normalized = validateCostEntry(input({ spec: ' red ', insurance_yuan: '0.01' }));
  assert.equal(normalized.goods_id, '90071992547409999');
  assert.equal(normalized.spec, ' red ');
  assert.equal(normalized.packaging_fen, 0);
  assert.equal(normalized.insurance_fen, 1);
  assert.equal(normalized.technical_service_fen, 0);
  for (const spec of ['', ' ', 'bad\0spec']) assert.throws(() => validateCostEntry(input({ spec })), { code: 'E_USAGE' });
});

it('previews without changing timestamps, replaces all fields and deletes precisely', async () => {
  const ctx = context();
  const preview = await setGoodsCostView(ctx, input());
  assert.equal(preview.entry.updated_at, null);
  assert.equal(preview.dry_run, true);
  assert.equal((await listGoodsCostView(ctx)).total, 0);
  await setGoodsCostView(ctx, { ...input({ insurance_yuan: '1' }), confirm: true });
  await setGoodsCostView(ctx, { ...input({ spec: ' red ' }), confirm: true });
  const saved = await setGoodsCostView(ctx, { ...input({ purchase_yuan: 0 }), confirm: true });
  assert.equal(saved.entry.insurance_yuan, 0);
  assert.equal(saved.entry.purchase_yuan, 0);
  assert.match(saved.entry.updated_at, /^\d{4}-\d{2}-\d{2} /);
  assert.equal((await removeGoodsCostView(ctx, { goods_id: input().goods_id })).matched_count, 1);
  assert.equal((await listGoodsCostView(ctx)).total, 2);
  await removeGoodsCostView(ctx, { goods_id: input().goods_id, confirm: true });
  assert.equal((await listGoodsCostView(ctx)).items[0].spec, ' red ');
});

it('requires a merchant account and uses explicit local mall isolation', async () => {
  await assert.rejects(() => listGoodsCostView({ config: {} }), { code: 'E_ACCOUNT_REQUIRED' });
  const ctx = context();
  await setGoodsCostView(ctx, { ...input(), confirm: true });
  assert.equal((await listGoodsCostView({ ...ctx, config: { mall: '900002' } })).total, 0);
  await assert.rejects(() => listGoodsCostView({ ...ctx, config: { mall: 'bad' } }), { code: 'E_USAGE' });
});
