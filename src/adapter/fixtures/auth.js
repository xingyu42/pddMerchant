// 登录态校验的模拟实现（设计 D-4）。
import { ENV_AUTH_INVALID, ENV_AUTH_INDETERMINATE, ENV_CONSUMER_AUTH_INVALID } from './core.js';
import { appendFile } from 'node:fs/promises';
import { abortableSleep, budgetMs } from '../../infra/abort.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';

export function mockIsAuthValid() {
  return process.env[ENV_AUTH_INVALID] !== '1';
}

export function mockIsAuthIndeterminate() {
  return process.env[ENV_AUTH_INDETERMINATE] === '1';
}

export function hasFixtureRelogin(state) {
  return state?.cookies?.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN' && cookie.value === '1') ?? false;
}

// 成功获取的模拟材料仍经 merchant-auth 的候选校验和正式提交路径。
export function createFixtureReloginContext(mallId) {
  const state = { cookies: [{ name: 'PDD_FIXTURE_RELOGIN', value: '1', domain: '.pinduoduo.com', path: '/' }], origins: [] };
  return { fixtureMallId: mallId, storageState: async () => structuredClone(state) };
}

export function mockIsConsumerAuthValid() {
  return process.env[ENV_CONSUMER_AUTH_INVALID] !== '1';
}

export async function mockPasswordLogin(task = {}) {
  // 浏览器模块会导入此模拟入口，认证检查按需加载以避免循环依赖。
  const { assertAuthTask } = await import('../merchant-auth-storage.js');
  assertAuthTask(task);
  const value = process.env.PDD_TEST_PASSWORD_LOGIN ?? 'success';
  const challenge = /^challenge:(sms|slider|click|risk_confirm|unknown)$/.exec(value)?.[1];
  const outcome = ['success', 'wrong_password', 'account_locked', 'form_changed', 'network_error'].includes(value) ? value : null;
  if (!challenge && !outcome) throw new PddCliError({
    code: 'E_USAGE',
    message: 'PDD_TEST_PASSWORD_LOGIN 配置无效',
    exitCode: ExitCodes.USAGE,
  });
  const result = challenge ? { outcome: 'challenge', challenge } : { outcome };
  try {
    const trace = process.env.PDD_TEST_PASSWORD_LOGIN_TRACE;
    if (trace) await appendFile(trace, `${challenge ? `challenge:${challenge}` : outcome}\n`, { mode: 0o600 });
    const delay = Number(process.env.PDD_TEST_PASSWORD_LOGIN_DELAY_MS ?? 0);
    if (Number.isFinite(delay) && delay > 0) await abortableSleep(budgetMs(task, delay), task.signal);
    assertAuthTask(task);
    return result;
  } catch {
    assertAuthTask(task);
    return { outcome: 'network_error' };
  }
}
