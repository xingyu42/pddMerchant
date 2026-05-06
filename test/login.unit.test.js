import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { resolveAuthPath } from '../src/commands/login.js';
import { resolveAccountContext } from '../src/infra/account-resolver.js';

// Regression guard for commit 9cb1f6e:
// Before the fix, `pdd login --qr` (no --account) returned undefined here and
// runInteractiveLogin fell back to data/auth-state.json, mismatching the path
// every business command reads via resolveAccountContext({}).
// This suite locks login's resolution in step with the resolver — if anyone
// reintroduces a divergent fallback, parity breaks and CI catches it.
describe('login.resolveAuthPath', () => {
  it('explicit authStatePath short-circuits without touching the resolver', async () => {
    const path = await resolveAuthPath({ authStatePath: '/explicit/auth.json' });
    assert.equal(path, '/explicit/auth.json');
  });

  it('no flags → identical path to resolveAccountContext({})', async () => {
    const fromLogin = await resolveAuthPath({});
    const fromResolver = await resolveAccountContext({});
    assert.equal(fromLogin, fromResolver.authPath);
    assert.ok(fromLogin, 'must never return undefined (the original bug)');
  });

  it('account flag forwarded to resolver — both reject identically for unknown slug', async () => {
    const unknown = '__nonexistent_login_test_slug__';
    let loginErr;
    let resolverErr;
    try { await resolveAuthPath({ account: unknown }); } catch (e) { loginErr = e; }
    try { await resolveAccountContext({ account: unknown }); } catch (e) { resolverErr = e; }
    assert.ok(loginErr, 'login must reject unknown account');
    assert.ok(resolverErr, 'resolver must reject unknown account');
    assert.equal(loginErr.code, resolverErr.code);
  });
});
