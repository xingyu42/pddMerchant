// fixture auth provider（design D-4）：登录态校验。
import { ENV_AUTH_INVALID, ENV_AUTH_INDETERMINATE, ENV_CONSUMER_AUTH_INVALID } from './core.js';

export function mockIsAuthValid() {
  return process.env[ENV_AUTH_INVALID] !== '1';
}

export function mockIsAuthIndeterminate() {
  return process.env[ENV_AUTH_INDETERMINATE] === '1';
}

export function mockIsConsumerAuthValid() {
  return process.env[ENV_CONSUMER_AUTH_INVALID] !== '1';
}
