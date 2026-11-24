import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import {
  listAccounts as listAccountsFromStore,
  setDefaultAccount as setDefaultInStore,
} from '../infra/account-store.js';
import { performHeadedLogin } from '../services/auth.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionMerchantLogin } from '../services/auth-account-storage.js';
import { getReloginSummary } from '../services/relogin-policy.js';
import { removeAccountView } from '../services/account-removal.js';
import { toAccountAddedView, toAccountDefaultView, toAccountListView } from '../services/views/account.js';

function clockNow(runtime) {
  return runtime?.clock?.now ? runtime.clock.now() : Date.now();
}

function emitAccount(runtime, envelope, opts) {
  const emitResult = runtime?.outputSink?.emit ?? emit;
  emitResult(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

export async function add(opts = {}, { runtime } = {}) {
  const startedAt = clockNow(runtime);
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
        runtime,
      });
    }, { signal: opts.signal, deadlineAt, seal: runtime?.seal, clock: runtime?.clock });
    return emitAccount(runtime, {
      ok: true,
      command: 'account.add',
      data: toAccountAddedView(provisioned.account),
      meta: { latency_ms: clockNow(runtime) - startedAt, exit_code: ExitCodes.OK, warnings: ['credentials_not_saved_headed_login'] },
    }, opts);
  } catch (err) {
    return emitAccount(runtime, errorToEnvelope('account.add', err, { latency_ms: clockNow(runtime) - startedAt }), opts);
  }
}

export async function remove(opts = {}, { runtime } = {}) {
  const startedAt = clockNow(runtime);
  try {
    const slug = opts.args?.[0] ?? opts.slug;
    if (!slug) {
      throw new PddCliError({ code: 'E_USAGE', message: '请指定要移除的账号 slug', exitCode: ExitCodes.USAGE });
    }
    return emitAccount(runtime, {
      ok: true,
      command: 'account.remove',
      data: removeAccountView(slug, { confirm: opts.confirm === true }),
      meta: { latency_ms: clockNow(runtime) - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    }, opts);
  } catch (err) {
    return emitAccount(runtime, errorToEnvelope('account.remove', err, { latency_ms: clockNow(runtime) - startedAt }), opts);
  }
}

export async function list(opts = {}, { runtime } = {}) {
  const startedAt = clockNow(runtime);
  try {
    const accounts = await listAccountsFromStore();
    const data = toAccountListView(accounts.map((account) => ({
      ...account, relogin: getReloginSummary(account.id),
    })), accounts.find((account) => account.is_default)?.slug ?? null);

    return emitAccount(runtime, {
      ok: true,
      command: 'account.list',
      data,
      meta: { latency_ms: clockNow(runtime) - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    }, opts);
  } catch (err) {
    return emitAccount(runtime, errorToEnvelope('account.list', err, { latency_ms: clockNow(runtime) - startedAt }), opts);
  }
}

export async function setDefault(opts = {}, { runtime } = {}) {
  const startedAt = clockNow(runtime);
  try {
    const slug = opts.args?.[0] ?? opts.slug;
    if (!slug) {
      throw new PddCliError({ code: 'E_USAGE', message: '请指定要设为默认的账号 slug', exitCode: ExitCodes.USAGE });
    }
    await setDefaultInStore(slug);

    return emitAccount(runtime, {
      ok: true,
      command: 'account.default',
      data: toAccountDefaultView(slug),
      meta: { latency_ms: clockNow(runtime) - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    }, opts);
  } catch (err) {
    return emitAccount(runtime, errorToEnvelope('account.default', err, { latency_ms: clockNow(runtime) - startedAt }), opts);
  }
}
