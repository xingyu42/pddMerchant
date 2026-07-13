import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  acquireQingguoProxyLease,
  normalizeQingguoLease,
  readSourceProxyConfig,
} from '../../src/adapter/goods-publish/qingguo-proxy.js';

const CONFIG = {
  enabled: true,
  provider: 'qingguo',
  authKey: 'auth-secret',
  area: '350500,330700',
};

function successBody(overrides = {}) {
  return {
    code: 'SUCCESS',
    request_id: 'request-secret',
    data: [{
      server: '127.0.0.1:8080',
      deadline: '2030-01-01 00:00:00',
      area: '广东',
      isp: '电信',
      ...overrides,
    }],
  };
}

describe('readSourceProxyConfig', () => {
  it('keeps source proxy disabled by default', () => {
    assert.deepEqual(readSourceProxyConfig({}), { enabled: false, provider: null });
  });

  it('requires the Qingguo extraction AuthKey without echoing its value', () => {
    assert.throws(
      () => readSourceProxyConfig({ PDD_SOURCE_PROXY_PROVIDER: 'qingguo' }),
      (err) => {
        assert.equal(err.code, 'E_USAGE');
        assert.match(err.message, /PDD_QINGGUO_AUTH_KEY/);
        assert.equal(err.message.includes('auth-secret'), false);
        return true;
      },
    );
  });

  it('keeps random-area extraction when no area is configured', () => {
    assert.deepEqual(readSourceProxyConfig({
      PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
      PDD_QINGGUO_AUTH_KEY: 'auth-secret',
    }), {
      enabled: true,
      provider: 'qingguo',
      authKey: 'auth-secret',
    });
  });

  it('normalizes optional Qingguo area codes', () => {
    assert.deepEqual(readSourceProxyConfig({
      PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
      PDD_QINGGUO_AUTH_KEY: 'auth-secret',
      PDD_QINGGUO_AREA: '350500, 330700',
    }), {
      enabled: true,
      provider: 'qingguo',
      authKey: 'auth-secret',
      area: '350500,330700',
    });
  });

  it('rejects invalid Qingguo area codes before extraction', () => {
    assert.throws(
      () => readSourceProxyConfig({
        PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
        PDD_QINGGUO_AUTH_KEY: 'auth-secret',
        PDD_QINGGUO_AREA: '广东',
      }),
      (err) => err.code === 'E_USAGE' && err.exitCode === 2,
    );
  });

  it('rejects unsupported providers', () => {
    assert.throws(
      () => readSourceProxyConfig({ PDD_SOURCE_PROXY_PROVIDER: 'other' }),
      (err) => err.code === 'E_USAGE',
    );
  });
});

describe('normalizeQingguoLease', () => {
  it('returns a Playwright-compatible short lease without raw request id', () => {
    const lease = normalizeQingguoLease(successBody(), CONFIG, {
      now: Date.parse('2029-12-31T23:00:00+08:00'),
    });

    assert.equal(lease.server, 'http://127.0.0.1:8080');
    assert.equal(lease.area, '广东');
    assert.match(lease.requestIdHash, /^fp:[a-f0-9]{8}$/);
    assert.equal(JSON.stringify(lease).includes('request-secret'), false);
  });

  it('rejects leases with less than 30 seconds remaining', () => {
    assert.throws(
      () => normalizeQingguoLease(successBody({ deadline: 1_700_000_020 }), CONFIG, {
        now: 1_700_000_000_000,
      }),
      (err) => err.code === 'E_PROXY_UNAVAILABLE',
    );
  });

  it.each([
    ['INVALID_KEY', 'E_PROXY_AUTH', 3],
    ['BALANCE_INSUFFICIENT', 'E_PROXY_QUOTA', 6],
    ['REQUEST_LIMIT_EXCEEDED', 'E_PROXY_RATE_LIMIT', 4],
    ['NO_RESOURCE_FOUND', 'E_PROXY_UNAVAILABLE', 5],
  ])('maps provider code %s to %s', (providerCode, expectedCode, exitCode) => {
    assert.throws(
      () => normalizeQingguoLease({ code: providerCode, request_id: 'raw-id' }, CONFIG),
      (err) => {
        assert.equal(err.code, expectedCode);
        assert.equal(err.exitCode, exitCode);
        assert.equal(JSON.stringify(err.detail).includes('raw-id'), false);
        return true;
      },
    );
  });
});

describe('acquireQingguoProxyLease', () => {
  it('uses fixed one-node distinct extraction parameters and the configured area', async () => {
    let requestedUrl = null;
    const lease = await acquireQingguoProxyLease(CONFIG, {
      now: () => Date.parse('2029-12-31T23:00:00+08:00'),
      fetchImpl: async (url) => {
        requestedUrl = new URL(url);
        return { ok: true, status: 200, json: async () => successBody() };
      },
    });

    assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://share.proxy.qg.net/get');
    assert.equal(requestedUrl.searchParams.get('num'), '1');
    assert.equal(requestedUrl.searchParams.get('distinct'), 'true');
    assert.equal(requestedUrl.searchParams.get('key'), CONFIG.authKey);
    assert.equal(requestedUrl.searchParams.get('area'), CONFIG.area);
    assert.equal(lease.server, 'http://127.0.0.1:8080');
  });

  it('maps HTTP 407 to proxy auth failure', async () => {
    await assert.rejects(
      () => acquireQingguoProxyLease(CONFIG, {
        fetchImpl: async () => ({ ok: false, status: 407 }),
      }),
      (err) => err.code === 'E_PROXY_AUTH' && err.exitCode === 3,
    );
  });

  it('propagates an already-aborted command signal as E_TIMEOUT', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => acquireQingguoProxyLease(CONFIG, { signal: controller.signal }),
      (err) => err.code === 'E_TIMEOUT',
    );
  });
});
