import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { insertAccount, setDefaultAccount } from '../../src/infra/account-store.js';
import { resolveAccountContext, accountMetaForEnvelope } from '../../src/infra/account-resolver.js';
import { resolveConsumerAccountContext } from '../../src/infra/consumer-account-resolver.js';

it('resolves merchant flag, default and auto-single from the database only', async () => {
  vi.stubEnv('PDD_AUTH_STATE_PATH', 'ignored-synthetic-path');
  const first = insertAccount({ identity: '900001', displayName: 'First' });
  const sole = await resolveAccountContext();
  assert.equal(sole.source, 'auto-single');
  assert.equal(sole.accountId, first.id);
  assert.equal(Object.hasOwn(sole, 'authPath'), false);
  assert.deepEqual(accountMetaForEnvelope(sole), { account: first.slug, account_display_name: 'First', account_source: 'auto-single' });
  const second = insertAccount({ identity: '900002', displayName: 'Second' });
  await assert.rejects(resolveAccountContext(), { code: 'E_ACCOUNT_REQUIRED' });
  assert.equal((await resolveAccountContext({ account: second.slug })).source, 'flag');
  assert.equal((await resolveAccountContext({ accountId: first.id })).accountId, first.id);
  setDefaultAccount(second.slug);
  assert.equal((await resolveAccountContext()).source, 'default');
});

it('allows credential-free bootstrap and asks for login when authentication is required', async () => {
  assert.equal((await resolveAccountContext({ needsAuth: false })).accountId, null);
  await assert.rejects(resolveAccountContext(), { code: 'E_AUTH_EXPIRED' });
  await assert.rejects(resolveAccountContext({ account: 'missing' }), { code: 'E_ACCOUNT_NOT_FOUND' });
});

it('resolves consumer accounts independently and keeps the same three sources', async () => {
  vi.stubEnv('PDD_CONSUMER_AUTH_STATE_PATH', 'ignored-synthetic-path');
  assert.equal((await resolveConsumerAccountContext({ needsAuth: false })).accountId, null);
  await assert.rejects(resolveConsumerAccountContext(), { code: 'E_CONSUMER_ACCOUNT_NOT_FOUND' });
  const first = insertAccount({ kind: 'consumer', identity: 'user-1', displayName: 'Consumer' });
  assert.equal((await resolveConsumerAccountContext()).source, 'auto-single');
  assert.equal((await resolveConsumerAccountContext({ account: first.slug })).source, 'flag');
  insertAccount({ kind: 'consumer', identity: 'user-2', displayName: 'Other' });
  await assert.rejects(resolveConsumerAccountContext(), { code: 'E_CONSUMER_ACCOUNT_REQUIRED' });
  setDefaultAccount(first.slug, { kind: 'consumer' });
  assert.equal((await resolveConsumerAccountContext()).source, 'default');
});
