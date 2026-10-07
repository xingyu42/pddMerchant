import { performQrLogin, performHeadedLogin, renderQrToStream } from '../services/auth.js';
import { emit } from '../infra/output.js';
import { ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH, merchantPendingAuthStatePath } from '../infra/paths.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionMerchantAuth, withMerchantLoginRegistration } from '../services/auth-account-storage.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { deleteAuthState } from '../adapter/auth-state.js';
import { randomUUID } from 'node:crypto';
import { toMerchantLoginView } from '../services/views/auth.js';

function buildQrCallback({ json, command, timeoutMs }) {
  return async ({ imagePath, qrContent }) => {
    if (json) {
      process.stderr.write(`等待本次商家扫码授权：${imagePath}\n`);
      return;
    }
    process.stderr.write('\n📱 请使用拼多多商家 App 扫码登录：\n\n');
    if (qrContent) {
      await renderQrToStream(qrContent);
    } else {
      process.stderr.write(`（QR 解码失败：截图可能含周围留白或分辨率不足；PNG 已保存，可手动打开 ${imagePath} 扫码）\n`);
    }
    process.stderr.write(`🖼️  QR 图片本地路径：${imagePath}\n`);
    process.stderr.write(`⏳ 等待扫码（超时 ${Math.round(timeoutMs / 1000)}s）...\n\n`);
  };
}

export async function resolveLoginAuthTarget({ account, authStatePath } = {}, token = randomUUID()) {
  if (authStatePath) {
    const accountContext = await resolveAccountContext({ account, authStatePath });
    return { accountContext, authPath: accountContext.authPath };
  }
  const accountContext = account
    ? await resolveAccountContext({ account })
    : { account: null, source: 'pending' };
  return { accountContext, authPath: accountContext.authPath ?? merchantPendingAuthStatePath(token) };
}

export async function runInteractiveLogin(options = {}) {
  const {
    json = false,
    command = 'init',
    authStatePath,
    timeoutMs,
    timeout,
    qr = false,
    headed = false,
    account,
  } = options;

  const { accountContext, authPath: resolvedAuthPath } = await resolveLoginAuthTarget({ account, authStatePath });

  const globalTimeout = typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined;
  const effectiveTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
    ? timeoutMs
    : (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  const qrCaptureTimeoutMs = globalTimeout ?? TIMEOUTS.QR_CAPTURE;

  const startedAt = Date.now();
  const deadlineAt = startedAt + effectiveTimeout;
  // expectedMallId 交给登录流程校验，店铺不一致时由 assertMerchantVerified 抛 E_ACCOUNT_IDENTITY_MISMATCH。
  const work = async ({ initialRevisions, registryToken }) => {
    const login = qr ? performQrLogin : performHeadedLogin;
    const result = await login({
      authStatePath: resolvedAuthPath,
      timeoutMs: effectiveTimeout,
      headed,
      qrCaptureTimeoutMs,
      expectedMallId: accountContext.account?.mallId,
      signal: options.signal,
      deadlineAt,
      onQrCaptured: qr ? buildQrCallback({ json, command, timeoutMs: effectiveTimeout }) : undefined,
    });
    const provisioned = isMockEnabled() || accountContext.source === 'explicit-path'
      ? null
      : await provisionMerchantAuth(result.path, result.identity, { candidate: result.candidate, initialRevisions, registryToken, signal: options.signal, deadlineAt });
    return emit({
      ok: true,
      command,
      data: toMerchantLoginView(result, provisioned),
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    }, { json });
  };
  try {
    if (accountContext.source === 'explicit-path') return await work({});
    return await withMerchantLoginRegistration(work, { signal: options.signal, deadlineAt });
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: Date.now() - startedAt });
    return emit(envelope, { json });
  } finally {
    if (accountContext.source === 'pending') await deleteAuthState(resolvedAuthPath).catch(() => {});
  }
}

export async function run(options = {}) {
  return runInteractiveLogin({ ...options, command: 'init' });
}

export default run;
export { DEFAULT_AUTH_STATE_PATH };
