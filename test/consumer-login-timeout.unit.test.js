import { vi, describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../src/adapter/browser.js', () => ({
  launchBrowser: vi.fn(async () => ({
    browser: { close: async () => {} },
    context: { storageState: async () => ({}) },
    page: {
      goto: async () => {},
      waitForURL: async () => { throw new Error('timeout'); },
      url: () => 'https://mobile.yangkeduo.com/login.html',
    },
  })),
  closeBrowser: vi.fn(async () => {}),
  createConsumerContext: vi.fn(async () => ({
    page: {
      waitForURL: async () => { throw new Error('timeout'); },
      url: () => 'https://mobile.yangkeduo.com/login.html',
    },
    context: { storageState: async () => ({}) },
    close: async () => {},
  })),
}));

vi.mock('../src/adapter/consumer-qr-login.js', () => ({
  captureConsumerQr: vi.fn(async () => Buffer.from('fake-qr-png')),
  waitForConsumerLogin: vi.fn(async () => ({
    success: false,
    url: 'https://mobile.yangkeduo.com/login.html',
  })),
}));

vi.mock('../src/adapter/qr-login.js', () => ({
  captureQrElement: vi.fn(async () => Buffer.from('fake-png')),
  saveQrPng: vi.fn(async () => '/tmp/fake-qr.png'),
  decodeQrContent: vi.fn(() => 'https://qr.example.com'),
  renderQrToStream: vi.fn(),
}));

vi.mock('../src/adapter/auth-state.js', () => ({
  saveAuthState: vi.fn(async () => '/tmp/fake-auth-state.json'),
  PDD_HOME: 'https://mms.pinduoduo.com',
}));

const scrapeCooldownMock = vi.hoisted(() => ({ recordSuccess: vi.fn() }));

vi.mock('../src/infra/scrape-cooldown.js', () => ({
  getSharedScrapeCooldown: () => scrapeCooldownMock,
}));

describe('consumer-login: E_AUTH_TIMEOUT path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performConsumerQrLogin throws E_AUTH_TIMEOUT when login fails', async () => {
    const { performConsumerQrLogin } = await import('../src/services/auth.js');
    await assert.rejects(
      () => performConsumerQrLogin({
        authStatePath: '/tmp/test-auth.json',
        timeoutMs: 1000,
        headed: false,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
        onQrCaptured: null,
      }),
      (err) => {
        assert.equal(err.code, 'E_AUTH_TIMEOUT');
        assert.equal(err.exitCode, 3);
        assert.ok(err.message.includes('消费端登录超时'));
        return true;
      },
    );
  });

  it('performConsumerHeadedLogin throws E_AUTH_TIMEOUT when login fails', async () => {
    const { performConsumerHeadedLogin } = await import('../src/services/auth.js');
    await assert.rejects(
      () => performConsumerHeadedLogin({
        authStatePath: '/tmp/test-auth.json',
        timeoutMs: 1000,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      }),
      (err) => {
        assert.equal(err.code, 'E_AUTH_TIMEOUT');
        assert.equal(err.exitCode, 3);
        assert.ok(err.message.includes('消费端登录超时'));
        return true;
      },
    );
  });

  it('E_AUTH_TIMEOUT has exitCode === ExitCodes.AUTH (3)', async () => {
    const { performConsumerQrLogin } = await import('../src/services/auth.js');
    try {
      await performConsumerQrLogin({
        authStatePath: '/tmp/test-auth.json',
        timeoutMs: 500,
        headed: false,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      });
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(err.constructor.name, 'PddCliError');
      assert.equal(err.exitCode, 3);
    }
  });

  it('successful consumer login clears the previous scrape cooldown', async () => {
    const { waitForConsumerLogin } = await import('../src/adapter/consumer-qr-login.js');
    waitForConsumerLogin.mockResolvedValueOnce({
      success: true,
      url: 'https://mobile.yangkeduo.com/',
    });
    const { performConsumerHeadedLogin } = await import('../src/services/auth.js');

    const result = await performConsumerHeadedLogin({
      authStatePath: '/tmp/test-auth.json',
      timeoutMs: 1000,
      consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
    });

    assert.equal(result.mode, 'consumer-headed');
    assert.equal(scrapeCooldownMock.recordSuccess.mock.calls.length, 1);
  });
});
