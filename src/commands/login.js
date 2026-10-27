import { runInteractiveLogin } from './init.js';
import {
  performConsumerQrLogin,
  performConsumerHeadedLogin,
  renderQrToStream,
} from '../services/auth.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionConsumerAuth } from '../services/auth-account-storage.js';
import { redactValue } from '../infra/logger.js';
import { resolveConsumerAccountContext } from '../infra/consumer-account-resolver.js';
import { toConsumerLoginView } from '../services/views/auth.js';

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

  try {
    const selectedAccount = opts.consumerAccount
      ? await resolveConsumerAccountContext({ account: opts.consumerAccount })
      : null;
    const result = await acquireConsumerLogin(opts, runtimeConfig);
    if (selectedAccount?.account
      && String(selectedAccount.account.identity ?? '') !== String(result.identity?.uid ?? '')) {
      throw new PddCliError({
        code: 'E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH',
        message: '登录后的消费者账号与所选账号不一致',
        hint: '切换到正确账号后重试，或不传 --consumer-account 让系统自动识别',
        exitCode: ExitCodes.AUTH,
      });
    }
    const provisioned = provisionConsumerAuth(result.state, result.identity);
    const envelope = {
      ok: true,
      command,
      data: toConsumerLoginView(result, {
        accountFingerprint: isMockEnabled() ? null : redactValue(provisioned.account.identity), fixture: isMockEnabled(),
      }),
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

async function acquireConsumerLogin(opts, runtimeConfig) {
  const consumerLoginUrl = runtimeConfig?.consumerLoginUrl;
  const qr = opts.qr ?? false;
  if (isMockEnabled()) {
    return { state: { cookies: [], origins: [] }, identity: { uid: 'fixture-consumer', nickname: 'fixture-consumer' },
      url: consumerLoginUrl, mode: qr ? 'consumer-qr' : 'consumer-headed' };
  }
  const login = qr ? performConsumerQrLogin : performConsumerHeadedLogin;
  return login({
    timeoutMs: opts.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED),
    headed: opts.headed ?? false,
    consumerLoginUrl,
    scrapeCooldownConfig: {
      threshold: runtimeConfig?.scrapeSoftBlockThreshold,
      cooldownMs: runtimeConfig?.scrapeSoftBlockCooldownMs,
    },
    onQrCaptured: async ({ qrContent }) => {
      if (qrContent) await renderQrToStream(qrContent);
    },
  });
}
