import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { insertAccount, getAccount } from '../../src/infra/account-store.js';
import { removeConsoleAccount } from '../../src/services/console-accounts.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

it('rejects removal when confirm_name does not match display_name', () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop One' });
  for (const body of [undefined, {}, { confirm_name: 'Other' }, { confirm_name: 123 }]) {
    assert.throws(
      () => removeConsoleAccount(account.slug, body),
      { code: 'E_USAGE', httpStatus: 400 },
    );
  }
  assert.ok(getAccount(account.slug));
});

it('rejects removal with 409 E_CONSOLE_SESSION_STATE when isAccountLoggingIn returns true', () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop One' });
  const seen = [];
  assert.throws(
    () => removeConsoleAccount(account.slug, { confirm_name: 'Shop One' }, {
      isAccountLoggingIn: (accountId) => {
        seen.push(accountId);
        return accountId === account.id;
      },
    }),
    { code: 'E_CONSOLE_SESSION_STATE', httpStatus: 409 },
  );
  assert.deepEqual(seen, [account.id]);
  assert.ok(getAccount(account.slug));
});

it('removes account when confirmed and not logging in', () => {
  const account = insertAccount({ identity: '900001', displayName: 'Shop One' });
  const result = removeConsoleAccount(account.slug, { confirm_name: ' Shop One ' }, {
    isAccountLoggingIn: () => false,
  });
  assert.deepEqual(result, { ok: true, removed: true });
  assert.equal(getAccount(account.slug), null);
});

it('keeps console-accounts free of console-login and browser module imports', () => {
  const accountsUrl = new URL('../../src/services/console-accounts.js', import.meta.url).href;
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const resolved = nextResolve(specifier, context);
        if (/(?:console-login|patchright|adapter\\/browser\\.js)/.test(resolved.url)) {
          throw new Error('Forbidden dependency in console-accounts: ' + resolved.url);
        }
        return resolved;
      },
    });
    await import(${JSON.stringify(accountsUrl)});
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
});
