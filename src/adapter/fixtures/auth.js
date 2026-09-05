// fixture auth provider（design D-4）：登录态校验、auth 刷新 mock。
import { ENV_AUTH_INVALID, ENV_CONSUMER_AUTH_INVALID } from './core.js';

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
  return { success: true, reason: 'auth_valid' };
}
