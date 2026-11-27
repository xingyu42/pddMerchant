import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach } from 'vitest';
import { createCliSandbox } from './isolated-cli.js';
import { seedDb, DEFAULT_ACCOUNT } from './seed-db.js';
import { assertEnvelopeShape } from './envelope-assertions.js';
import { closeDatabase, getDatabasePath, openDatabase } from '../../src/infra/db.js';
import { getReloginState, listPendingActions } from '../../src/infra/account-store.js';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = join(projectRoot, 'bin/pdd.js');
const preloadUrl = new URL('./offline-preload.js', import.meta.url).href;
export const credential = { loginName: 'synthetic-login-p3-52482', password: 'synthetic-password-p3-734942' };
export const secondAccount = { slug: 'second-shop', display_name: 'Second Shop', identity: '900002' };

function parseResult(result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1);
  const envelope = JSON.parse(result.stdout);
  assertEnvelopeShape(envelope, { exitCode: result.status });
  return { ...result, envelope };
}

export function actionWarnings(result) {
  return result.envelope.meta.warnings.filter((warning) => warning.code === 'account_action_required');
}

// 密码自动重登 e2e 的共享沙箱：在测试文件顶层调用一次，注册每条用例独立的沙箱与临时 DB。
// 用例在子进程之间于进程内读取同一 DB，所以单个文件内保持串行；按主题拆成多个文件以并行占用多核。
export function usePasswordReloginSandbox() {
  let sandbox;
  let previousDatabase;

  beforeEach(() => {
    previousDatabase = getDatabasePath();
    sandbox = createCliSandbox();
    Object.assign(sandbox.env, { PDD_TEST_AUTH_INVALID: '1', PDD_TEST_PASSWORD_LOGIN_TRACE: join(sandbox.root, 'attempts.log') });
  });

  afterEach(() => {
    closeDatabase();
    sandbox.dispose();
    openDatabase(previousDatabase);
  });

  function seed({ accounts = [DEFAULT_ACCOUNT], password = true } = {}) {
    seedDb(sandbox.env.PDD_DB_PATH, {
      accounts,
      authStates: accounts.map((account) => ({ slug: account.slug, state: { cookies: [], origins: [] } })),
      passwordCredentials: password ? accounts.map((account) => ({ slug: account.slug, ...credential })) : [],
    });
  }

  function database() { openDatabase(sandbox.env.PDD_DB_PATH); }
  function openActions(accountId = 1) { database(); return listPendingActions(accountId).filter((action) => action.status === 'open'); }
  function state(accountId = 1) { database(); return getReloginState(accountId); }
  function attempts() {
    const path = sandbox.env.PDD_TEST_PASSWORD_LOGIN_TRACE;
    return existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
  }

  function cli(args = ['shops', 'list'], env = {}) {
    return parseResult(spawnSync(process.execPath, ['--import', preloadUrl, cliPath, ...args, '--json'], {
      cwd: sandbox.root, env: { ...sandbox.env, ...env }, encoding: 'utf8', timeout: 30000, windowsHide: true,
    }));
  }

  function startCli(args = ['shops', 'list'], env = {}) {
    const child = spawn(process.execPath, ['--import', preloadUrl, cliPath, ...args, '--json'], {
      cwd: sandbox.root, env: { ...sandbox.env, ...env }, windowsHide: true,
    });
    const result = new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (status, signal) => {
        try { resolve(parseResult({ stdout, stderr, status, signal })); }
        catch (error) { reject(error); }
      });
    });
    return { child, result };
  }

  return { sandbox: () => sandbox, seed, database, openActions, state, attempts, cli, startCli };
}
