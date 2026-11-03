import { isMockEnabled, mockPasswordLogin } from './mock-dispatcher.js';
import { assertAuthTask } from './merchant-auth-storage.js';
import { hasPassId, MERCHANT_CHECK_URL } from './merchant-auth-probe.js';
import { abortableSleep, budgetMs } from '../infra/abort.js';
import { TIMEOUTS } from '../infra/timeouts.js';

export const PASSWORD_LOGIN_URL = 'https://mms.pinduoduo.com/login/';
export const PASSWORD_LOGIN_SELECTORS = Object.freeze({
  passwordTab: '[data-testid="login-tab-password"], .login-tab-password, div[class*="tab"]:has-text("账号登录"), div[class*="tab"]:has-text("密码登录")',
  loginName: 'input[placeholder*="手机号"], input[name="mobile"], input[type="tel"], input[data-testid="mobile-input"]',
  password: 'input[type="password"], input[placeholder*="密码"], input[name="password"], input[data-testid="password-input"]',
  agreement: 'input[type="checkbox"][class*="agree"], .agree-checkbox, [data-testid="agree-checkbox"]',
  submit: 'button[type="submit"], button:has-text("登录"), [data-testid="login-submit"]',
});
// 登录页自带的手机验证弹窗（见调研报告 R4）；打开时页面已自动发送短信。
export const SMS_SELECTORS = Object.freeze({
  input: '[class*="verify-phone-container"] input[placeholder*="短信验证码"]',
  confirm: '[class*="verify-phone-container"] button:has-text("确认")',
});
const SMS_RESPONSE_MS = 5000;

// 账密登录提交接口；成功时 PASS_ID 写入 Cookie，失败时响应带 error_code（见调研报告）。
export const PASSWORD_AUTH_URL = 'https://mms.pinduoduo.com/janus/api/auth';
// error_code → 登录结果。缺失或未收录的码返回 null，继续轮询至截止。
const AUTH_RESPONSE_OUTCOMES = Object.freeze({
  402: { outcome: 'wrong_password' },
  8000000: { outcome: 'account_locked' },
  54001: { outcome: 'challenge', challenge: 'unknown' },
  2000015: { outcome: 'challenge', challenge: 'sms' },
  2000020: { outcome: 'challenge', challenge: 'sms' },
  2000021: { outcome: 'challenge', challenge: 'sms' },
});

function authErrorCode(raw) {
  if (raw == null || typeof raw !== 'object') return null;
  const code = raw.error_code ?? raw.errorCode;
  return code == null ? null : String(code);
}

export function classifyAuthResponse(raw) {
  const code = authErrorCode(raw);
  if (code == null) return null;
  return AUTH_RESPONSE_OUTCOMES[code] ?? null;
}

function isAuthSubmitUrl(url) {
  try { return new URL(url).pathname === '/janus/api/auth'; }
  catch { return false; }
}

// 监听账密登录响应，只取最新的 error_code。读 body 的任何失败都吞掉，绝不外抛进登录流程。
function watchAuthResponse(page) {
  const state = { code: null, responded: false };
  const onResponse = (response) => {
    try {
      const url = typeof response?.url === 'function' ? response.url() : response?.url;
      if (!isAuthSubmitUrl(url)) return;
      Promise.resolve(response.json?.())
        .then((raw) => {
          state.responded = true;
          const code = authErrorCode(raw);
          if (code != null) state.code = code;
        })
        .catch(() => {});
    } catch { /* 监听器不得向页面抛出异常。 */ }
  };
  page.on('response', onResponse);
  return { state, detach: () => page.off('response', onResponse) };
}

// 包括非导航操作在内的浏览器调用均受时间预算约束，原始错误统一丢弃。
async function taskStep(task, action) {
  assertAuthTask(task);
  let timer;
  let onAbort;
  const interrupted = new Promise((resolve, reject) => {
    onAbort = () => {
      try { assertAuthTask(task); } catch (error) { reject(error); }
    };
    timer = setTimeout(() => {
      try { assertAuthTask({ ...task, deadlineAt: Date.now() }); } catch (error) { reject(error); }
    }, budgetMs(task));
    task.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([action(), interrupted]);
    assertAuthTask(task);
    return result;
  } finally {
    clearTimeout(timer);
    task.signal?.removeEventListener('abort', onAbort);
  }
}

async function visibleElement(frame, selector) {
  const elements = await frame.locator(selector).all();
  for (const element of elements) {
    if (await element.isVisible()) return element;
  }
  return null;
}

async function fillLoginForm(page, credential, task) {
  const selector = PASSWORD_LOGIN_SELECTORS;
  const element = (key) => page.locator(selector[key]).first();
  const timeout = () => ({ timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) });
  await taskStep(task, () => element('passwordTab').click(timeout()));
  await taskStep(task, () => element('loginName').fill(credential.loginName, timeout()));
  await taskStep(task, () => element('password').fill(credential.password, timeout()));
  const agreement = await taskStep(task, () => visibleElement(page, selector.agreement));
  if (agreement) await acceptAgreement(agreement, task);
  await taskStep(task, () => element('submit').waitFor({ state: 'visible', ...timeout() }));
}

async function acceptAgreement(element, task) {
  const native = await taskStep(task, () => element.getAttribute('type')) === 'checkbox';
  const checked = native ? await taskStep(task, () => element.isChecked())
    : await taskStep(task, () => element.getAttribute('aria-checked')) === 'true'
      || /(?:^|[-_\s])(?:checked|selected)(?:\s|$)/.test(await taskStep(task, () => element.getAttribute('class')) ?? '');
  if (checked) return;
  const options = { timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) };
  await taskStep(task, () => native ? element.check(options) : element.click(options));
}

async function waitForLogin(page, task, authState) {
  while (Date.now() < task.deadlineAt) {
    assertAuthTask(task);
    // 只依据接口响应和 PASS_ID Cookie 判定，不读页面元素或文案。
    const fromResponse = classifyAuthResponse({ errorCode: authState?.code });
    if (fromResponse) return fromResponse;
    try {
      const cookies = await taskStep(task, () => page.context().cookies([MERCHANT_CHECK_URL]));
      if (hasPassId(cookies)) return { outcome: 'success' };
    } catch {
      // 页面跳转可能暂时中断读取，保留取消和截止检查后继续轮询。
      assertAuthTask(task);
    }
    await taskStep(task, () => abortableSleep(budgetMs(task, 200), task.signal));
  }
  assertAuthTask({ signal: task.signal });
  return { outcome: 'challenge', challenge: 'unknown' };
}

export async function attemptPasswordLogin(page, credential, options = {}) {
  const task = { ...options, deadlineAt: options.deadlineAt ?? Date.now() + TIMEOUTS.LOGIN_PASSWORD };
  assertAuthTask(task);
  if (isMockEnabled()) return mockPasswordLogin(task);
  let phase = 'navigation';
  const watcher = watchAuthResponse(page);
  try {
    await taskStep(task, () => page.goto(PASSWORD_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: budgetMs(task, TIMEOUTS.NAV) }));
    phase = 'form';
    await fillLoginForm(page, credential, task);
    phase = 'submitted';
    await taskStep(task, () => page.locator(PASSWORD_LOGIN_SELECTORS.submit).first().click({ timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) }));
    return await waitForLogin(page, task, watcher.state);
  } catch {
    assertAuthTask({ signal: task.signal });
    if (phase === 'submitted' && Date.now() >= task.deadlineAt) return { outcome: 'challenge', challenge: 'unknown' };
    assertAuthTask(task);
    return { outcome: phase === 'form' ? 'form_changed' : 'network_error' };
  } finally {
    watcher.detach();
  }
}

async function waitForAuthResponse(state, task) {
  const until = Math.min(task.deadlineAt, Date.now() + SMS_RESPONSE_MS);
  while (!state.responded && Date.now() < until) {
    await taskStep(task, () => abortableSleep(Math.min(100, until - Date.now()), task.signal));
  }
}

// 把人输入的短信码填进登录页短信弹窗并点确认。只读这次提交的响应判断验证码是否错误（2000017），登录成功仍由 PASS_ID 判定。
export async function submitSmsCode(page, code, options = {}) {
  const task = { ...options, deadlineAt: options.deadlineAt ?? Date.now() + TIMEOUTS.ELEMENT_READY };
  assertAuthTask(task);
  const watcher = watchAuthResponse(page);
  try {
    const timeout = () => ({ timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) });
    try {
      await taskStep(task, () => page.locator(SMS_SELECTORS.input).first().fill(code, timeout()));
      await taskStep(task, () => page.locator(SMS_SELECTORS.confirm).first().click(timeout()));
    } catch {
      assertAuthTask(task);
      return { outcome: 'form_changed' };
    }
    await waitForAuthResponse(watcher.state, task);
    return { outcome: watcher.state.code === '2000017' ? 'wrong_code' : 'submitted' };
  } finally {
    watcher.detach();
  }
}
