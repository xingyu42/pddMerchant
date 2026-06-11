// fixture account provider（design D-4）：账号注册表与凭据解密 mock。
import { loadFixture } from './core.js';

export function mockAccountRegistry() {
  try {
    return loadFixture('accounts.json');
  } catch {
    return null;
  }
}

export function mockDecryptCredential() {
  return { version: 1, mobile: '13800138000', password: 'mock-password', createdAt: '2026-05-03T00:00:00Z' };
}
