import { performQrLogin, performHeadedLogin, renderQrToStream } from '../services/auth.js';
import { emit } from '../infra/output.js';
import { ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionMerchantLogin } from '../services/auth-account-storage.js';
import { toMerchantLoginView } from '../services/views/auth.js';

function buildQrCallback({ json, timeoutMs }) {
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

async function resolveLoginAuthTarget({ account } = {}) {
  return account ? resolveAccountContext({ account, needsAuth: false }) : { accountId: null, account: null };
}

export async function runInteractiveLogin(options = {}, extra = {}) {
  const { json = false, command = 'init', qr = false, headed = false } = options;
  const runtime = options.runtime ?? extra?.runtime;
  const clockNow = () => (runtime?.clock?.now ? runtime.clock.now() : Date.now());
  const emitResult = runtime?.outputSink?.emit ?? emit;
  const startedAt = clockNow();
  try {
    const target = await resolveLoginAuthTarget(options);
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? options.timeoutMs : (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
    const deadlineAt = startedAt + timeoutMs;
    const provisioned = await provisionMerchantLogin(async (transaction) => {
      const login = qr ? performQrLogin : performHeadedLogin;
      return login({
        transaction, timeoutMs, headed,
        qrCaptureTimeoutMs: typeof options.timeout === 'number' && Number.isFinite(options.timeout)
          ? options.timeout : TIMEOUTS.QR_CAPTURE,
        expectedMallId: target.account?.identity,
        signal: options.signal, deadlineAt,
        onQrCaptured: qr ? buildQrCallback({ json, timeoutMs }) : undefined,
        runtime,
      });
    }, { accountId: target.accountId, signal: options.signal, deadlineAt, seal: runtime?.seal, clock: runtime?.clock });
    return emitResult({
      ok: true, command, data: toMerchantLoginView(provisioned.result, provisioned),
      meta: { latency_ms: clockNow() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    }, { json, noColor: options.noColor });
  } catch (error) {
    return emitResult(errorToEnvelope(command, error, { latency_ms: clockNow() - startedAt }), { json, noColor: options.noColor });
  }
}

export async function run(options = {}, extra = {}) {
  return runInteractiveLogin({ ...options, command: 'init', runtime: options.runtime ?? extra?.runtime });
}
