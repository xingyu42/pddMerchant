import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import {
  findQrElement,
  extractElementImage,
  dismissModalOverlay,
  ensureQrTab,
  QR_SELECTORS,
} from './qr-login.js';

export const CONSUMER_LOGIN_URL = 'https://mobile.yangkeduo.com/login.html';

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

export async function captureConsumerQr(page, { loginUrl, timeout = TIMEOUTS.QR_CAPTURE } = {}) {
  const log = getLogger();

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  } catch {
    log.debug({ loginUrl }, 'consumer-qr: primary URL failed, retrying');
    await page.goto(new URL(loginUrl).origin, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
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

function safePageUrl(page) {
  try {
    return page.url();
  } catch {
    return null;
  }
}

export async function waitForConsumerLogin(page, { timeoutMs, signal }) {
  if (signal?.aborted) {
    return { success: false, url: safePageUrl(page), error: 'aborted' };
  }
  let onAbort;
  try {
    const waitPromise = page.waitForURL(
      (url) => {
        const parsedUrl = new URL(url.toString());
        return !parsedUrl.pathname.includes('/login');
      },
      { timeout: timeoutMs },
    );
    waitPromise.catch(() => {});
    if (signal) {
      const abortPromise = new Promise((_, reject) => {
        onAbort = () => reject(new Error('aborted'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      await Promise.race([waitPromise, abortPromise]);
    } else {
      await waitPromise;
    }
    return { success: true, url: safePageUrl(page) };
  } catch (err) {
    return { success: false, url: safePageUrl(page), error: err?.message || 'timeout' };
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
