import { runInteractiveLogin } from './init.js';
import {
  performConsumerQrLogin,
  performConsumerHeadedLogin,
  renderQrToStream,
} from '../services/auth.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { CONSUMER_AUTH_STATE_PATH } from '../infra/paths.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';

export async function run(options = {}, { runtimeConfig } = {}) {
  if (options.consumer) {
    return runConsumerLogin(options, runtimeConfig);
  }

  const authStatePath = await resolveAuthPath(options);
  return runInteractiveLogin({ ...options, command: 'login', authStatePath });
}

export async function resolveAuthPath(opts) {
  if (opts.authStatePath) return opts.authStatePath;
  const ctx = await resolveAccountContext(opts.account ? { account: opts.account } : {});
  return ctx.authPath;
}

export default run;

async function runConsumerLogin(opts, runtimeConfig) {
  const command = 'login.consumer';
  const startedAt = Date.now();
  const consumerLoginUrl = runtimeConfig?.consumerLoginUrl;

  if (opts.password) {
    const envelope = errorToEnvelope(command, new PddCliError({
      code: 'E_USAGE',
      message: '消费端暂不支持密码登录',
      hint: '使用 pdd login --consumer --qr（扫码）或 pdd login --consumer --headed（有头模式）',
      exitCode: ExitCodes.USAGE,
    }));
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  const authStatePath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || CONSUMER_AUTH_STATE_PATH;
  const headed = opts.headed ?? false;
  const qr = opts.qr ?? false;
  const timeoutMs = opts.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);

  if (isMockEnabled()) {
    const mode = qr ? 'qr' : 'headed';
    const envelope = {
      ok: true,
      command,
      data: { path: authStatePath, url: consumerLoginUrl, mode, message: '消费端授权成功（mock）' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  try {
    let result;
    if (qr) {
      result = await performConsumerQrLogin({
        authStatePath,
        timeoutMs,
        headed,
        consumerLoginUrl,
        scrapeCooldownConfig: {
          threshold: runtimeConfig?.scrapeSoftBlockThreshold,
          cooldownMs: runtimeConfig?.scrapeSoftBlockCooldownMs,
        },
        onQrCaptured: async ({ imagePath, qrContent }) => {
          if (qrContent) await renderQrToStream(qrContent);
        },
      });
    } else {
      result = await performConsumerHeadedLogin({
        authStatePath,
        timeoutMs,
        consumerLoginUrl,
        scrapeCooldownConfig: {
          threshold: runtimeConfig?.scrapeSoftBlockThreshold,
          cooldownMs: runtimeConfig?.scrapeSoftBlockCooldownMs,
        },
      });
    }

    const envelope = {
      ok: true,
      command,
      data: { path: result.path, url: result.url, mode: result.mode, ...(result.qrImagePath ? { qrImagePath: result.qrImagePath } : {}), message: '消费端授权成功' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}
