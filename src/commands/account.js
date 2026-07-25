import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import {
  loadAccountRegistry,
  removeAccount as removeAccountFromRegistry,
  listAccounts as listAccountsFromRegistry,
  setDefaultAccount as setDefaultInRegistry,
} from '../infra/account-registry.js';
import { performHeadedLogin } from '../services/auth.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { randomUUID } from 'node:crypto';
import { merchantPendingAuthStatePath } from '../infra/paths.js';
import { provisionMerchantAuth } from '../services/auth-account-storage.js';

export async function add(opts = {}) {
  const startedAt = Date.now();
  const log = getLogger();

  try {
    await loadAccountRegistry({ createIfMissing: true });
    const authPath = merchantPendingAuthStatePath(randomUUID());

    log.info('正在通过有头浏览器登录，请手动完成登录...');
    const loginResult = await performHeadedLogin({
      authStatePath: authPath,
      timeoutMs: opts.timeoutMs ?? TIMEOUTS.LOGIN_HEADED,
    });

    const provisioned = await provisionMerchantAuth(loginResult.path, loginResult.identity);
    const { slug, displayName, mallId } = provisioned.account;

    const envelope = {
      ok: true,
      command: 'account.add',
      data: { slug, displayName, mallId, hasCredential: false },
      meta: { latency_ms: Date.now() - startedAt, warnings: ['credentials_not_saved_headed_login'] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('account.add', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

export async function remove(opts = {}) {
  const startedAt = Date.now();
  try {
    const slug = opts.args?.[0] ?? opts.slug;
    if (!slug) {
      throw new PddCliError({ code: 'E_USAGE', message: '请指定要移除的账号 slug', exitCode: ExitCodes.USAGE });
    }
    await removeAccountFromRegistry(slug, { removeFiles: Boolean(opts.removeFiles) });

    const envelope = {
      ok: true,
      command: 'account.remove',
      data: { slug, removed: true },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('account.remove', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

export async function list(opts = {}) {
  const startedAt = Date.now();
  try {
    const accounts = await listAccountsFromRegistry({ includeDisabled: true });
    const reg = await loadAccountRegistry();

    const data = accounts.map((a) => ({
      slug: a.slug,
      displayName: a.displayName,
      mallId: a.mallId,
      isDefault: reg?.defaultAccount === a.slug,
      disabled: a.disabled,
      lastLoginAt: a.lastLoginAt,
      lastRefreshAt: a.lastRefreshAt,
      hasCredential: a.credential != null,
    }));

    const envelope = {
      ok: true,
      command: 'account.list',
      data,
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('account.list', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

export async function setDefault(opts = {}) {
  const startedAt = Date.now();
  try {
    const slug = opts.args?.[0] ?? opts.slug;
    if (!slug) {
      throw new PddCliError({ code: 'E_USAGE', message: '请指定要设为默认的账号 slug', exitCode: ExitCodes.USAGE });
    }
    await setDefaultInRegistry(slug);

    const envelope = {
      ok: true,
      command: 'account.default',
      data: { slug, isDefault: true },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('account.default', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}
