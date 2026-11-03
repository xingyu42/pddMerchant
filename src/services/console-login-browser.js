import { launchBrowser, createSnapshotContext } from '../adapter/browser.js';
import { openTakeover } from '../adapter/takeover.js';
import { captureQrElement } from '../adapter/qr-login.js';
import { verifyMerchantContext, assertMerchantVerified } from '../adapter/merchant-auth.js';
import { hasPassId, MERCHANT_CHECK_URL } from '../adapter/merchant-auth-probe.js';
import { attemptPasswordLogin, submitSmsCode } from '../adapter/password-login.js';
import { loadPasswordCredential } from '../adapter/password-credential.js';
import { assertAuthTask } from '../adapter/merchant-auth-storage.js';
import { deviceState } from './password-relogin.js';

// 新增账号没有已存设备状态，调用方传入空白状态。
export async function openConsoleBrowser(session, tx, state = deviceState(tx)) {
  const { browser, context } = await launchBrowser({ ownerTag: session.ownerTag });
  session.browser = browser;
  await context?.close();
  assertAuthTask(tx);
  session.context = await createSnapshotContext(browser, state);
  assertAuthTask(tx);
  session.page = await session.context.newPage();
  assertAuthTask(tx);
}

export async function attemptConsolePassword(session, tx, credential = loadPasswordCredential(tx.accountId)) {
  const task = { signal: tx.signal, deadlineAt: Math.min(tx.deadlineAt, Date.now() + 70_000) };
  return attemptPasswordLogin(session.page, credential, task);
}

export async function submitConsoleSms(session, code) {
  return submitSmsCode(session.page, code, { signal: session.controller.signal,
    deadlineAt: Math.min(session.expiresAt, Date.now() + 15_000) });
}

export async function captureConsoleQr(session) {
  const image = await captureQrElement(session.page);
  assertAuthTask({ signal: session.controller.signal, deadlineAt: session.expiresAt });
  session.qrImage = `data:image/png;base64,${image.toString('base64')}`;
}

export async function openConsoleTakeover(session) {
  session.takeover = await openTakeover(session.page);
  assertAuthTask({ signal: session.controller.signal });
}

export async function consoleHasPassId(session) {
  return hasPassId(await session.context.cookies([MERCHANT_CHECK_URL]));
}

export async function verifyConsoleLogin(session, tx) {
  await session.refreshing;
  assertAuthTask(tx);
  await session.takeover?.close();
  await session.page?.close();
  const verified = await verifyMerchantContext(session.context, { signal: tx.signal,
    deadlineAt: tx.deadlineAt, expectedMallId: tx.recoveryMallId });
  assertMerchantVerified(verified);
  return verified;
}

export async function closeConsoleBrowser(session) {
  try { await session.takeover?.close(); } catch { /* Always attempt browser cleanup. */ }
  try { await session.browser?.close(); } catch { /* Browser may have exited on cancellation. */ }
}
