import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { describe, it, vi } from 'vitest';
import { collectCheckCookies, selectCheckCookiesFromState, buildCheckHeader, classifyCheckLogin, classifyMerchantIdentity, probeCheckLogin, probeMerchantShop } from '../../src/adapter/merchant-auth-probe.js';

// Independent protocol expectations from docs/merchant-auth-protocol-verification.md.
const CHECK_URL = 'https://mms.pinduoduo.com/janus/api/checkLogin';
const IDENTITY_URL = 'https://mms.pinduoduo.com/earth/api/mallInfo/querySimpleCredential';
const SHOP_READ_URL = 'https://mms.pinduoduo.com/earth/api/mallInfo/queryMallAuditInfo';

const cookies = [{ name: 'PASS_ID', value: 'synthetic%2Fvalue==' }, { name: 'auxiliary', value: 'a,b==' }];

function mockTransport({ status = 200, body = { success: true, result: { login: true } }, chunks, error } = {}) {
  const requests = [];
  vi.spyOn(https, 'request').mockImplementation((url, options, onResponse) => {
    const request = new EventEmitter();
    request.destroy = vi.fn();
    request.end = () => queueMicrotask(() => {
      if (error) { request.emit('error', error); return; }
      const response = new EventEmitter();
      response.statusCode = status;
      response.destroy = vi.fn();
      onResponse(response);
      for (const chunk of chunks ?? [Buffer.from(JSON.stringify(typeof body === 'function' ? body(url) : body))]) response.emit('data', chunk);
      response.emit('end');
    });
    requests.push({ url, options, request });
    return request;
  });
  return requests;
}

describe('checkLogin cookies from saved state', () => {
  const cookie = { name: 'PASS_ID', value: 'synthetic-state-secret', domain: 'mms.pinduoduo.com', path: '/' };
  const now = Date.parse('2026-10-28T01:00:00.000Z');

  it.each([
    ['.MMS.PINDUODUO.COM', true], ['pinduoduo.com', true], ['.pinduoduo.com', true],
    ['other.pinduoduo.com', false], ['notpinduoduo.com', false], ['example.test', false],
    [undefined, false], ['', false],
  ])('matches the fixed host against domain %j (%j)', (domain, matches) => {
    const selected = selectCheckCookiesFromState({ cookies: [{ ...cookie, domain }] });
    assert.equal(selected.length, Number(matches));
  });

  it.each([
    ['/', true], ['/janus', true], ['/janus/', true], ['/janus/api', true],
    ['/janus/api/checkLogin', true], ['/janus/ap', false], ['/janus/api/checkLogin/extra', false],
    ['/earth', false], [undefined, true],
  ])('applies RFC 6265 path matching to %j (%j)', (path, matches) => {
    const selected = selectCheckCookiesFromState({ cookies: [{ ...cookie, path }] });
    assert.equal(selected.length, Number(matches));
  });

  it.each([
    [now / 1000 - 1, false], [now / 1000, false], [now / 1000 + 1, true], [-1, true], [undefined, true],
  ])('filters expiry %j at the supplied time (%j)', (expires, matches) => {
    const selected = selectCheckCookiesFromState({ cookies: [{ ...cookie, expires }] }, { now });
    assert.equal(selected.length, Number(matches));
  });

  it.each([true, false])('allows secure=%j on the HTTPS target and freezes detached cookies', (secure) => {
    const original = { ...cookie, secure, httpOnly: true, sameSite: 'Lax' };
    const selected = selectCheckCookiesFromState({ cookies: [original] });
    assert.deepEqual(selected, [original]);
    original.value = 'later-state';
    assert.equal(selected[0].value, cookie.value);
    assert.ok(Object.isFrozen(selected));
    assert.ok(Object.isFrozen(selected[0]));
    assert.equal(buildCheckHeader(selected), `PASS_ID=${cookie.value}`);
  });

  it.each([false, true])('keeps the longer path regardless of collection order (%j)', (reverse) => {
    const input = [cookie, { ...cookie, path: '/janus/api', value: 'specific-state' }];
    const selected = selectCheckCookiesFromState({ cookies: reverse ? input.reverse() : input });
    assert.equal(selected.length, 1);
    assert.equal(buildCheckHeader(selected), 'PASS_ID=specific-state');
  });

  it('leaves missing PASS_ID and invalid or partitioned values to the header validator', () => {
    for (const entry of [{ ...cookie, name: 'auxiliary' }, { ...cookie, value: 'bad;value' },
      { ...cookie, partitionKey: 'https://example.test' }]) {
      const selected = selectCheckCookiesFromState({ cookies: [entry] });
      if (entry.name === 'auxiliary') assert.ok(!selected.some((item) => item.name === 'PASS_ID'));
      assert.throws(() => buildCheckHeader(selected), { code: 'E_AUTH_CANDIDATE_INVALID' });
    }
  });

  it.each([undefined, null, {}, { cookies: null }, { cookies: {} }, { cookies: 'invalid' }])(
    'returns a frozen empty list for missing or non-array cookies (%j)', (state) => {
      const selected = selectCheckCookiesFromState(state);
      assert.deepEqual(selected, []);
      assert.ok(Object.isFrozen(selected));
    },
  );
});

describe('experimental merchant auth candidate', () => {
  it('uses the exact browser-scoped URL and freezes a detached snapshot', async () => {
    const original = structuredClone(cookies);
    const context = { cookies: vi.fn(async () => original) };
    const snapshot = await collectCheckCookies(context);
    assert.deepEqual(context.cookies.mock.calls, [[[CHECK_URL]]]);
    original[0].value = 'later-session';
    assert.equal(snapshot[0].value, 'synthetic%2Fvalue==');
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot[0]));
  });

  it('preserves equals, percent escapes, commas and collection order', () => {
    assert.equal(buildCheckHeader(cookies), 'PASS_ID=synthetic%2Fvalue==; auxiliary=a,b==');
  });

  it('rejects missing, empty and duplicate names', () => {
    for (const input of [[], [{ name: 'pass_id', value: 'x' }], [{ name: 'PASS_ID', value: '' }],
      [...cookies, cookies[0]], [...cookies, cookies[1]]]) {
      assert.throws(() => buildCheckHeader(input), { code: 'E_AUTH_CANDIDATE_INVALID' });
    }
  });

  it('rejects injection, invalid names, partitioning and oversized headers', () => {
    for (const value of ['x\r\nsecret', 'x y', 'x"y', 'x\\y', 'x;y', 'x\x7f', 'x\u0100', 'x,y']) {
      assert.throws(() => buildCheckHeader([{ name: 'PASS_ID', value }]), (error) => {
        assert.equal(error.code, 'E_AUTH_CANDIDATE_INVALID');
        assert.ok(!error.message.includes('secret'));
        assert.ok(!JSON.stringify(error.detail).includes(value));
        return true;
      });
    }
    assert.throws(() => buildCheckHeader([{ name: 'bad name', value: 'secret' }]));
    assert.throws(() => buildCheckHeader([{ name: 'PASS_ID', value: 'x', partitionKey: 'https://example.test' }]));
    assert.throws(() => buildCheckHeader([{ name: 'PASS_ID', value: 'x'.repeat(65536) }]));
  });
});

describe('observed fixed shop protocol', () => {
  it('accepts only the observed identity structure, not arbitrary mall fields', () => {
    const result = classifyMerchantIdentity(200, { success: true, result: {
      merchantMainSimpleVO: { mallId: 900001, mallName: ' Synthetic Shop ' },
      mobile: 'secret',
    } });
    assert.equal(result.verdict, 'verified');
    assert.deepEqual(result.identity, { mallId: '900001', displayName: 'Synthetic Shop' });
    assert.ok(!JSON.stringify(result).includes('secret'));
    for (const body of [{ success: true, result: { mall_id: 900001 } },
      { success: 'true', result: { merchantMainSimpleVO: { mallId: 900001, mallName: 'Shop' } } },
      ...[0, -1, '', {}, 9007199254740992].map((mallId) => ({ success: true, result: { merchantMainSimpleVO: { mallId, mallName: 'Shop' } } }))]) {
      assert.equal(classifyMerchantIdentity(200, body).verdict, 'indeterminate');
    }
  });

  it('selects each fixed URL separately and validates read-only access', async () => {
    const context = { cookies: vi.fn(async () => structuredClone(cookies)) };
    const requests = mockTransport({ body: (url) => url === IDENTITY_URL
      ? { success: true, result: { merchantMainSimpleVO: { mallId: 900001, mallName: 'Shop' } } }
      : { success: true, result: { auditInfoVOList: [] } } });
    const result = await probeMerchantShop(context, cookies);
    assert.equal(result.verdict, 'verified');
    assert.equal(result.identity.mallId, '900001');
    assert.equal(result.scope, 'shop_read');
    assert.deepEqual(context.cookies.mock.calls, [[[IDENTITY_URL]], [[SHOP_READ_URL]]]);
    assert.deepEqual(requests.map((entry) => entry.url), [IDENTITY_URL, SHOP_READ_URL]);
    assert.ok(requests.every((entry) => entry.options.method === 'GET'));
  });

  it('refuses mixed sessions before sending any shop request', async () => {
    const context = { cookies: vi.fn(async () => [{ name: 'PASS_ID', value: 'other-session' }]) };
    const requests = mockTransport();
    await assert.rejects(probeMerchantShop(context, cookies), (error) => {
      assert.equal(error.detail.reason, 'cross_target_pass_id_mismatch');
      return true;
    });
    assert.equal(requests.length, 0);
  });

  it('does not report a readable shop when identity or read permission is unconfirmed', async () => {
    const context = { cookies: vi.fn(async () => structuredClone(cookies)) };
    const requests = mockTransport({ body: { success: false, result: { mall_id: 900001 } } });
    assert.equal((await probeMerchantShop(context, cookies)).scope, 'shop_identity');
    assert.equal(requests.length, 1);
    vi.restoreAllMocks();
    mockTransport({ body: (url) => url === IDENTITY_URL
      ? { success: true, result: { merchantMainSimpleVO: { mallId: '900001', mallName: 'Shop' } } }
      : { success: false, result: { auditInfoVOList: [] } } });
    assert.equal((await probeMerchantShop(context, cookies)).verdict, 'failed');
  });
});

describe('strict GET checkLogin protocol', () => {
  it('requires HTTP 200, success true and boolean result.login', () => {
    assert.equal(classifyCheckLogin(200, { success: true, result: { login: true } }).verdict, 'verified');
    assert.equal(classifyCheckLogin(200, { success: true, result: { login: false } }).verdict, 'rejected');
    for (const body of [null, [], 'true', { result: { login: true } },
      { success: 'true', result: { login: true } }, { success: false, result: { login: false } },
      { success: true }, ...['true', 1, {}, null].map((login) => ({ success: true, result: { login } }))]) {
      assert.equal(classifyCheckLogin(200, body).verdict, 'indeterminate');
    }
    for (const status of [201, 204, 302, 401, 429, 500]) {
      assert.equal(classifyCheckLogin(status, { success: true, result: { login: true } }).verdict, 'indeterminate');
    }
  });

  it('sends an explicit frozen header with TLS verification and no CookieJar', async () => {
    const requests = mockTransport();
    const result = await probeCheckLogin(cookies);
    assert.equal(result.verdict, 'verified');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, CHECK_URL);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.rejectUnauthorized, true);
    assert.equal(requests[0].options.headers.Cookie, 'PASS_ID=synthetic%2Fvalue==; auxiliary=a,b==');
    assert.deepEqual(Object.keys(result).sort(), ['checked_at', 'http_status', 'reason', 'verdict']);
    assert.ok(Number.isFinite(Date.parse(result.checked_at)));
    assert.equal(requests[0].request.destroy.mock.calls.length, 1);
  });

  it('does not follow redirects or expose raw server data', async () => {
    const requests = mockTransport({ status: 302, body: { token: 'server-secret' } });
    const result = await probeCheckLogin(cookies);
    assert.equal(result.reason, 'http_status');
    assert.equal(result.http_status, 302);
    assert.equal(requests.length, 1);
    assert.ok(!JSON.stringify(result).includes('secret'));
  });

  it('does not retry explicit rejection or malformed responses', async () => {
    const requests = mockTransport({ body: { success: true, result: { login: false } } });
    assert.equal((await probeCheckLogin(cookies)).verdict, 'rejected');
    assert.equal(requests.length, 1);
    vi.restoreAllMocks();
    const malformed = mockTransport({ chunks: [Buffer.from('not JSON with a secret')] });
    assert.equal((await probeCheckLogin(cookies)).reason, 'invalid_json');
    assert.equal(malformed.length, 1);
  });

  it('bounds streamed response size without a Content-Length header', async () => {
    mockTransport({ chunks: [Buffer.alloc(4), Buffer.alloc(5)] });
    const result = await probeCheckLogin(cookies, { maxResponseBytes: 8 });
    assert.equal(result.reason, 'response_too_large');
    assert.equal(result.verdict, 'indeterminate');
  });

  it('does not repair invalid UTF-8 into a successful JSON response', async () => {
    mockTransport({ chunks: [Buffer.from('{"success":true,"result":{"login":true},"note":"'), Buffer.from([255]), Buffer.from('"}')] });
    assert.equal((await probeCheckLogin(cookies)).reason, 'invalid_json');
  });

  it('rejects bad candidates before opening a connection', async () => {
    const requests = mockTransport();
    await assert.rejects(probeCheckLogin([{ name: 'PASS_ID', value: 'x\r\ny' }]), { code: 'E_AUTH_CANDIDATE_INVALID' });
    assert.equal(requests.length, 0);
  });

  it('never converts TLS failure into rejection or emits raw errors', async () => {
    const requests = mockTransport({ error: Object.assign(new Error('Cookie: secret'), { code: 'CERT_HAS_EXPIRED' }) });
    const result = await probeCheckLogin(cookies);
    assert.equal(result.reason, 'tls_error');
    assert.equal(result.verdict, 'indeterminate');
    assert.equal(requests.length, 1);
    assert.ok(!JSON.stringify(result).includes('secret'));
  });

  it('retries temporary network failure once after 500ms', async () => {
    vi.useFakeTimers();
    const requests = mockTransport({ error: Object.assign(new Error('secret'), { code: 'ECONNRESET' }) });
    const pending = probeCheckLogin(cookies);
    await vi.advanceTimersByTimeAsync(499);
    assert.equal(requests.length, 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal((await pending).reason, 'network_error');
    assert.equal(requests.length, 2);
    assert.equal(vi.getTimerCount(), 0);
  });

  it('honors already cancelled or expired tasks before transport', async () => {
    const requests = mockTransport();
    const controller = new AbortController();
    controller.abort();
    assert.equal((await probeCheckLogin(cookies, { signal: controller.signal })).reason, 'cancelled');
    assert.equal((await probeCheckLogin(cookies, { deadlineAt: Date.now() - 1 })).reason, 'deadline');
    assert.equal(requests.length, 0);
  });

  it('cancels in-flight requests and removes the abort listener', async () => {
    const request = new EventEmitter();
    request.end = vi.fn(); request.destroy = vi.fn();
    vi.spyOn(https, 'request').mockReturnValue(request);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = probeCheckLogin(cookies, { signal: controller.signal });
    controller.abort();
    assert.equal((await pending).reason, 'cancelled');
    assert.equal(request.destroy.mock.calls.length, 1);
    assert.equal(remove.mock.calls.length, 1);
  });

  it('bounds unresponsive requests by the total deadline without retry', async () => {
    vi.useFakeTimers();
    const request = new EventEmitter();
    request.end = vi.fn(); request.destroy = vi.fn();
    const transport = vi.spyOn(https, 'request').mockReturnValue(request);
    const pending = probeCheckLogin(cookies, { deadlineAt: Date.now() + 20 });
    await vi.advanceTimersByTimeAsync(20);
    assert.equal((await pending).reason, 'deadline');
    assert.equal(transport.mock.calls.length, 1);
    assert.equal(vi.getTimerCount(), 0);
  });
});
