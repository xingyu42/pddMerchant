import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { resolveLoginAuthTarget } from '../src/commands/init.js';

describe('login auth target', () => {
  it('explicit authStatePath short-circuits without touching the resolver', async () => {
    const target = await resolveLoginAuthTarget({ authStatePath: '/explicit/auth.json' }, 'fixed-token');
    assert.equal(target.authPath, '/explicit/auth.json');
    assert.equal(target.accountContext.source, 'explicit-path');
  });

  it('no flags writes to merchant pending storage before identity is known', async () => {
    const target = await resolveLoginAuthTarget({}, 'fixed-token');
    assert.ok(target.authPath.replaceAll('\\', '/').endsWith('/merchant/stores/_pending/fixed-token.json'));
    assert.equal(target.accountContext.source, 'pending');
  });

  it('account flag still rejects an unknown registered account', async () => {
    const unknown = '__nonexistent_login_test_slug__';
    await assert.rejects(
      resolveLoginAuthTarget({ account: unknown }, 'fixed-token'),
      (error) => error.code === 'E_ACCOUNT_NOT_FOUND',
    );
  });
});
