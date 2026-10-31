import { it } from 'vitest';
import assert from 'node:assert/strict';
import { executeSingle } from '../../src/commands/_runner.js';
import { insertAccount } from '../../src/infra/account-store.js';

const spec = (overrides = {}) => ({ name: 'local.test', needsAuth: false, needsBrowser: false, needsMall: 'stored',
  async run(ctx) { return { headline: ['本地测试'], account_id: ctx.accountId, has_page: ctx.page !== null }; }, ...overrides });

it('keeps local account resolution opt-in and preserves old no-browser commands', async () => {
  const account = insertAccount({ identity: '900001', displayName: 'Synthetic' });
  const original = await executeSingle(spec(), {}, { emitResult: false });
  assert.equal(original.data.account_id, null);
  const selected = await executeSingle(spec({ needsAccount: true }), {}, { emitResult: false });
  assert.equal(selected.data.account_id, account.id);
  assert.equal(selected.data.has_page, false);
  assert.equal(selected.meta.account, account.slug);
});

it('rejects missing and ambiguous local merchant accounts', async () => {
  await assert.rejects(() => executeSingle(spec({ needsAccount: true }), {}, { emitResult: false }), { code: 'E_ACCOUNT_REQUIRED' });
  insertAccount({ identity: '900001', displayName: 'One' });
  insertAccount({ identity: '900002', displayName: 'Two' });
  await assert.rejects(() => executeSingle(spec({ needsAccount: true }), {}, { emitResult: false }), { code: 'E_ACCOUNT_REQUIRED' });
});
