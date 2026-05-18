import { isMockEnabled } from './mock-dispatcher.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import {
  findQrElement,
  extractElementImage,
  dismissModalOverlay,
  ensureQrTab,
  saveQrPng,
  decodeQrContent,
  renderQrToStream,
  QR_SELECTORS,
} from './qr-login.js';

function resolveConsumerLoginUrl() {
  return process.env.PDD_CONSUMER_LOGIN_URL || 'https://mobile.yangkeduo.com/login.html';
}

export const CONSUMER_LOGIN_URL = resolveConsumerLoginUrl();

const CONSUMER_QR_SELECTORS = [
  '[class*="qr-code"] canvas',
  '[class*="qrcode"] canvas',
  '[class*="qr-code"] img',
  '[class*="qrcode"] img',
  'img[src*="qrcode"]',
  'canvas.qrcode-canvas',
  ...QR_SELECTORS,
];

const CONSUMER_QR_TAB_SELECTORS = [
  'text=扫码登录',
  'text=二维码登录',
  '[class*="qr-tab"]',
  '[class*="qrcode-tab"]',
];

export async function captureConsumerQr(page, { timeout = TIMEOUTS.QR_CAPTURE } = {}) {
  if (isMockEnabled()) return Buffer.alloc(64);

  const log = getLogger();
  const loginUrl = resolveConsumerLoginUrl();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  } catch {
    log.debug({ loginUrl }, 'consumer-qr: primary URL failed, retrying');
    await page.goto('https://mobile.yangkeduo.com', { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  }

  await page.waitForTimeout(1500);
  await dismissModalOverlay(page);
  await ensureQrTab(page, { tabSelectors: CONSUMER_QR_TAB_SELECTORS });

  const hit = await findQrElement(page, {
    timeoutMs: timeout,
    pollIntervalMs: 500,
    selectors: CONSUMER_QR_SELECTORS,
  });

  if (!hit) {
    throw new PddCliError({
      code: 'E_QR_NOT_FOUND',
      message: '未能在消费端登录页上找到二维码元素',
      hint: '尝试 pdd login --consumer（有头模式）手动登录',
      detail: {
        triedSelectors: CONSUMER_QR_SELECTORS.length,
        pageUrl: (() => { try { return page.url(); } catch { return null; } })(),
        timeoutMs: timeout,
      },
      exitCode: ExitCodes.AUTH,
    });
  }

  return extractElementImage(page, hit.element);
}

export async function waitForConsumerLogin(page, { timeoutMs }) {
  try {
    await page.waitForURL(
      (url) => {
        const u = new URL(url.toString());
        return !u.pathname.includes('/login');
      },
      { timeout: timeoutMs }
    );
    return { success: true, url: page.url() };
  } catch (err) {
    return { success: false, url: page.url(), error: err?.message || 'timeout' };
  }
}

export { saveQrPng, decodeQrContent, renderQrToStream };
