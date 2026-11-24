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
import { boundMerchantMallId } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask } from '../infra/auth-task.js';
import { checkMerchantSession } from './merchant-session.js';
import { MERCHANT_CHECK_URL, hasPassId } from '../adapter/merchant-auth-probe.js';
import { abortableSleep, budgetMs } from '../infra/abort.js';

async function waitForMerchantCandidate(context, task) {
  while (true) {
    assertAuthTask(task);
    if (hasPassId(await context.cookies([MERCHANT_CHECK_URL]))) return;
    await abortableSleep(budgetMs(task, 500), task.signal);
  }
}

async function performMerchantLogin(options) {
  const { transaction, expectedMallId, qr, runtime, seal } = options;
  const timeoutMs = options.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PddCliError({ code: 'E_USAGE', message: '登录超时必须是正数', exitCode: ExitCodes.USAGE });
  }
  if (runtime?.mode === 'fixture') {
    const resolvedSeal = seal ?? runtime.seal;
    const verifyOptions = {
      expectedMallId,
      ...(resolvedSeal !== undefined ? { seal: resolvedSeal } : {}),
    };
    let result;
    if (runtime.ports?.auth) {
      result = await runtime.ports.auth.verifyAndSeal(null, verifyOptions);
    } else {
      const verify = runtime.fixture?.verifyFixtureMerchantContext
        ?? (await import('../adapter/fixtures/auth.js')).verifyFixtureMerchantContext;
      result = await verify(null, verifyOptions);
    }
    assertMerchantVerified(result);
    return { identity: result.identity, mode: qr ? 'qr' : 'headed', url: PDD_HOME, candidate: result.candidate };
  }
  const nowFn = runtime?.clock?.now ?? Date.now;
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, nowFn() + timeoutMs);
  return acquireMerchantLogin({ ...options, deadlineAt }, transaction);
}

async function acquireMerchantLogin(options, transaction) {
  const { signal, deadlineAt, headed, qr, expectedMallId, runtime, seal } = options;
  const browserPort = runtime?.ports?.browser;
  let browserSession;
  let browser;
  let activeContext;
  let qrDirectory;
  let timer;
  const onAbort = () => {
    void (browserSession ? browserSession.close() : closeBrowser(browser)).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    timer = setTimeout(onAbort, budgetMs({ deadlineAt }));
    const reuseState = transaction.state && !transaction.corrupt;
    const launchOptions = { headed, storageState: reuseState ? transaction.state : undefined };
    const launched = browserPort
      ? await browserPort.openSession(launchOptions)
      : await launchBrowser(launchOptions);
    if (browserPort) browserSession = launched;
    else browser = launched.browser;
    assertAuthTask(transaction);
    const activeSeal = seal ?? runtime?.seal;
    const verifyContext = runtime?.ports?.auth?.verifyAndSeal;
    const task = {
      signal,
      deadlineAt,
      expectedMallId: expectedMallId ?? boundMerchantMallId(transaction.state),
      ...(activeSeal ? { seal: activeSeal } : {}),
      ...(typeof verifyContext === 'function' ? { verifyContext } : {}),
    };
    const session = await prepareMerchantSession(launched, transaction, task, reuseState, browserSession);
    activeContext = session.context;
    let result = session.result;
    let qrContentPresent;
    if (!result || result.verdict !== 'verified') {
      if (qr) qrDirectory = await mkdtemp(join(tmpdir(), 'pdd-merchant-login-'));
      const acquired = await authorizeMerchantSession(session, options, task, qrDirectory, browserSession);
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
    if (browserSession) {
      if (activeContext && activeContext !== browserSession.context) {
        await activeContext.close?.().catch(() => {});
      }
      await browserSession.close();
    } else {
      await closeBrowser(browser);
    }
    if (qrDirectory) await rm(qrDirectory, { recursive: true, force: true });
  }
}

async function prepareMerchantSession({ browser, context, page }, transaction, task, reuseState, browserSession) {
  const checkTarget = browserSession ?? context;
  const { result } = reuseState
    ? await checkMerchantSession(checkTarget, { tx: transaction, task, mode: 'login' }) : { result: null };
  if (!result || result.verdict === 'verified') return { context, page, result };
  await context.close();
  const emptyContext = browserSession
    ? await browserSession.createSnapshotContext({ cookies: [], origins: [] })
    : await createSnapshotContext(browser, { cookies: [], origins: [] });
  return { context: emptyContext, page: await emptyContext.newPage(), result };
}

async function authorizeMerchantSession({ context, page }, options, task, qrDirectory, browserSession) {
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
  const verifyContext = typeof task.verifyContext === 'function' ? task.verifyContext : verifyMerchantContext;
  const verifyTarget = browserSession
    ? { context, createSnapshotContext: (snapshot) => browserSession.createSnapshotContext(snapshot) }
    : context;
  return { result: await verifyContext(verifyTarget, { ...task, ...(browserSession ? {} : { createSnapshotContext }) }), qrContentPresent };
}

export function performQrLogin(options) {
  return performMerchantLogin({ ...options, qr: true, headed: options.headed ?? false });
}

export function performHeadedLogin(options) {
  return performMerchantLogin({ ...options, qr: false, headed: true });
}

async function closeConsumerLoginResources(deriveConsumer, target, cleanupRoot) {
  if (deriveConsumer) await target.close?.().catch(() => {});
  await cleanupRoot();
}

async function openConsumerLoginTarget({ headed, deriveConsumer, browserPort }) {
  const root = browserPort
    ? await browserPort.openSession({ headed })
    : await launchBrowser({ headed });
  const cleanupRoot = browserPort
    ? () => root.close().catch(() => {})
    : () => closeBrowser(root.browser);
  const resolveTarget = deriveConsumer
    ? () => (browserPort ? browserPort.deriveConsumerContext(root) : createConsumerContext(root.browser))
    : () => root;

  try {
    const target = await resolveTarget();
    return {
      context: target.context,
      page: target.page,
      close: () => closeConsumerLoginResources(deriveConsumer, target, cleanupRoot),
    };
  } catch (err) {
    await cleanupRoot();
    throw err;
  }
}

async function waitForConsumerAuth(target, identityObserver, {
  timeoutMs,
  hint,
  detail,
  scrapeCooldownConfig,
}) {
  const result = await waitForConsumerLogin(target.page, { timeoutMs });
  if (!result.success) {
    throw new PddCliError({
      code: 'E_AUTH_TIMEOUT',
      message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
      hint,
      ...(detail ? { detail } : {}),
      exitCode: ExitCodes.AUTH,
    });
  }
  const identity = await identityObserver.wait();
  const state = await target.context.storageState();
  getSharedScrapeCooldown(scrapeCooldownConfig).recordSuccess();
  return { state, identity, url: result.url };
}

export async function performConsumerQrLogin({
  timeoutMs,
  headed = false,
  onQrCaptured,
  consumerLoginUrl,
  scrapeCooldownConfig,
  qrDir,
  runtime,
}) {
  const log = getLogger();
  let target = null;
  let identityObserver = null;
  try {
    target = await openConsumerLoginTarget({
      headed,
      deriveConsumer: true,
      browserPort: runtime?.ports?.browser,
    });
    identityObserver = createConsumerIdentityObserver(target.page);

    log.info({ headed }, '消费端：抓取登录二维码中');
    const pngBuffer = await captureConsumerQr(target.page, { loginUrl: consumerLoginUrl });
    const imagePath = await saveQrPng(pngBuffer, qrDir ? { dir: qrDir } : undefined);
    const qrContent = decodeQrContent(pngBuffer);
    if (onQrCaptured) await onQrCaptured({ imagePath, qrContent, pngBuffer });

    const auth = await waitForConsumerAuth(target, identityObserver, {
      timeoutMs,
      hint: `QR 可能已过期，重新执行；或查看 ${imagePath}`,
      detail: { imagePath, qr_content_present: Boolean(qrContent) },
      scrapeCooldownConfig,
    });
    return { ...auth, mode: 'consumer-qr', qrImagePath: imagePath };
  } finally {
    identityObserver?.dispose();
    await target?.close();
  }
}

export async function performConsumerHeadedLogin({
  timeoutMs,
  consumerLoginUrl,
  scrapeCooldownConfig,
  runtime,
}) {
  const log = getLogger();
  let target = null;
  let identityObserver = null;
  try {
    target = await openConsumerLoginTarget({
      headed: true,
      deriveConsumer: false,
      browserPort: runtime?.ports?.browser,
    });
    identityObserver = createConsumerIdentityObserver(target.page);

    await target.page.goto(consumerLoginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
    log.info(`消费端：等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);

    const auth = await waitForConsumerAuth(target, identityObserver, {
      timeoutMs,
      hint: '重新执行 pdd login --consumer',
      scrapeCooldownConfig,
    });
    return { ...auth, mode: 'consumer-headed' };
  } finally {
    identityObserver?.dispose();
    await target?.close();
  }
}

export { renderQrToStream };
