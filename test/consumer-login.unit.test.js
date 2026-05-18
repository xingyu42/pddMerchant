import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { CONSUMER_LOGIN_URL } from '../src/adapter/consumer-qr-login.js';
import { CONSUMER_AUTH_STATE_PATH } from '../src/infra/paths.js';
import { CONSUMER_HOME } from '../src/adapter/auth-state.js';

describe('consumer-login constants', () => {
  it('CONSUMER_LOGIN_URL defaults to mobile.yangkeduo.com', () => {
    assert.ok(CONSUMER_LOGIN_URL.includes('yangkeduo.com'), `expected yangkeduo.com in ${CONSUMER_LOGIN_URL}`);
    assert.ok(CONSUMER_LOGIN_URL.includes('login'), `expected /login in ${CONSUMER_LOGIN_URL}`);
  });

  it('CONSUMER_AUTH_STATE_PATH ends with consumer-auth-state.json', () => {
    assert.ok(CONSUMER_AUTH_STATE_PATH.endsWith('consumer-auth-state.json'));
  });

  it('CONSUMER_HOME is mobile.yangkeduo.com', () => {
    assert.equal(CONSUMER_HOME, 'https://mobile.yangkeduo.com');
  });
});

describe('consumer-login: waitForConsumerLogin', () => {
  it('returns success when URL changes away from /login', async () => {
    const { waitForConsumerLogin } = await import('../src/adapter/consumer-qr-login.js');
    const mockPage = {
      waitForURL: async (predicate) => {
        const match = predicate(new URL('https://mobile.yangkeduo.com/'));
        if (!match) throw new Error('URL predicate did not match');
      },
      url: () => 'https://mobile.yangkeduo.com/',
    };
    const result = await waitForConsumerLogin(mockPage, { timeoutMs: 1000 });
    assert.equal(result.success, true);
    assert.equal(result.url, 'https://mobile.yangkeduo.com/');
  });

  it('returns failure on timeout', async () => {
    const { waitForConsumerLogin } = await import('../src/adapter/consumer-qr-login.js');
    const mockPage = {
      waitForURL: async () => { throw new Error('timeout'); },
      url: () => 'https://mobile.yangkeduo.com/login.html',
    };
    const result = await waitForConsumerLogin(mockPage, { timeoutMs: 100 });
    assert.equal(result.success, false);
    assert.ok(result.url.includes('/login'));
  });
});

describe('consumer-login: --consumer --password rejection', () => {
  it('run with consumer+password returns E_USAGE envelope', async () => {
    const { run } = await import('../src/commands/login.js');
    const envelope = await run({ consumer: true, password: true, json: true });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_USAGE');
    assert.ok(envelope.error.message.includes('消费端'));
  });
});

describe('consumer-login: mock mode', () => {
  it('isConsumerAuthValid returns true in mock mode (default)', async () => {
    const origAdapter = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';
    try {
      const { isConsumerAuthValid } = await import('../src/adapter/auth-state.js');
      const result = await isConsumerAuthValid(null);
      assert.equal(result, true);
    } finally {
      if (origAdapter === undefined) delete process.env.PDD_TEST_ADAPTER;
      else process.env.PDD_TEST_ADAPTER = origAdapter;
    }
  });
});
