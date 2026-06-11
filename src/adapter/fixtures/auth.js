// fixture auth provider（design D-4）：登录态校验、auth 刷新与密码登录 mock。
import { ENV_AUTH_INVALID, ENV_CONSUMER_AUTH_INVALID, loadFixture } from './core.js';

export function mockIsAuthValid() {
  return process.env[ENV_AUTH_INVALID] !== '1';
}

export function mockIsConsumerAuthValid() {
  return process.env[ENV_CONSUMER_AUTH_INVALID] !== '1';
}

export function mockRefreshAuth() {
  if (process.env[ENV_AUTH_INVALID] === '1') {
    return { success: false, reason: 'auth_expired', qrPngPath: null };
  }
  return { success: true, reason: 'refreshed' };
}

export function mockPasswordLogin({ mobile, authStatePath } = {}) {
  try {
    const fixture = loadFixture('endpoints/password-login.json');
    return { ...fixture, authStatePath: authStatePath ?? fixture.authStatePath };
  } catch {
    return {
      success: true,
      mode: 'password',
      authStatePath,
      mall: { id: '445301049', name: '测试店铺' },
      savedAt: new Date().toISOString(),
    };
  }
}
