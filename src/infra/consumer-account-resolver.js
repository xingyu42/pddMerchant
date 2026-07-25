import { PddCliError, ExitCodes } from './errors.js';
import { CONSUMER_AUTH_STATE_PATH, consumerAccountAuthStatePath } from './paths.js';
import {
  getConsumerAccount,
  loadConsumerAccountRegistry,
} from './consumer-account-registry.js';

function consumerAccountNotFound() {
  return new PddCliError({
    code: 'E_CONSUMER_ACCOUNT_NOT_FOUND',
    message: 'Consumer account was not found',
    hint: 'Run pdd login --consumer to register the account again',
    exitCode: ExitCodes.USAGE,
  });
}

function consumerAccountRequired() {
  return new PddCliError({
    code: 'E_CONSUMER_ACCOUNT_REQUIRED',
    message: 'Multiple consumer accounts are registered but none was selected',
    hint: 'Use --consumer-account <nickname-or-phone>',
    exitCode: ExitCodes.USAGE,
  });
}

export async function resolveConsumerAccountContext({ account, authStatePath } = {}) {
  const envPath = process.env.PDD_CONSUMER_AUTH_STATE_PATH;
  const explicitPath = authStatePath || (envPath && envPath.length > 0 ? envPath : null);
  if (explicitPath) {
    return { slug: null, displayName: null, authPath: explicitPath, account: null, source: 'explicit-path' };
  }

  const registry = await loadConsumerAccountRegistry();
  if (account) {
    const found = await getConsumerAccount(account, { allowDisplayName: true });
    if (!found) throw consumerAccountNotFound();
    return {
      slug: found.slug,
      displayName: found.displayName,
      authPath: consumerAccountAuthStatePath(found.slug),
      account: found,
      source: 'flag',
    };
  }

  if (!registry || Object.keys(registry.accounts).length === 0) {
    return {
      slug: null,
      displayName: null,
      authPath: CONSUMER_AUTH_STATE_PATH,
      account: null,
      source: 'unregistered-default',
    };
  }

  if (registry.defaultAccount && registry.accounts[registry.defaultAccount]) {
    const found = registry.accounts[registry.defaultAccount];
    return {
      slug: found.slug,
      displayName: found.displayName,
      authPath: consumerAccountAuthStatePath(found.slug),
      account: found,
      source: 'default',
    };
  }

  const enabled = Object.values(registry.accounts).filter((entry) => !entry.disabled);
  if (enabled.length === 1) {
    const found = enabled[0];
    return {
      slug: found.slug,
      displayName: found.displayName,
      authPath: consumerAccountAuthStatePath(found.slug),
      account: found,
      source: 'auto-single',
    };
  }
  if (enabled.length > 1) throw consumerAccountRequired();
  throw consumerAccountNotFound();
}
