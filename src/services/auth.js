import { renderQrToStream } from '../adapter/qr-login.js';
import { CONSUMER_LOGIN_URL } from '../adapter/consumer-qr-login.js';
import { loginMerchantInteractive, loginConsumerInteractive } from '../adapter/interactive-login.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { resolveConsumerAccountContext } from '../infra/consumer-account-resolver.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger, redactValue } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionConsumerAuth, provisionMerchantLogin } from './auth-account-storage.js';
import { checkMerchantSession } from './merchant-session.js';
import { toConsumerLoginView, toMerchantLoginView } from './views/auth.js';

function resolvePositiveTimeoutMs(rawTimeoutMs, qr) {
  const timeoutMs = typeof rawTimeoutMs === 'number' && Number.isFinite(rawTimeoutMs)
    ? rawTimeoutMs
    : (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new PddCliError({ code: 'E_USAGE', message: '登录超时必须是正数', exitCode: ExitCodes.USAGE });
  }
  return timeoutMs;
}

function resolveClockNow(clock, runtime) {
  return () => (clock?.now ? clock.now() : (runtime?.clock?.now ? runtime.clock.now() : Date.now()));
}

export function createQrTerminalPresenter({
  stderr,
  streams,
  json = false,
  timeoutMs,
  kind = 'merchant',
  renderQr = renderQrToStream,
} = {}) {
  const targetStream = stderr ?? streams?.stderr ?? process.stderr;
  const isConsumer = kind === 'consumer';
  return async function presentQr({ imagePath, qrContent } = {}) {
    if (json) {
      if (imagePath) {
        const label = isConsumer ? '消费端' : '商家';
        targetStream.write(`等待本次${label}扫码授权：${imagePath}\n`);
      }
      return;
    }
    targetStream.write(isConsumer ? '\n📱 请使用拼多多 App 扫码登录：\n\n' : '\n📱 请使用拼多多商家 App 扫码登录：\n\n');
    if (qrContent) {
      await renderQr(qrContent, { stream: targetStream });
    } else if (!isConsumer || imagePath) {
      targetStream.write(`（QR 解码失败：截图可能含周围留白或分辨率不足；PNG 已保存，可手动打开 ${imagePath} 扫码）\n`);
    }
    if (!isConsumer || imagePath) {
      targetStream.write(`🖼️  QR 图片本地路径：${imagePath}\n`);
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      targetStream.write(`⏳ 等待扫码（超时 ${Math.round(timeoutMs / 1000)}s）...\n\n`);
    }
  };
}

function resolveAuthTiming(options, deps, runtime) {
  const qr = Boolean(options.qr);
  const headed = qr ? Boolean(options.headed) : true;
  const timeoutMs = resolvePositiveTimeoutMs(options.timeoutMs, qr);
  const clockNow = resolveClockNow(deps.clock, runtime);
  const signal = deps.signal ?? options.signal ?? runtime?.signal;
  const deadlineAt = deps.deadlineAt ?? options.deadlineAt ?? runtime?.deadlineAt ?? (clockNow() + timeoutMs);
  const qrCaptureTimeoutMs = typeof options.timeout === 'number' && Number.isFinite(options.timeout)
    ? options.timeout
    : TIMEOUTS.QR_CAPTURE;
  const stderr = deps.stderr ?? deps.streams?.stderr ?? runtime?.outputSink?.streams?.stderr ?? process.stderr;
  return { qr, headed, timeoutMs, signal, deadlineAt, qrCaptureTimeoutMs, stderr };
}

/** Run merchant interactive login and atomic account provisioning, returning the provisioned record. */
export async function authenticateMerchant(options = {}, deps = {}) {
  const runtime = deps.runtime ?? options.runtime;
  const { qr, headed, timeoutMs, signal, deadlineAt, qrCaptureTimeoutMs, stderr } = resolveAuthTiming(options, deps, runtime);
  const resolveAccount = deps.resolveAccount ?? ((account) => resolveAccountContext({ account, needsAuth: false }));
  const target = options.account ? await resolveAccount(options.account) : { accountId: null, account: null };
  const onQrCaptured = qr
    ? createQrTerminalPresenter({ stderr, json: Boolean(options.json), timeoutMs, kind: 'merchant' })
    : undefined;
  const merchantInteractive = deps.interactiveLogin?.loginMerchant
    ?? runtime?.interactiveLogin?.loginMerchant
    ?? ((loginOpts) => loginMerchantInteractive(loginOpts));
  const activeSeal = deps.seal ?? options.seal ?? runtime?.seal;
  const activeClock = deps.clock ?? runtime?.clock;
  const activeLog = deps.log ?? runtime?.log ?? getLogger();

  return (deps.provisionMerchant ?? provisionMerchantLogin)(async (transaction) => {
    if (options.headedNotice) activeLog.info(options.headedNotice);
    return merchantInteractive({
      transaction,
      qr,
      headed,
      timeoutMs,
      qrCaptureTimeoutMs,
      expectedMallId: target.account?.identity,
      signal,
      deadlineAt,
      onQrCaptured,
      browserPort: deps.browserPort ?? runtime?.ports?.browser,
      authPort: deps.authPort ?? runtime?.ports?.auth,
      seal: activeSeal,
      clock: activeClock,
      log: activeLog,
      checkStoredSession: (checkTarget, task) => checkMerchantSession(checkTarget, {
        tx: transaction, task, mode: 'login', runtime,
      }),
    });
  }, { accountId: target.accountId, signal, deadlineAt, seal: activeSeal, clock: activeClock });
}

export async function loginMerchant(options = {}, deps = {}) {
  const provisioned = await authenticateMerchant(options, deps);
  return toMerchantLoginView(provisioned.result, provisioned);
}

export async function loginConsumer(options = {}, deps = {}) {
  if (options.password) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '消费端暂不支持密码登录',
      hint: '使用 pdd login --consumer --qr（扫码）或 pdd login --consumer --headed（有头模式）',
      exitCode: ExitCodes.USAGE,
    });
  }
  const runtime = deps.runtime ?? options.runtime;
  const { qr, headed, timeoutMs, signal, deadlineAt, qrCaptureTimeoutMs, stderr } = resolveAuthTiming(options, deps, runtime);
  const resolveConsumerAccount = deps.resolveConsumerAccount ?? ((account) => resolveConsumerAccountContext({ account }));
  const selectedAccount = options.consumerAccount ? await resolveConsumerAccount(options.consumerAccount) : null;
  const consumerLoginUrl = options.consumerLoginUrl
    ?? deps.consumerLoginUrl
    ?? runtime?.runtimeConfig?.consumerLoginUrl
    ?? CONSUMER_LOGIN_URL;
  const onQrCaptured = qr
    ? createQrTerminalPresenter({ stderr, json: Boolean(options.json), timeoutMs, kind: 'consumer' })
    : undefined;
  const consumerInteractive = deps.interactiveLogin?.loginConsumer
    ?? runtime?.interactiveLogin?.loginConsumer
    ?? ((loginOpts) => loginConsumerInteractive(loginOpts));

  const result = await consumerInteractive({
    qr,
    headed,
    timeoutMs,
    qrCaptureTimeoutMs,
    consumerLoginUrl,
    qrDir: options.qrDir ?? deps.qrDir,
    signal,
    deadlineAt,
    onQrCaptured,
    browserPort: deps.browserPort ?? runtime?.ports?.browser,
    clock: deps.clock ?? runtime?.clock,
    log: deps.log ?? runtime?.log ?? getLogger(),
  });
  if (selectedAccount?.account && String(selectedAccount.account.identity ?? '') !== String(result.identity?.uid ?? '')) {
    throw new PddCliError({
      code: 'E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH',
      message: '登录后的消费者账号与所选账号不一致',
      hint: '切换到正确账号后重试，或不传 --consumer-account 让系统自动识别',
      exitCode: ExitCodes.AUTH,
    });
  }
  const provisioned = (deps.provisionConsumer ?? provisionConsumerAuth)(result.state, result.identity);
  (deps.scrapeCooldown ?? options.scrapeCooldown ?? runtime?.scrapeCooldown ?? null)?.recordSuccess();
  const isFixture = Boolean(result.fixture);
  return toConsumerLoginView(result, {
    accountFingerprint: isFixture ? null : redactValue(provisioned.account.identity),
    fixture: isFixture,
  });
}
