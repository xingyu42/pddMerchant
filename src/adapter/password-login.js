import { launchBrowser, closeBrowser } from './browser.js';
import { saveAuthState } from './auth-state.js';
import { currentMall } from './mall-reader.js';
import { authChallengeRequired, passwordLoginFormChanged } from '../infra/errors.js';
import { isMockEnabled, mockPasswordLogin } from './mock-dispatcher.js';
import { getLogger } from '../infra/logger.js';
import { ensureDir } from '../infra/paths.js';
import { dirname } from 'node:path';

const LOGIN_URL = 'https://mms.pinduoduo.com/login/';

const SEL = {
  passwordTab: '[data-testid="login-tab-password"], .login-tab-password, div[class*="tab"]:has-text("账号登录"), div[class*="tab"]:has-text("密码登录")',
  mobileInput: 'input[placeholder*="手机号"], input[name="mobile"], input[type="tel"], input[data-testid="mobile-input"]',
  passwordInput: 'input[type="password"], input[placeholder*="密码"], input[name="password"], input[data-testid="password-input"]',
  agreement: 'input[type="checkbox"][class*="agree"], .agree-checkbox, [data-testid="agree-checkbox"]',
  submitBtn: 'button[type="submit"], button:has-text("登录"), [data-testid="login-submit"]',
  captcha: '.captcha, [class*="captcha"], [class*="slider"], [data-testid="captcha"]',
  smsVerify: '[class*="sms-verify"], [class*="verify-code"], [data-testid="sms-verify"]',
};

async function tryClick(page, selector, { timeout = 3000 } = {}) {
  try {
    const el = await page.waitForSelector(selector, { timeout, state: 'visible' });
    if (el) await el.click();
    return true;
  } catch {
    return false;
  }
}

export async function loginWithPassword({ mobile, password, authStatePath, headed = false, timeoutMs = 60000, signal, log }) {
  if (isMockEnabled()) return mockPasswordLogin({ mobile, authStatePath });

  log = log ?? getLogger();
  let browser = null;

  try {
    const result = await launchBrowser({ headed, storageStatePath: null });
    browser = result.browser;
    const { context, page } = result;

    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    await tryClick(page, SEL.passwordTab);
    await page.waitForTimeout(500);

    const mobileEl = await page.waitForSelector(SEL.mobileInput, { timeout: 10000, state: 'visible' }).catch(() => null);
    if (!mobileEl) throw passwordLoginFormChanged('mobile input not found');

    await mobileEl.fill(mobile);

    const pwdEl = await page.waitForSelector(SEL.passwordInput, { timeout: 5000, state: 'visible' }).catch(() => null);
    if (!pwdEl) throw passwordLoginFormChanged('password input not found');

    await pwdEl.fill(password);

    await tryClick(page, SEL.agreement, { timeout: 2000 });

    const submitEl = await page.waitForSelector(SEL.submitBtn, { timeout: 5000, state: 'visible' }).catch(() => null);
    if (!submitEl) throw passwordLoginFormChanged('submit button not found');

    await submitEl.click();

    await page.waitForTimeout(2000);

    const hasCaptcha = await page.$(SEL.captcha);
    const hasSms = await page.$(SEL.smsVerify);
    if (hasCaptcha) throw authChallengeRequired('captcha/slider');
    if (hasSms) throw authChallengeRequired('SMS verification');

    try {
      await page.waitForURL((url) => !url.toString().includes('/login'), { timeout: timeoutMs });
    } catch {
      const currentUrl = page.url();
      if (currentUrl.includes('/login')) {
        throw authChallengeRequired('login did not complete — possible silent challenge');
      }
    }

    let mall = null;
    try {
      mall = await currentMall(page);
    } catch {
      log.debug('could not extract mall identity after login');
    }

    await ensureDir(dirname(authStatePath));
    await saveAuthState(context, authStatePath);

    return {
      success: true,
      mode: 'password',
      authStatePath,
      mall,
      savedAt: new Date().toISOString(),
    };
  } finally {
    if (browser) await closeBrowser(browser).catch(() => {});
  }
}

export async function extractAccountIdentity(page) {
  return currentMall(page);
}
