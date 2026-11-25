import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  launchBrowser,
  closeBrowser,
  createConsumerContext,
  createSnapshotContext,
} from './browser.js';
import { PDD_HOME } from './auth-state.js';
import { captureQrElement, saveQrPng, decodeQrContent } from './qr-login.js';
import {
  CONSUMER_LOGIN_URL,
  captureConsumerQr,
  waitForConsumerLogin,
} from './consumer-qr-login.js';
import { createConsumerIdentityObserver } from './consumer-identity.js';
import { verifyMerchantContext, assertMerchantVerified } from './merchant-auth.js';
import { boundMerchantMallId, verifyStoredMerchant } from './merchant-auth-storage.js';
import { MERCHANT_CHECK_URL, hasPassId } from './merchant-auth-probe.js';
import { assertAuthTask } from '../infra/auth-task.js';
import { abortableSleep, budgetMs, throwIfAborted } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';

function resolveTimeoutMs(rawTimeoutMs, qr) {
  const timeoutMs = rawTimeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PddCliError({ code: 'E_USAGE', message: '登录超时必须是正数', exitCode: ExitCodes.USAGE });
  }
  return timeoutMs;
}

async function waitForMerchantCandidate(context, task) {
  while (true) {
    assertAuthTask(task);
    if (hasPassId(await context.cookies([MERCHANT_CHECK_URL]))) return;
    await abortableSleep(budgetMs(task, 500), task.signal);
  }
}

async function defaultCheckStoredSession(checkTarget, transaction, task) {
  const result = await verifyStoredMerchant(checkTarget, transaction.state, task);
  if (result.verdict === 'rejected') return { result };
  assertMerchantVerified(result);
  return { result };
}

async function prepareMerchantSession(launched, transaction, task, { reuseState, browserSession, checkStoredSession }) {
  const { browser, context, page } = launched;
  const checkTarget = browserSession ?? context;
  let result = null;
  if (reuseState) {
    ({ result } = checkStoredSession
      ? await checkStoredSession(checkTarget, task)
      : await defaultCheckStoredSession(checkTarget, transaction, task));
  }
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
    const captureTimeout = budgetMs(task, options.qrCaptureTimeoutMs ?? TIMEOUTS.QR_CAPTURE);
    const pngBuffer = await captureQrElement(page, { timeout: captureTimeout });
    const imagePath = await saveQrPng(pngBuffer, { dir: qrDirectory });
    const qrContent = decodeQrContent(pngBuffer);
    qrContentPresent = Boolean(qrContent);
    if (options.onQrCaptured) await options.onQrCaptured({ imagePath, qrContent, pngBuffer });
  } else {
    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: budgetMs(task, TIMEOUTS.NAV) });
    (options.log ?? getLogger()).info('等待用户在独立浏览器中授权');
  }
  await waitForMerchantCandidate(context, task);
  await page.close();
  const verifyContext = typeof task.verifyContext === 'function' ? task.verifyContext : verifyMerchantContext;
  const verifyTarget = browserSession
    ? { context, createSnapshotContext: (snapshot) => browserSession.createSnapshotContext(snapshot) }
    : context;
  const snapshotOpts = browserSession ? {} : { createSnapshotContext };
  return { result: await verifyContext(verifyTarget, { ...task, ...snapshotOpts }), qrContentPresent };
}

async function cleanupMerchantResources({ browserSession, activeContext, browser, qrDirectory }) {
  if (browserSession) {
    if (activeContext && activeContext !== browserSession.context) {
      await activeContext.close?.().catch(() => {});
    }
    await browserSession.close().catch(() => {});
  } else {
    await closeBrowser(browser);
  }
  if (qrDirectory) await rm(qrDirectory, { recursive: true, force: true });
}

function buildMerchantTask(options, transaction, deadlineAt) {
  const { expectedMallId, signal, authPort, seal, clock } = options;
  const verifyContext = authPort?.verifyAndSeal;
  return {
    signal,
    deadlineAt,
    clock,
    expectedMallId: expectedMallId ?? boundMerchantMallId(transaction.state),
    ...(seal !== undefined ? { seal } : {}),
    ...(typeof verifyContext === 'function' ? { verifyContext } : {}),
  };
}

function resolveLoginBudget(options, qr) {
  const timeoutMs = resolveTimeoutMs(options.timeoutMs, qr);
  const nowFn = options.clock?.now ?? Date.now;
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, nowFn() + timeoutMs);
  return { timeoutMs, deadlineAt, taskBudget: { signal: options.signal, deadlineAt, clock: options.clock } };
}

function armAbortCleanup(signal, taskBudget, onAbort) {
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, budgetMs(taskBudget));
  return () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  };
}

async function openMerchantLaunch({ headed, transaction, browserPort }) {
  const reuseState = Boolean(transaction.state && !transaction.corrupt);
  const launchOptions = { headed, storageState: reuseState ? transaction.state : undefined };
  const launched = browserPort ? await browserPort.openSession(launchOptions) : await launchBrowser(launchOptions);
  return {
    launched,
    reuseState,
    browserSession: browserPort ? launched : undefined,
    browser: browserPort ? undefined : launched.browser,
  };
}

export async function loginMerchantInteractive(options = {}) {
  const { transaction = {}, qr = false, headed = !qr, signal, browserPort, checkStoredSession } = options;
  const { deadlineAt, taskBudget } = resolveLoginBudget(options, qr);
  assertAuthTask(taskBudget);

  let browserSession;
  let browser;
  let activeContext;
  let qrDirectory;
  const disarmAbort = armAbortCleanup(signal, taskBudget, () => {
    void (browserSession ? browserSession.close() : closeBrowser(browser)).catch(() => {});
  });

  try {
    const opened = await openMerchantLaunch({ headed, transaction, browserPort });
    ({ browserSession, browser } = opened);
    assertAuthTask(taskBudget);

    const task = buildMerchantTask(options, transaction, deadlineAt);
    const session = await prepareMerchantSession(opened.launched, transaction, task, {
      reuseState: opened.reuseState,
      browserSession,
      checkStoredSession,
    });
    activeContext = session.context;
    let result = session.result;
    let qrContentPresent;
    if (!result || result.verdict !== 'verified') {
      if (qr) qrDirectory = await mkdtemp(join(tmpdir(), 'pdd-merchant-login-'));
      ({ result, qrContentPresent } = await authorizeMerchantSession(
        session, { ...options, qr, headed }, task, qrDirectory, browserSession,
      ));
    }
    assertMerchantVerified(result);
    return { identity: result.identity, candidate: result.candidate, url: PDD_HOME, mode: qr ? 'qr' : 'headed', qrContentPresent };
  } catch (error) {
    assertAuthTask(taskBudget);
    if (error instanceof PddCliError) throw error;
    throw new PddCliError({ code: 'E_AUTH_FLOW_FAILED', message: '商家授权或校验未完成', exitCode: ExitCodes.AUTH });
  } finally {
    disarmAbort();
    await cleanupMerchantResources({ browserSession, activeContext, browser, qrDirectory });
  }
}

async function closeConsumerLoginResources(deriveConsumer, target, cleanupRoot) {
  if (deriveConsumer) await target.close?.().catch(() => {});
  await cleanupRoot();
}

async function openConsumerLoginTarget({ headed, deriveConsumer, browserPort }) {
  const root = browserPort ? await browserPort.openSession({ headed }) : await launchBrowser({ headed });
  const cleanupRoot = browserPort ? () => root.close().catch(() => {}) : () => closeBrowser(root.browser);
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
  deadlineAt,
  clock,
  signal,
  hint,
  detail,
}) {
  const result = await waitForConsumerLogin(target.page, {
    timeoutMs: budgetMs({ deadlineAt, clock }, timeoutMs),
    signal,
  });
  throwIfAborted(signal);
  if (!result.success) {
    throw new PddCliError({
      code: 'E_AUTH_TIMEOUT',
      message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
      hint,
      ...(detail ? { detail } : {}),
      exitCode: ExitCodes.AUTH,
    });
  }
  let identity;
  try {
    identity = await identityObserver.wait({ timeoutMs: budgetMs({ deadlineAt, clock }, 15_000) });
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  }
  throwIfAborted(signal);
  const state = await target.context.storageState();
  return { state, identity, url: result.url };
}

async function runConsumerQrFlow(target, identityObserver, options) {
  const { headed, consumerLoginUrl, qrDir, qrCaptureTimeoutMs, onQrCaptured, timeoutMs, deadlineAt, clock, signal, log } = options;
  log.info({ headed }, '消费端：抓取登录二维码中');
  const pngBuffer = await captureConsumerQr(target.page, {
    loginUrl: consumerLoginUrl,
    timeout: budgetMs({ deadlineAt, clock }, qrCaptureTimeoutMs),
  });
  throwIfAborted(signal);
  const imagePath = await saveQrPng(pngBuffer, qrDir ? { dir: qrDir } : undefined);
  const qrContent = decodeQrContent(pngBuffer);
  if (onQrCaptured) await onQrCaptured({ imagePath, qrContent, pngBuffer });
  const auth = await waitForConsumerAuth(target, identityObserver, {
    timeoutMs,
    deadlineAt,
    clock,
    signal,
    hint: `QR 可能已过期，重新执行；或查看 ${imagePath}`,
    detail: { imagePath, qr_content_present: Boolean(qrContent) },
  });
  return { ...auth, mode: 'consumer-qr', qrImagePath: imagePath };
}

async function runConsumerHeadedFlow(target, identityObserver, {
  consumerLoginUrl,
  timeoutMs,
  deadlineAt,
  clock,
  signal,
  log,
}) {
  await target.page.goto(consumerLoginUrl, {
    waitUntil: 'domcontentloaded',
    timeout: budgetMs({ deadlineAt, clock }, TIMEOUTS.NAV),
  });
  throwIfAborted(signal);
  log.info(`消费端：等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);
  const auth = await waitForConsumerAuth(target, identityObserver, {
    timeoutMs,
    deadlineAt,
    clock,
    signal,
    hint: '重新执行 pdd login --consumer',
  });
  return { ...auth, mode: 'consumer-headed' };
}

export async function loginConsumerInteractive(options = {}) {
  const {
    qr = false,
    headed = !qr,
    consumerLoginUrl = CONSUMER_LOGIN_URL,
    qrCaptureTimeoutMs = TIMEOUTS.QR_CAPTURE,
    signal,
    browserPort,
    log,
  } = options;
  const { timeoutMs, deadlineAt, taskBudget } = resolveLoginBudget(options, qr);
  throwIfAborted(signal);

  const activeLog = log ?? getLogger();
  let target = null;
  let identityObserver = null;
  const disarmAbort = armAbortCleanup(signal, taskBudget, () => {
    identityObserver?.dispose();
    void target?.close().catch(() => {});
  });

  try {
    target = await openConsumerLoginTarget({ headed, deriveConsumer: qr, browserPort });
    throwIfAborted(signal);
    identityObserver = createConsumerIdentityObserver(target.page);

    const flowOptions = { ...options, headed, consumerLoginUrl, qrCaptureTimeoutMs, timeoutMs, deadlineAt, log: activeLog };
    return qr
      ? await runConsumerQrFlow(target, identityObserver, flowOptions)
      : await runConsumerHeadedFlow(target, identityObserver, flowOptions);
  } catch (error) {
    throwIfAborted(signal);
    throw error;
  } finally {
    disarmAbort();
    identityObserver?.dispose();
    await target?.close();
  }
}

export function createLiveInteractiveLogin({
  browserPort,
  authPort,
  seal,
  clock,
  log,
} = {}) {
  return Object.freeze({
    loginMerchant: (options = {}) => loginMerchantInteractive({
      browserPort,
      authPort,
      seal,
      clock,
      log,
      ...options,
    }),
    loginConsumer: (options = {}) => loginConsumerInteractive({
      browserPort,
      clock,
      log,
      ...options,
    }),
  });
}
