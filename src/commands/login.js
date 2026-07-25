import { runInteractiveLogin } from './init.js';
import {
  performConsumerQrLogin,
  performConsumerHeadedLogin,
  renderQrToStream,
} from '../services/auth.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { consumerPendingAuthStatePath } from '../infra/paths.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionConsumerAuth } from '../services/auth-account-storage.js';
import { redactValue } from '../infra/logger.js';
import { resolveConsumerAccountContext } from '../infra/consumer-account-resolver.js';
import { randomUUID } from 'node:crypto';

export async function run(options = {}, { runtimeConfig } = {}) {
  if (options.consumer) {
    return runConsumerLogin(options, runtimeConfig);
  }

  return runInteractiveLogin({ ...options, command: 'login' });
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

  const explicitAuthPath = process.env.PDD_CONSUMER_AUTH_STATE_PATH || null;
  const authStatePath = explicitAuthPath || consumerPendingAuthStatePath(randomUUID());
  const headed = opts.headed ?? false;
  const qr = opts.qr ?? false;
  const timeoutMs = opts.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);

  if (isMockEnabled()) {
    const mode = qr ? 'qr' : 'headed';
    const envelope = {
      ok: true,
      command,
      data: { url: consumerLoginUrl, mode, message: '消费端授权成功（mock）' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  try {
    const selectedAccount = opts.consumerAccount
      ? await resolveConsumerAccountContext({ account: opts.consumerAccount })
      : null;
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

    if (selectedAccount?.account
      && String(selectedAccount.account.uid ?? '') !== String(result.identity?.uid ?? '')) {
      throw new PddCliError({
        code: 'E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH',
        message: '登录后的消费者账号与所选账号不一致',
        hint: '切换到正确账号后重试，或不传 --consumer-account 让系统自动识别',
        exitCode: ExitCodes.AUTH,
      });
    }
    const provisioned = explicitAuthPath ? null : await provisionConsumerAuth(result.path, result.identity);
    const envelope = {
      ok: true,
      command,
      data: {
        url: result.url,
        mode: result.mode,
        ...(provisioned ? { account: redactValue(provisioned.account.uid) } : {}),
        ...(result.qrImagePath ? { qrImagePath: result.qrImagePath } : {}),
        message: '消费端授权成功',
      },
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
