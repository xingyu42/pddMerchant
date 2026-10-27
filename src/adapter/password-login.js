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
  slider: '[class*="slider"], [class*="geetest_slide"], [data-testid="slider"]',
  click: '[class*="click-captcha"], [class*="geetest_item"], [data-testid="click-captcha"]',
  sms: '[class*="sms-verify"], [class*="verify-code"], [data-testid="sms-verify"]',
  risk_confirm: '[class*="risk-confirm"], [data-testid="risk-confirm"]',
  unknown: '.captcha, [class*="captcha"], [data-testid="captcha"]',
});
export const PASSWORD_LOGIN_TEXTS = Object.freeze({
  account_locked: /账号.{0,8}(?:锁定|被锁|冻结|封禁)|账户.{0,8}(?:锁定|被锁|冻结)|登录次数过多|密码错误次数过多/,
  wrong_password: /密码(?:不正确|错误)|账号或密码错误|用户名或密码错误/,
  slider: /拖动.{0,12}滑块|滑动.{0,12}验证/,
  click: /依次点击|按顺序.{0,8}点选|点选.{0,8}验证/,
  sms: /请输入.{0,8}短信验证码|短信验证(?:[，。！：\s]|$)|验证码已发送/,
  risk_confirm: /风险确认|风控验证|账号存在风险|账户存在风险|安全验证/,
  sms_sent: /已发送|(?:重新获取|重新发送|重发)\s*[（(]?\s*\d+|\d+\s*(?:s|秒).{0,8}(?:后|重发|重新)/i,
});
const CHALLENGES = Object.freeze(['slider', 'click', 'sms', 'risk_confirm', 'unknown']);

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

function containerTokens(value) {
  return (value ?? '').split(/\s+/).filter((token) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(token) && !/\d{4}/.test(token));
}

// 与人工实验共用只读观测，仅返回元数据，避免暴露页面文字。
export async function inspectPasswordLoginPage(page, options = {}) {
  const task = { ...options, deadlineAt: options.deadlineAt ?? Date.now() + TIMEOUTS.LOGIN_PASSWORD };
  return taskStep(task, async () => {
    let challenge = null;
    let smsSent = false;
    const containers = [];
    const frames = page.frames();
    for (const frame of frames) {
      const text = options.includeText === false ? '' : await frame.locator('body').innerText({ timeout: budgetMs(task, 1000) });
      smsSent ||= PASSWORD_LOGIN_TEXTS.sms_sent.test(text);
      for (const type of CHALLENGES) {
        const element = await visibleElement(frame, PASSWORD_LOGIN_SELECTORS[type]);
        if (!element && !PASSWORD_LOGIN_TEXTS[type]?.test(text)) continue;
        challenge ??= type;
        if (element) containers.push({
          id: containerTokens(await element.getAttribute('id')),
          class: containerTokens(await element.getAttribute('class')),
        });
      }
      if (!challenge && PASSWORD_LOGIN_TEXTS.account_locked.test(text)) return { outcome: 'account_locked' };
      if (!challenge && PASSWORD_LOGIN_TEXTS.wrong_password.test(text)) return { outcome: 'wrong_password' };
    }
    return { challenge, sms_sent: smsSent, containers };
  });
}

async function fillLoginForm(page, credential, task) {
  const selector = PASSWORD_LOGIN_SELECTORS;
  const element = (key) => page.locator(selector[key]).first();
  const timeout = () => ({ timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) });
  const inspect = () => inspectPasswordLoginPage(page, { ...task, includeText: false });
  await taskStep(task, () => element('passwordTab').click(timeout()));
  let observed = await inspect();
  if (observed.challenge || observed.outcome) return observed;
  await taskStep(task, () => element('loginName').fill(credential.loginName, timeout()));
  observed = await inspect();
  if (observed.challenge || observed.outcome) return observed;
  await taskStep(task, () => element('password').fill(credential.password, timeout()));
  observed = await inspect();
  if (observed.challenge || observed.outcome) return observed;
  const agreement = await taskStep(task, () => visibleElement(page, selector.agreement));
  if (agreement) await acceptAgreement(agreement, task);
  await taskStep(task, () => element('submit').waitFor({ state: 'visible', ...timeout() }));
  observed = await inspect();
  if (observed.challenge || observed.outcome) return observed;
  return null;
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

async function waitForLogin(page, task) {
  while (Date.now() < task.deadlineAt) {
    assertAuthTask(task);
    try {
      const observed = await inspectPasswordLoginPage(page, task);
      if (observed.challenge) return { outcome: 'challenge', challenge: observed.challenge };
      if (observed.outcome) return { outcome: observed.outcome };
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
  try {
    await taskStep(task, () => page.goto(PASSWORD_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: budgetMs(task, TIMEOUTS.NAV) }));
    phase = 'form';
    const observed = await fillLoginForm(page, credential, task);
    if (observed) return observed.challenge ? { outcome: 'challenge', challenge: observed.challenge } : { outcome: observed.outcome };
    phase = 'submitted';
    await taskStep(task, () => page.locator(PASSWORD_LOGIN_SELECTORS.submit).first().click({ timeout: budgetMs(task, TIMEOUTS.ELEMENT_READY) }));
    return await waitForLogin(page, task);
  } catch {
    assertAuthTask({ signal: task.signal });
    if (phase === 'submitted' && Date.now() >= task.deadlineAt) return { outcome: 'challenge', challenge: 'unknown' };
    assertAuthTask(task);
    return { outcome: phase === 'form' ? 'form_changed' : 'network_error' };
  }
}
