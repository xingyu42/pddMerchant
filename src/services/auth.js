import { launchBrowser, closeBrowser, createConsumerContext, createSnapshotContext } from '../adapter/browser.js';
import { PDD_HOME } from '../adapter/auth-state.js';
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
import { createConsumerIdentityObserver } from '../adapter/consumer-identity.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyMerchantContext, assertMerchantVerified } from '../adapter/merchant-auth.js';
import { boundMerchantMallId, assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { checkMerchantSession } from './merchant-session.js';
import { MERCHANT_CHECK_URL, hasPassId } from '../adapter/merchant-auth-probe.js';
import { abortableSleep, budgetMs } from '../infra/abort.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';

async function waitForMerchantCandidate(context, task) {
  while (true) {
    assertAuthTask(task);
    if (hasPassId(await context.cookies([MERCHANT_CHECK_URL]))) return;
    await abortableSleep(budgetMs(task, 500), task.signal);
  }
}

async function performMerchantLogin(options) {
  const { transaction, expectedMallId, qr } = options;
  const timeoutMs = options.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PddCliError({ code: 'E_USAGE', message: '登录超时必须是正数', exitCode: ExitCodes.USAGE });
  }
  if (isMockEnabled()) {
    const result = await verifyMerchantContext(null, { expectedMallId });
    assertMerchantVerified(result);
    return { identity: result.identity, mode: qr ? 'qr' : 'headed', url: PDD_HOME, candidate: result.candidate };
  }
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + timeoutMs);
  return acquireMerchantLogin({ ...options, deadlineAt }, transaction);
}

async function acquireMerchantLogin(options, transaction) {
  const { signal, deadlineAt, headed, qr, expectedMallId } = options;
  let browser;
  let qrDirectory;
  let timer;
  const onAbort = () => { void closeBrowser(browser).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    timer = setTimeout(onAbort, budgetMs({ deadlineAt }));
    const reuseState = transaction.state && !transaction.corrupt;
    const launched = await launchBrowser({ headed, storageState: reuseState ? transaction.state : undefined });
    browser = launched.browser;
    assertAuthTask(transaction);
    const task = { signal, deadlineAt, expectedMallId: expectedMallId ?? boundMerchantMallId(transaction.state) };
    const session = await prepareMerchantSession(launched, transaction, task, reuseState);
    let result = session.result;
    let qrContentPresent;
    if (!result || result.verdict !== 'verified') {
      if (qr) qrDirectory = await mkdtemp(join(tmpdir(), 'pdd-merchant-login-'));
      const acquired = await authorizeMerchantSession(session, options, task, qrDirectory);
      result = acquired.result;
      qrContentPresent = acquired.qrContentPresent;
    }
    assertMerchantVerified(result);
    return { identity: result.identity, candidate: result.candidate, url: PDD_HOME, mode: qr ? 'qr' : 'headed', qrContentPresent };
  } catch (error) {
    assertAuthTask(transaction);
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_FLOW_FAILED', message: '商家授权或校验未完成', exitCode: ExitCodes.AUTH });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await closeBrowser(browser);
    if (qrDirectory) await rm(qrDirectory, { recursive: true, force: true });
  }
}

async function prepareMerchantSession({ browser, context, page }, transaction, task, reuseState) {
  const { result } = reuseState
    ? await checkMerchantSession(context, { tx: transaction, task, mode: 'login' }) : { result: null };
  if (!result || result.verdict === 'verified') return { context, page, result };
  await context.close();
  const emptyContext = await createSnapshotContext(browser, { cookies: [], origins: [] });
  return { context: emptyContext, page: await emptyContext.newPage(), result };
}

async function authorizeMerchantSession({ context, page }, options, task, qrDirectory) {
  assertAuthTask(task);
  let qrContentPresent;
  if (options.qr) {
    const pngBuffer = await captureQrElement(page, { timeout: budgetMs(task, options.qrCaptureTimeoutMs ?? TIMEOUTS.QR_CAPTURE) });
    const imagePath = await saveQrPng(pngBuffer, { dir: qrDirectory });
    const qrContent = decodeQrContent(pngBuffer);
    qrContentPresent = Boolean(qrContent);
    if (options.onQrCaptured) await options.onQrCaptured({ imagePath, qrContent, pngBuffer });
  } else {
    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: budgetMs(task, TIMEOUTS.NAV) });
    getLogger().info('等待用户在独立浏览器中授权');
  }
  await waitForMerchantCandidate(context, task);
  await page.close();
  return { result: await verifyMerchantContext(context, task), qrContentPresent };
}

export function performQrLogin(options) {
  return performMerchantLogin({ ...options, qr: true, headed: options.headed ?? false });
}

export function performHeadedLogin(options) {
  return performMerchantLogin({ ...options, qr: false, headed: true });
}

export async function performConsumerQrLogin({
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
    const state = await consumer.context.storageState();
    getSharedScrapeCooldown(scrapeCooldownConfig).recordSuccess();
    return { state, identity, url: result.url, mode: 'consumer-qr', qrImagePath: imagePath };
  } finally {
    identityObserver?.dispose();
    await closeBrowser(browser);
  }
}

export async function performConsumerHeadedLogin({
  timeoutMs,
  consumerLoginUrl,
  scrapeCooldownConfig,
}) {
  const log = getLogger();
  let browser = null;
  let identityObserver = null;
  try {
    const launched = await launchBrowser({ headed: true });
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
    const state = await context.storageState();
    getSharedScrapeCooldown(scrapeCooldownConfig).recordSuccess();
    return { state, identity, url: result.url, mode: 'consumer-headed' };
  } finally {
    identityObserver?.dispose();
    await closeBrowser(browser);
  }
}

export { renderQrToStream };
