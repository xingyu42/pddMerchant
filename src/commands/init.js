import { performQrLogin, performHeadedLogin, renderQrToStream } from '../services/auth.js';
import { emit } from '../infra/output.js';
import { errorToEnvelope } from '../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../infra/paths.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { TIMEOUTS } from '../infra/timeouts.js';

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

  let resolvedAuthPath = authStatePath ?? DEFAULT_AUTH_STATE_PATH;
  if (account && !authStatePath) {
    const ctx = await resolveAccountContext({ account });
    resolvedAuthPath = ctx.authPath;
  }

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
    return emit({
      ok: true,
      command,
      data: {
        path: result.path,
        url: result.url,
        mode: result.mode,
        ...(result.qrImagePath ? { qrImagePath: result.qrImagePath } : {}),
        ...(result.qrContentPresent !== undefined ? { qrContentPresent: result.qrContentPresent } : {}),
        message: '授权成功，试试 pdd orders list',
      },
      meta: { latency_ms: Date.now() - startedAt },
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
