import { createInterface } from 'node:readline';
import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import {
  loadAccountRegistry,
  upsertAccount,
  removeAccount as removeAccountFromRegistry,
  listAccounts as listAccountsFromRegistry,
  setDefaultAccount as setDefaultInRegistry,
  slugifyAccountName,
} from '../infra/account-registry.js';
import { encryptCredential, resolveMasterPassword } from '../infra/credential-vault.js';
import { loginWithPassword } from '../adapter/password-login.js';
import { accountAuthStatePath } from '../infra/paths.js';

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function add(opts = {}) {
  const startedAt = Date.now();
  const log = getLogger();

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const mobile = await prompt(rl, '手机号: ');
    const password = await prompt(rl, '密码: ');
    rl.close();

    if (!mobile || !password) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: '手机号和密码不能为空',
        exitCode: ExitCodes.USAGE,
      });
    }

    const reg = await loadAccountRegistry({ createIfMissing: true });
    const existingSlugs = new Set(Object.keys(reg.accounts));
    const tempSlug = `temp-${Date.now()}`;
    const authPath = accountAuthStatePath(tempSlug);

    log.info('正在登录...');
    const loginResult = await loginWithPassword({
      mobile,
      password,
      authStatePath: authPath,
      headed: opts.headed,
      log,
    });

    const displayName = loginResult.mall?.name ?? `account-${Date.now()}`;
    const mallId = loginResult.mall?.id ?? null;
    const slug = slugifyAccountName(displayName, { existingSlugs, mallId });

    const { rename } = await import('node:fs/promises');
    const { accountDir } = await import('../infra/paths.js');
    const { ensureDir } = await import('../infra/paths.js');
    const finalDir = accountDir(slug);
    const finalAuthPath = accountAuthStatePath(slug);
    await ensureDir(finalDir);

    if (tempSlug !== slug) {
      const { dirname } = await import('node:path');
      await rename(authPath, finalAuthPath).catch(async () => {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(authPath, finalAuthPath);
      });
    }

    let credential = null;
    const masterPwd = resolveMasterPassword();
    if (masterPwd) {
      credential = await encryptCredential(
        { version: 1, mobile, password, createdAt: new Date().toISOString() },
        masterPwd,
        { accountSlug: slug },
      );
    }

    const isFirst = Object.keys(reg.accounts).length === 0;
    const account = await upsertAccount({
      slug,
      displayName,
      mallId,
      credential,
      lastLoginAt: new Date().toISOString(),
    }, { setDefault: isFirst });

    const envelope = {
      ok: true,
      command: 'account.add',
      data: { slug, displayName, mallId, hasCredential: credential !== null },
      meta: { latency_ms: Date.now() - startedAt, warnings: masterPwd ? [] : ['no_master_password_credentials_not_saved'] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    rl.close();
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
