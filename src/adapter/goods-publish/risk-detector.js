import { riskControlDetected, captchaDetected, loginRedirectDetected } from '../../infra/errors.js';

const CAPTCHA_SELECTORS = [
  'img[src*="captcha"]',
  'div[class*="slider"]',
  'div[class*="captcha"]',
  'div[class*="verify"]',
  '#captcha',
  '.J_MIDDLEWARE_FRAME_WIDGET',
];

const RISK_MODAL_SELECTORS = [
  'div[class*="risk"]',
  'div[class*="restrict"]',
  'div[class*="punish"]',
];

const LOGIN_PATTERNS = [
  '/login',
  '/passport',
  'login.pinduoduo.com',
];

export async function detectPageRisk(page, options = {}) {
  if (!page || typeof page.url !== 'function') {
    return { detected: false, type: null, phase: options.phase || 'unknown', url: '', selectors: [] };
  }
  const currentUrl = page.url();
  const phase = options.phase || 'unknown';

  if (LOGIN_PATTERNS.some(p => currentUrl.includes(p))) {
    return { detected: true, type: 'login-redirect', phase, url: currentUrl, selectors: [] };
  }

  for (const sel of CAPTCHA_SELECTORS) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 500 });
      if (visible) {
        return {
          detected: true,
          type: sel.includes('slider') ? 'slider' : 'captcha',
          phase,
          url: currentUrl,
          selectors: [sel],
        };
      }
    } catch { /* element not found, continue */ }
  }

  for (const sel of RISK_MODAL_SELECTORS) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 500 });
      if (visible) {
        return { detected: true, type: 'risk-modal', phase, url: currentUrl, selectors: [sel] };
      }
    } catch { /* continue */ }
  }

  return { detected: false, type: null, phase, url: currentUrl, selectors: [] };
}

export async function assertNoRiskControl(page, options = {}) {
  const signal = await detectPageRisk(page, options);
  if (!signal.detected) return;

  if (signal.type === 'login-redirect') throw loginRedirectDetected(signal);
  if (signal.type === 'captcha' || signal.type === 'slider') throw captchaDetected(signal);
  throw riskControlDetected(signal);
}
