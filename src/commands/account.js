import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import {
  removeAccount as removeAccountFromStore,
  listAccounts as listAccountsFromStore,
  setDefaultAccount as setDefaultInStore,
} from '../infra/account-store.js';
import { performHeadedLogin } from '../services/auth.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionMerchantLogin } from '../services/auth-account-storage.js';
import { getReloginSummary } from '../services/password-relogin.js';
import {
  toAccountAddedView, toAccountDefaultView, toAccountListView, toAccountRemovedView,
} from '../services/views/account.js';

export async function add(opts = {}) {
  const startedAt = Date.now();
  const log = getLogger();
  const deadlineAt = startedAt + (opts.timeoutMs ?? TIMEOUTS.LOGIN_HEADED);

  try {
    const provisioned = await provisionMerchantLogin(async (transaction) => {
      log.info('正在通过有头浏览器登录，请手动完成登录...');
      return performHeadedLogin({
        transaction,
        timeoutMs: opts.timeoutMs ?? TIMEOUTS.LOGIN_HEADED,
        signal: opts.signal,
        deadlineAt,
      });
    }, { signal: opts.signal, deadlineAt });
    const envelope = {
      ok: true,
      command: 'account.add',
      data: toAccountAddedView(provisioned.account),
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: ['credentials_not_saved_headed_login'] },
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
    await removeAccountFromStore(slug);

    const envelope = {
      ok: true,
      command: 'account.remove',
      data: toAccountRemovedView(slug),
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
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
    const accounts = await listAccountsFromStore({ includeDisabled: true });
    const data = toAccountListView(accounts.map((account) => ({
      ...account, relogin: getReloginSummary(account.id),
    })), accounts.find((account) => account.is_default)?.slug ?? null);

    const envelope = {
      ok: true,
      command: 'account.list',
      data,
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
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
    await setDefaultInStore(slug);

    const envelope = {
      ok: true,
      command: 'account.default',
      data: toAccountDefaultView(slug),
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('account.default', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}
