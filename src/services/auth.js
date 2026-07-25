import { launchBrowser, closeBrowser, createConsumerContext } from '../adapter/browser.js';
import { saveAuthState, PDD_HOME } from '../adapter/auth-state.js';
import {
  captureQrElement,
  saveQrPng,
  decodeQrContent,
  renderQrToStream,
} from '../adapter/qr-login.js';
import {
  captureConsumerQr,
  waitForConsumerLogin,
} from '../adapter/consumer-qr-login.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { getLogger } from '../infra/logger.js';
import { getSharedScrapeCooldown } from '../infra/scrape-cooldown.js';
import { resolveMallContext } from '../adapter/mall-reader.js';
import { createConsumerIdentityObserver } from '../adapter/consumer-identity.js';

async function waitForMmsLogin(page, { timeoutMs }) {
  try {
    await page.waitForURL(
      (url) => {
        const u = new URL(url.toString());
        return u.hostname.includes('mms.pinduoduo.com') && !u.pathname.startsWith('/login');
      },
      { timeout: timeoutMs },
    );
    return { success: true, url: page.url() };
  } catch (err) {
    return { success: false, url: page.url(), error: err?.message || 'timeout' };
  }
}

async function resolveMerchantLoginIdentity(page) {
  const mallContext = await resolveMallContext(page);
  const mallId = mallContext?.activeId ?? null;
  const activeMall = Array.isArray(mallContext?.malls)
    ? mallContext.malls.find((mall) => String(mall.id) === String(mallId))
    : null;
  return {
    mallId,
    displayName: mallContext?.activeName || activeMall?.name || '',
  };
}

export async function performQrLogin({ authStatePath, timeoutMs, headed = false, qrCaptureTimeoutMs, onQrCaptured }) {
  const log = getLogger();
  let browser = null;
  try {
    const launched = await launchBrowser({ headed });
    browser = launched.browser;
    const { page, context } = launched;

    log.info({ headed }, 'capturing merchant QR code');
    const pngBuffer = await captureQrElement(page, { timeout: qrCaptureTimeoutMs });
    const imagePath = await saveQrPng(pngBuffer);
    const qrContent = decodeQrContent(pngBuffer);

    if (onQrCaptured) await onQrCaptured({ imagePath, qrContent, pngBuffer });

    const result = await waitForMmsLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: `QR 可能已过期，重试或查看 ${imagePath}`,
        detail: { imagePath, qr_content_present: Boolean(qrContent) },
        exitCode: ExitCodes.AUTH,
      });
    }

    const identity = await resolveMerchantLoginIdentity(page);
    const savedPath = await saveAuthState(context, authStatePath);
    return { path: savedPath, identity, url: result.url, mode: 'qr', qrImagePath: imagePath, qrContentPresent: Boolean(qrContent) };
  } finally {
    await closeBrowser(browser);
  }
}

export async function performHeadedLogin({ authStatePath, timeoutMs }) {
  const log = getLogger();
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: true });
    browser = launched.browser;
    const { page, context } = launched;

    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
    log.info(`等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);

    const result = await waitForMmsLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        exitCode: ExitCodes.AUTH,
      });
    }

    const identity = await resolveMerchantLoginIdentity(page);
    const savedPath = await saveAuthState(context, authStatePath);
    return { path: savedPath, identity, url: result.url, mode: 'headed' };
  } finally {
    await closeBrowser(browser);
  }
}

export async function performConsumerQrLogin({
  authStatePath,
  timeoutMs,
  headed = false,
  onQrCaptured,
  consumerLoginUrl,
  scrapeCooldownConfig,
}) {
  const log = getLogger();
  let browser = null;
  let identityObserver = null;
  try {
    const launched = await launchBrowser({ headed });
    browser = launched.browser;
    const consumer = await createConsumerContext(browser);
    identityObserver = createConsumerIdentityObserver(consumer.page);

    log.info({ headed }, '消费端：抓取登录二维码中');
    const pngBuffer = await captureConsumerQr(consumer.page, { loginUrl: consumerLoginUrl });
    const imagePath = await saveQrPng(pngBuffer);
    const qrContent = decodeQrContent(pngBuffer);

    if (onQrCaptured) await onQrCaptured({ imagePath, qrContent, pngBuffer });

    const result = await waitForConsumerLogin(consumer.page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: `QR 可能已过期，重新执行；或查看 ${imagePath}`,
        detail: { imagePath, qr_content_present: Boolean(qrContent) },
        exitCode: ExitCodes.AUTH,
      });
    }

    const identity = await identityObserver.wait();
    const savedPath = await saveAuthState(consumer.context, authStatePath);
    getSharedScrapeCooldown(scrapeCooldownConfig).recordSuccess();
    return { path: savedPath, identity, url: result.url, mode: 'consumer-qr', qrImagePath: imagePath };
  } finally {
    identityObserver?.dispose();
    await closeBrowser(browser);
  }
}

export async function performConsumerHeadedLogin({
  authStatePath,
  timeoutMs,
  consumerLoginUrl,
  scrapeCooldownConfig,
}) {
  const log = getLogger();
  let browser = null;
  let identityObserver = null;
  try {
    const launched = await launchBrowser({ headed: true, storageStatePath: null });
    browser = launched.browser;
    const { context, page } = launched;
    identityObserver = createConsumerIdentityObserver(page);

    await page.goto(consumerLoginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
    log.info(`消费端：等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);

    const result = await waitForConsumerLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: '重新执行 pdd login --consumer',
        exitCode: ExitCodes.AUTH,
      });
    }

    const identity = await identityObserver.wait();
    const savedPath = await saveAuthState(context, authStatePath);
    getSharedScrapeCooldown(scrapeCooldownConfig).recordSuccess();
    return { path: savedPath, identity, url: result.url, mode: 'consumer-headed' };
  } finally {
    identityObserver?.dispose();
    await closeBrowser(browser);
  }
}

export { renderQrToStream };
