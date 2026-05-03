import { AUTH_STATE_PATH, accountAuthStatePath } from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';
import { accountNotFound, accountRequired } from './errors.js';
import { loadAccountRegistry, getAccount, listAccounts } from './account-registry.js';

export async function resolveAccountContext({ account, authStatePath, needsAuth = true, warnings = [] } = {}) {
  const envAuthPath = process.env.PDD_AUTH_STATE_PATH;
  const hasExplicitPath = Boolean(authStatePath) || Boolean(envAuthPath);

  if (hasExplicitPath && account) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--account and PDD_AUTH_STATE_PATH / --auth-state-path are mutually exclusive',
      hint: 'Use one or the other, not both',
      exitCode: ExitCodes.USAGE,
    });
  }

  if (authStatePath) {
    return { slug: null, displayName: null, authPath: authStatePath, account: null, source: 'explicit-path', warnings };
  }

  const reg = await loadAccountRegistry().catch((err) => {
    if (err instanceof PddCliError) throw err;
    return null;
  });

  if (account) {
    if (!reg || Object.keys(reg.accounts).length === 0) {
      throw accountNotFound(account);
    }
    const found = await getAccount(account, { allowDisplayName: true });
    return {
      slug: found.slug,
      displayName: found.displayName,
      authPath: accountAuthStatePath(found.slug),
      account: found,
      source: 'flag',
      warnings,
    };
  }

  if (!reg || Object.keys(reg.accounts).length === 0) {
    return { slug: null, displayName: null, authPath: AUTH_STATE_PATH, account: null, source: 'legacy-fallback', warnings };
  }

  if (reg.defaultAccount && reg.accounts[reg.defaultAccount]) {
    const def = reg.accounts[reg.defaultAccount];
    return {
      slug: def.slug,
      displayName: def.displayName,
      authPath: accountAuthStatePath(def.slug),
      account: def,
      source: 'default',
      warnings,
    };
  }

  const enabled = Object.values(reg.accounts).filter((a) => !a.disabled);
  if (enabled.length === 1) {
    const sole = enabled[0];
    return {
      slug: sole.slug,
      displayName: sole.displayName,
      authPath: accountAuthStatePath(sole.slug),
      account: sole,
      source: 'auto-single',
      warnings,
    };
  }

  if (enabled.length > 1) {
    throw accountRequired();
  }

  return { slug: null, displayName: null, authPath: AUTH_STATE_PATH, account: null, source: 'legacy-fallback', warnings };
}

export function accountMetaForEnvelope(accountContext) {
  if (!accountContext || !accountContext.slug) return {};
  return {
    account: accountContext.slug,
    account_display_name: accountContext.displayName,
    account_source: accountContext.source,
  };
}
