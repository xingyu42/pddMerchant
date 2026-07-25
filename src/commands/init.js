import { performQrLogin, performHeadedLogin, renderQrToStream } from '../services/auth.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH, merchantPendingAuthStatePath } from '../infra/paths.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { ensureDaemonRunning } from '../infra/daemon-launcher.js';
import { getLogger } from '../infra/logger.js';
import { provisionMerchantAuth } from '../services/auth-account-storage.js';
import { randomUUID } from 'node:crypto';

function buildQrCallback({ json, command, timeoutMs }) {
  return async ({ imagePath, qrContent }) => {
    if (json) {
      emit({
        ok: true,
        command: `${command}.qr_pending`,
        data: { qr_image_path: imagePath, qr_content_present: Boolean(qrContent) },
        meta: { warnings: ['qr_pending'] },
      }, { json: true });
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

async function startDaemonAfterLogin() {
  try {
    const result = await ensureDaemonRunning();
    return result.confirmed === false ? ['daemon_start_unconfirmed'] : [];
  } catch (err) {
    getLogger().warn({ code: err?.code ?? null }, 'login: daemon auto-start failed');
    return ['daemon_start_failed'];
  }
}

export async function resolveLoginAuthTarget({ account, authStatePath } = {}, token = randomUUID()) {
  if (authStatePath) {
    const accountContext = await resolveAccountContext({ account, authStatePath });
    return { accountContext, authPath: accountContext.authPath };
  }
  const accountContext = account
    ? await resolveAccountContext({ account })
    : { account: null, source: 'pending' };
  return { accountContext, authPath: merchantPendingAuthStatePath(token) };
}

function assertSelectedMerchantIdentity(accountContext, identity) {
  if (!accountContext?.account) return;
  if (String(accountContext.account.mallId ?? '') === String(identity?.mallId ?? '')) return;
  throw new PddCliError({
    code: 'E_ACCOUNT_IDENTITY_MISMATCH',
    message: '登录后的店铺与所选账号不一致',
    hint: '切换到正确店铺后重试，或不传 --account 让系统自动识别',
    exitCode: ExitCodes.AUTH,
  });
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
  try {
    let result;
    if (qr) {
      result = await performQrLogin({
        authStatePath: resolvedAuthPath,
        timeoutMs: effectiveTimeout,
        headed,
        qrCaptureTimeoutMs,
        onQrCaptured: buildQrCallback({ json, command, timeoutMs: effectiveTimeout }),
      });
    } else {
      result = await performHeadedLogin({
        authStatePath: resolvedAuthPath,
        timeoutMs: effectiveTimeout,
      });
    }
    assertSelectedMerchantIdentity(accountContext, result.identity);
    const provisioned = accountContext.source === 'explicit-path'
      ? null
      : await provisionMerchantAuth(result.path, result.identity);
    const warnings = await startDaemonAfterLogin();
    return emit({
      ok: true,
      command,
      data: {
        url: result.url,
        mode: result.mode,
        ...(provisioned ? {
          account: provisioned.account.slug,
          displayName: provisioned.account.displayName,
          mallId: provisioned.account.mallId,
        } : {}),
        ...(result.qrImagePath ? { qrImagePath: result.qrImagePath } : {}),
        ...(result.qrContentPresent !== undefined ? { qrContentPresent: result.qrContentPresent } : {}),
        message: '授权成功，试试 pdd orders list',
      },
      meta: { latency_ms: Date.now() - startedAt, warnings },
    }, { json });
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: Date.now() - startedAt });
    return emit(envelope, { json });
  }
}

export async function run(options = {}) {
  return runInteractiveLogin({ ...options, command: 'init' });
}

export default run;
export { DEFAULT_AUTH_STATE_PATH };
