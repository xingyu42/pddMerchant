import assert from 'node:assert/strict';
import { it } from 'vitest';
import { authHumanRequired, reloginBlocked, reloginFailed, passwordLoginFormChanged, errorToEnvelope } from '../../src/infra/errors.js';
import { daemonNotRunning, daemonStartTimeout, daemonStopTimeout, consolePortInUse, PddCliError, mapErrorToExit } from '../../src/infra/errors.js';

it.each([
  [authHumanRequired, 'E_AUTH_HUMAN_REQUIRED', '账号登录需要人工完成验证', '执行 pdd console link 获取控制台链接并转给用户；不要在聊天中索要密码'],
  [reloginBlocked, 'E_AUTH_RELOGIN_BLOCKED', '账号自动重登已熔断', '执行 pdd console link 重设密码或解除熔断，或执行 pdd login --qr 扫码登录'],
  [reloginFailed, 'E_AUTH_RELOGIN_FAILED', '自动重登未完成', '稍后重试或执行 pdd login'],
  [passwordLoginFormChanged, 'E_PASSWORD_LOGIN_FORM_CHANGED', '登录页结构已变化，无法自动填写账密', '执行 pdd login --qr 扫码登录，并反馈此问题'],
])('builds safe AUTH errors %#', (factory, code, message, hint) => {
  const detail = { account: 'shop', reason: 'network_error' };
  const error = factory(detail);
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  assert.equal(error.hint, hint);
  assert.equal(error.exitCode, 3);
  assert.deepEqual(error.detail, detail);
  const unsafe = factory({ account: 'shop', password: 'private', login_name: 'private', url: 'private', pageText: 'private',
    reason: 'private', challenge: 'private', next_attempt_at: 'private' });
  assert.deepEqual(unsafe.detail, { account: 'shop' });
  assert.equal(JSON.stringify(errorToEnvelope('test', unsafe)).includes('private'), false);
});

it.each([
  [daemonNotRunning, 'E_DAEMON_NOT_RUNNING', 'daemon 未运行', '执行 pdd daemon start'],
  [daemonStartTimeout, 'E_DAEMON_START_TIMEOUT', '等待 daemon 启动超时', '执行 pdd daemon status 检查状态后重试'],
  [daemonStopTimeout, 'E_DAEMON_STOP_TIMEOUT', '等待 daemon 停止超时', '检查 daemon 所在主机的进程状态后重试'],
  [consolePortInUse, 'E_CONSOLE_PORT_IN_USE', '控制台端口已被占用', '修改 consolePort 配置或释放端口后执行 pdd daemon start'],
])('builds daemon errors with GENERAL exit codes %#', (factory, code, message, hint) => {
  const error = factory();
  assert.ok(error instanceof PddCliError);
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  assert.equal(error.hint, hint);
  assert.equal(error.detail, null);
  assert.equal(mapErrorToExit(error), 1);
  assert.equal(errorToEnvelope('daemon.test', error).meta.exit_code, 1);
});

it.each([daemonStopTimeout, consolePortInUse])('whitelists numeric and fixed-reason daemon details %#', (factory) => {
  const safe = { pid: 123, port: 47821, reason: 'foreign_host' };
  assert.deepEqual(factory(safe).detail, safe);
  const unsafe = { pid: 'private', port: 65536, reason: 'private', path: 'private', token: 'private',
    password: 'private', message: 'private', hostname: 'private', url: 'private' };
  const error = factory(unsafe);
  assert.deepEqual(error.detail, {});
  assert.equal(JSON.stringify(errorToEnvelope('daemon.test', error)).includes('private'), false);
  assert.deepEqual(factory({ pid: -1, port: 1.5 }).detail, {});
});
