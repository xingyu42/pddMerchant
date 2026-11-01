import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, vi } from 'vitest';
import { attemptPasswordLogin, classifyAuthResponse, inspectPasswordLoginPage, PASSWORD_LOGIN_SELECTORS as selectors, PASSWORD_LOGIN_TEXTS, PASSWORD_LOGIN_URL } from '../../src/adapter/password-login.js';
import { classifyRateLimit } from '../../src/adapter/classify-rate-limit.js';
import { mockPasswordLogin } from '../../src/adapter/mock-dispatcher.js';
import { MERCHANT_CHECK_URL } from '../../src/adapter/merchant-auth-probe.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

const credential = { loginName: 'synthetic-login-private', password: 'synthetic-password-private' };

function fakePage(options = {}) {
  const calls = [];
  let submitted = false;
  const page = {
    calls,
    listeners: {},
    on(event, fn) { (this.listeners[event] ??= []).push(fn); },
    off(event, fn) { this.listeners[event] = (this.listeners[event] ?? []).filter((f) => f !== fn); },
    emit(event, arg) { (this.listeners[event] ?? []).forEach((fn) => fn(arg)); },
    goto: async (url) => { calls.push(['goto', url]); if (options.navigationError) throw options.navigationError; },
    frames: () => [page, ...(options.frames ?? [])],
    context: () => ({ cookies: async (urls) => { calls.push(['cookies', urls]); return submitted ? options.cookies ?? [] : []; } }),
    locator(selector) {
      const challenge = Object.entries(selectors).find(([key, value]) => value === selector && ['sms', 'slider', 'click', 'risk_confirm', 'unknown'].includes(key))?.[0];
      const present = challenge ? (submitted || options.preChallenge) && options.challenge === challenge : selector === selectors.agreement ? options.agreement : true;
      const element = {
        first: () => element,
        all: async () => present ? [element] : [],
        isVisible: async () => !options.hidden || options.hidden !== challenge,
        isChecked: async () => options.checked ?? false,
        check: async () => { calls.push(['check', selector, submitted]); },
        getAttribute: async (name) => {
          if (selector === selectors.agreement) {
            if (name === 'type') return options.customAgreement ? null : 'checkbox';
            if (name === 'aria-checked') return options.checked ? 'true' : 'false';
          }
          return name === 'id' ? 'captcha-root' : 'captcha-panel hidden-token-123456';
        },
        innerText: async () => {
          calls.push(['text', submitted]);
          if (submitted && options.pollErrors?.length) throw options.pollErrors.shift();
          return submitted ? options.text ?? '' : options.preText ?? '';
        },
        waitFor: async () => { if (options.missing === selector) throw new Error(credential.password); },
        fill: async (value) => {
          if (options.missing === selector) throw new Error(value);
          calls.push(['fill', selector, value]);
        },
        click: async () => {
          calls.push(['click', selector, submitted]);
          if (options.missing === selector) throw new Error(credential.loginName);
          if (selector === selectors.submit) {
            submitted = true;
            options.onSubmit?.();
            if (options.authResponse !== undefined) {
              page.emit('response', { url: () => 'https://mms.pinduoduo.com/janus/api/auth', json: async () => options.authResponse });
            }
          }
        },
      };
      return element;
    },
  };
  return page;
}

function live() { vi.stubEnv('PDD_TEST_ADAPTER', ''); }
function deadline() { return { deadlineAt: Date.now() + 2000 }; }
function submissionCount(page) { return page.calls.filter(([action, selector]) => action === 'click' && selector === selectors.submit).length; }

describe('password login browser adapter', () => {
  it('keeps selectors/texts frozen and only accepts a scoped nonempty exact PASS_ID', async () => {
    live();
    assert.ok(Object.isFrozen(selectors));
    assert.ok(Object.isFrozen(PASSWORD_LOGIN_TEXTS));
    const page = fakePage({ cookies: [{ name: 'PASS_ID', value: 'fixture-value' }], agreement: true });
    assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'success' });
    assert.deepEqual(page.calls[0], ['goto', PASSWORD_LOGIN_URL]);
    assert.deepEqual(page.calls.filter(([action]) => action === 'fill'), [
      ['fill', selectors.loginName, credential.loginName], ['fill', selectors.password, credential.password],
    ]);
    assert.equal(submissionCount(page), 1);
    assert.equal(page.calls.filter(([action]) => action === 'check').length, 1);
    assert.deepEqual(page.calls.find(([action]) => action === 'cookies')[1], [MERCHANT_CHECK_URL]);
  });

  it('leaves an already checked agreement alone', async () => {
    live();
    const page = fakePage({ cookies: [{ name: 'PASS_ID', value: 'fixture' }], agreement: true, checked: true });
    await attemptPasswordLogin(page, credential, deadline());
    assert.equal(page.calls.filter(([action]) => action === 'check').length, 0);
  });

  it('does not mistake the ordinary SMS login tab label for a challenge', async () => {
    live();
    const page = fakePage({ preText: '短信验证码登录', text: '短信验证码登录', cookies: [{ name: 'PASS_ID', value: 'fixture' }] });
    assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'success' });
  });

  for (const text of ['账号或密码错误', '账号已被锁定', '拖动滑块完成验证', '请依次点击图片', '请输入短信验证码', '账号存在风险', '验证码已发送']) {
    it(`submits despite static pre-submit text: ${text}`, async () => {
      live();
      const page = fakePage({ preText: text, cookies: [{ name: 'PASS_ID', value: 'fixture' }] });
      assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'success' });
      assert.equal(submissionCount(page), 1);
      assert.ok(page.calls.filter(([action]) => action === 'text').every(([, submitted]) => submitted));
    });
  }

  it('supports the historical custom agreement and does not toggle checked controls', async () => {
    live();
    for (const checked of [true, false]) {
      const page = fakePage({ cookies: [{ name: 'PASS_ID', value: 'fixture' }], agreement: true, customAgreement: true, checked });
      assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'success' });
      assert.equal(page.calls.filter(([action, selector]) => action === 'click' && selector === selectors.agreement).length, checked ? 0 : 1);
    }
  });

  for (const challenge of ['sms', 'slider', 'click', 'risk_confirm', 'unknown']) {
    it(`classifies ${challenge} with zero interactions after the only submission`, async () => {
      live();
      const page = fakePage({ challenge });
      assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'challenge', challenge });
      assert.equal(submissionCount(page), 1);
      assert.equal(page.calls.filter(([action, , after]) => ['click', 'check', 'press', 'fill'].includes(action) && after === true).length, 0);
    });
  }

  it('stops at challenges present before filling/submitting', async () => {
    live();
    const page = fakePage({ challenge: 'slider', preChallenge: true });
    assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'challenge', challenge: 'slider' });
    assert.equal(submissionCount(page), 0);
    assert.equal(page.calls.filter(([action]) => action === 'fill').length, 0);
  });

  for (const [text, outcome] of [
    ['账号或密码错误', 'wrong_password'], ['密码不正确', 'wrong_password'],
    ['账号已被锁定', 'account_locked'], ['密码错误次数过多', 'account_locked'],
    ['拖动滑块完成验证', 'slider'], ['请依次点击图片', 'click'],
    ['请输入短信验证码', 'sms'], ['账号存在风险', 'risk_confirm'],
  ]) {
    it(`classifies fixed text ${outcome} without returning page content`, async () => {
      live();
      const page = fakePage({ text: `${text} ${credential.loginName} ${credential.password}` });
      const result = await attemptPasswordLogin(page, credential, deadline());
      assert.deepEqual(result, ['wrong_password', 'account_locked'].includes(outcome) ? { outcome } : { outcome: 'challenge', challenge: outcome });
      assert.equal(submissionCount(page), 1);
    });
  }

  for (const missing of ['passwordTab', 'loginName', 'password', 'submit']) {
    it(`maps missing ${missing} to form_changed without exposing browser errors`, async () => {
      live();
      const result = await attemptPasswordLogin(fakePage({ missing: selectors[missing] }), credential, deadline());
      assert.deepEqual(result, { outcome: 'form_changed' });
      assert.ok(!JSON.stringify(result).includes(credential.password));
      assert.ok(!JSON.stringify(result).includes(credential.loginName));
    });
  }

  it('maps navigation failures to a fixed network category', async () => {
    live();
    assert.deepEqual(await attemptPasswordLogin(fakePage({ navigationError: new Error(credential.password) }), credential, deadline()), { outcome: 'network_error' });
  });

  for (const message of ['Page is navigating', 'Execution context was destroyed', 'Frame was detached']) {
    it(`continues polling after ${message} without resubmitting`, async () => {
      live();
      vi.useFakeTimers();
      const page = fakePage({ pollErrors: [new Error(message)], cookies: [{ name: 'PASS_ID', value: 'fixture' }] });
      const pending = attemptPasswordLogin(page, credential, deadline());
      await vi.advanceTimersByTimeAsync(2100);
      assert.deepEqual(await pending, { outcome: 'success' });
      assert.equal(submissionCount(page), 1);
      assert.equal(page.calls.filter(([action]) => action === 'text').length, 2);
    });
  }

  it('continues polling after a cookie read error without resubmitting', async () => {
    live();
    vi.useFakeTimers();
    const page = fakePage();
    const cookies = vi.fn().mockRejectedValueOnce(new Error(credential.password)).mockResolvedValue([{ name: 'PASS_ID', value: 'fixture' }]);
    page.context = () => ({ cookies });
    const pending = attemptPasswordLogin(page, credential, deadline());
    await vi.advanceTimersByTimeAsync(2100);
    assert.deepEqual(await pending, { outcome: 'success' });
    assert.equal(cookies.mock.calls.length, 2);
    assert.equal(submissionCount(page), 1);
  });

  it('returns unknown at the deadline after repeated poll errors without resubmitting', async () => {
    live();
    vi.useFakeTimers();
    const page = fakePage();
    page.context = () => ({ cookies: async () => { throw new Error(credential.loginName); } });
    const pending = attemptPasswordLogin(page, credential, deadline());
    await vi.advanceTimersByTimeAsync(2100);
    assert.deepEqual(await pending, { outcome: 'challenge', challenge: 'unknown' });
    assert.equal(submissionCount(page), 1);
  });

  it('preserves cancellation during a failed poll', async () => {
    live();
    const controller = new AbortController();
    const page = fakePage();
    page.context = () => ({ cookies: async () => { controller.abort(); throw new Error(credential.password); } });
    await assert.rejects(attemptPasswordLogin(page, credential, { signal: controller.signal, ...deadline() }), { code: 'E_AUTH_CANCELLED' });
    assert.equal(submissionCount(page), 1);
  });

  it('ignores hidden challenges and detects challenges inside frames', async () => {
    live();
    const hidden = fakePage({ challenge: 'slider', hidden: 'slider', cookies: [{ name: 'PASS_ID', value: 'fixture' }] });
    assert.deepEqual(await attemptPasswordLogin(hidden, credential, deadline()), { outcome: 'success' });
    const frame = fakePage({ challenge: 'click', preChallenge: true });
    const page = fakePage({ frames: [frame] });
    assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'challenge', challenge: 'click' });
  });

  it('returns only metadata for experiment observations, without page text or long numeric tokens', async () => {
    const page = fakePage({ challenge: 'sms', preChallenge: true, preText: `验证码已发送，60秒后重发 ${credential.password}` });
    assert.deepEqual(await inspectPasswordLoginPage(page, deadline()), {
      challenge: 'sms', sms_sent: true, containers: [{ id: ['captcha-root'], class: ['captcha-panel'] }],
    });
  });

  it('treats an unclassified submitted deadline as unknown and never retries submission', async () => {
    live();
    vi.useFakeTimers();
    const page = fakePage({ cookies: [{ name: 'OTHER_PASS_ID', value: 'value' }, { name: 'PASS_ID', value: '' }] });
    const pending = attemptPasswordLogin(page, credential, deadline());
    await vi.advanceTimersByTimeAsync(2100);
    assert.deepEqual(await pending, { outcome: 'challenge', challenge: 'unknown' });
    assert.equal(submissionCount(page), 1);
  });

  it('throws sanitized assertAuthTask errors for preflight timeout and cancellation', async () => {
    live();
    await assert.rejects(attemptPasswordLogin(null, credential, { deadlineAt: Date.now() }), { code: 'E_AUTH_TIMEOUT' });
    const controller = new AbortController();
    controller.abort(new Error(credential.password));
    await assert.rejects(attemptPasswordLogin(null, credential, { signal: controller.signal }), (error) => error.code === 'E_AUTH_CANCELLED' && !JSON.stringify(error).includes(credential.password));
  });

  it('responds to cancellation during a pending browser call', async () => {
    live();
    const controller = new AbortController();
    const page = fakePage();
    page.goto = () => new Promise(() => {});
    const pending = attemptPasswordLogin(page, credential, { signal: controller.signal, ...deadline() });
    controller.abort(new Error(credential.loginName));
    await assert.rejects(pending, { code: 'E_AUTH_CANCELLED' });
    assert.equal(submissionCount(page), 0);
  });

  it('preserves explicit timeout/cancellation signals after submission without further clicks', async () => {
    live();
    const controller = new AbortController();
    const page = fakePage({ onSubmit: () => controller.abort(new Error(credential.password)) });
    await assert.rejects(attemptPasswordLogin(page, credential, { signal: controller.signal, ...deadline() }), { code: 'E_AUTH_CANCELLED' });
    assert.equal(submissionCount(page), 1);
  });

  it('responds to timeout during form work with E_AUTH_TIMEOUT', async () => {
    live();
    vi.useFakeTimers();
    const page = fakePage();
    const locator = page.locator;
    page.locator = (selector) => {
      const element = locator(selector);
      if (selector === selectors.password) element.fill = () => new Promise(() => {});
      return element;
    };
    const pending = attemptPasswordLogin(page, credential, deadline());
    const rejection = assert.rejects(pending, { code: 'E_AUTH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(2100);
    await rejection;
    assert.equal(submissionCount(page), 0);
  });

  for (const [raw, expected] of [
    [{ error_code: 402 }, { outcome: 'wrong_password' }],
    [{ error_code: 8000000 }, { outcome: 'account_locked' }],
    [{ error_code: 54001 }, { outcome: 'challenge', challenge: 'unknown' }],
    [{ errorCode: 2000015 }, { outcome: 'challenge', challenge: 'sms' }],
    [{ errorCode: 2000020 }, { outcome: 'challenge', challenge: 'sms' }],
  ]) {
    it(`classifies auth response ${raw.error_code ?? raw.errorCode} from the response, overriding empty DOM text`, async () => {
      live();
      const page = fakePage({ authResponse: raw });
      assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), expected);
      assert.equal(submissionCount(page), 1);
    });
  }

  it('falls back to DOM/cookie detection when no auth response is captured', async () => {
    live();
    const page = fakePage({ cookies: [{ name: 'PASS_ID', value: 'fixture' }] });
    assert.deepEqual(await attemptPasswordLogin(page, credential, deadline()), { outcome: 'success' });
  });
});

describe('classifyAuthResponse', () => {
  for (const [raw, expected] of [
    [{ error_code: 402 }, { outcome: 'wrong_password' }],
    [{ error_code: 8000000 }, { outcome: 'account_locked' }],
    [{ error_code: 54001 }, { outcome: 'challenge', challenge: 'unknown' }],
    [{ error_code: 2000015 }, { outcome: 'challenge', challenge: 'sms' }],
    [{ error_code: 2000020 }, { outcome: 'challenge', challenge: 'sms' }],
    [{ error_code: 2000021 }, { outcome: 'challenge', challenge: 'sms' }],
    [{ errorCode: 402 }, { outcome: 'wrong_password' }],
  ]) {
    it(`maps ${raw.error_code ?? raw.errorCode} to ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(classifyAuthResponse(raw), expected);
    });
  }

  for (const raw of [null, undefined, {}, { error_code: 2000099 }, { error_code: null }, 'nope', { result: {} }]) {
    it(`returns null for unmapped/absent code ${JSON.stringify(raw)}`, () => {
      assert.equal(classifyAuthResponse(raw), null);
    });
  }

  it('keeps 54001 as a rate-limit class on the endpoint path, distinct from the login challenge mapping', () => {
    assert.equal(classifyRateLimit({ error_code: 54001 }), 'business-54001');
    assert.deepEqual(classifyAuthResponse({ error_code: 54001 }), { outcome: 'challenge', challenge: 'unknown' });
  });
});

describe('password login fixture', () => {
  it('defaults to success and never touches page or credentials', async () => {
    const forbidden = new Proxy({}, { get() { throw new Error('Unexpected browser/credential access'); } });
    assert.deepEqual(await attemptPasswordLogin(forbidden, forbidden), { outcome: 'success' });
  });

  for (const value of ['success', 'wrong_password', 'account_locked', 'form_changed', 'network_error', 'challenge:sms', 'challenge:slider', 'challenge:click', 'challenge:risk_confirm', 'challenge:unknown']) {
    it(`provides ${value} and traces only its fixed category`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pdd-password-trace-'));
      try {
        const trace = join(directory, 'attempts');
        vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', value);
        vi.stubEnv('PDD_TEST_PASSWORD_LOGIN_TRACE', trace);
        const result = await attemptPasswordLogin(null, credential);
        assert.deepEqual(result, value.startsWith('challenge:') ? { outcome: 'challenge', challenge: value.slice(10) } : { outcome: value });
        await mockPasswordLogin();
        assert.equal(await readFile(trace, 'utf8'), `${value}\n${value}\n`);
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  it('rejects invalid fixture configuration with sanitized E_USAGE', async () => {
    vi.stubEnv('PDD_TEST_PASSWORD_LOGIN', credential.password);
    await assert.rejects(attemptPasswordLogin(null, credential), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_USAGE');
      assert.equal(error.exitCode, ExitCodes.USAGE);
      assert.ok(!`${error.message} ${JSON.stringify(error)}`.includes(credential.password));
      return true;
    });
  });

  it('does not echo fixture filesystem errors', async () => {
    vi.stubEnv('PDD_TEST_PASSWORD_LOGIN_TRACE', join('missing-directory', credential.loginName, 'trace'));
    assert.deepEqual(await mockPasswordLogin(), { outcome: 'network_error' });
  });

  it('honors artificial delay, cancellation and deadlines', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PDD_TEST_PASSWORD_LOGIN_DELAY_MS', '1000');
    const pending = mockPasswordLogin();
    await vi.advanceTimersByTimeAsync(999);
    let completed = false;
    void (async () => { await pending; completed = true; })();
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(completed, false);
    await vi.advanceTimersByTimeAsync(1);
    assert.deepEqual(await pending, { outcome: 'success' });
    const controller = new AbortController();
    const cancelled = assert.rejects(mockPasswordLogin({ signal: controller.signal }), { code: 'E_AUTH_CANCELLED' });
    controller.abort();
    await cancelled;
    const expired = assert.rejects(mockPasswordLogin({ deadlineAt: Date.now() + 50 }), { code: 'E_AUTH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await expired;
  });
});
