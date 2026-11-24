import { runInteractiveLogin } from './init.js';
import {
  performConsumerQrLogin,
  performConsumerHeadedLogin,
  renderQrToStream,
} from '../services/auth.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { provisionConsumerAuth } from '../services/auth-account-storage.js';
import { redactValue } from '../infra/logger.js';
import { resolveConsumerAccountContext } from '../infra/consumer-account-resolver.js';
import { toConsumerLoginView } from '../services/views/auth.js';
import { composeCommandRuntime } from '../runtime/command-runtime.js';

export async function run(options = {}, extra = {}) {
  const selfComposed = !extra?.runtime;
  const runtime = extra?.runtime ?? await composeCommandRuntime({
    env: process.env,
    runtimeConfigPolicy: 'maintenance',
    overrides: extra?.runtimeConfig !== undefined ? { runtimeConfig: extra.runtimeConfig } : {},
  });

  try {
    if (options.consumer) {
      return await runConsumerLogin(options, runtime);
    }

    return await runInteractiveLogin({ ...options, command: 'login', runtime });
  } finally {
    if (selfComposed) await runtime.closeAll();
  }
}

async function runConsumerLogin(opts, runtime) {
  const command = 'login.consumer';
  const runtimeConfig = runtime?.runtimeConfig;
  const clockNow = () => (runtime?.clock?.now ? runtime.clock.now() : Date.now());
  const emitResult = runtime?.outputSink?.emit ?? emit;
  const isFixture = runtime?.mode === 'fixture';
  const startedAt = clockNow();

  if (opts.password) {
    const envelope = errorToEnvelope(command, new PddCliError({
      code: 'E_USAGE',
      message: '消费端暂不支持密码登录',
      hint: '使用 pdd login --consumer --qr（扫码）或 pdd login --consumer --headed（有头模式）',
      exitCode: ExitCodes.USAGE,
    }));
    emitResult(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  try {
    const selectedAccount = opts.consumerAccount
      ? await resolveConsumerAccountContext({ account: opts.consumerAccount })
      : null;
    const result = await acquireConsumerLogin(opts, runtimeConfig, runtime);
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
        accountFingerprint: isFixture ? null : redactValue(provisioned.account.identity),
        fixture: isFixture,
      }),
      meta: { latency_ms: clockNow() - startedAt, exit_code: ExitCodes.OK, warnings: [] },
    };
    emitResult(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: clockNow() - startedAt });
    emitResult(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

async function acquireConsumerLogin(opts, runtimeConfig, runtime) {
  const consumerLoginUrl = runtimeConfig?.consumerLoginUrl;
  const qr = opts.qr ?? false;
  if (runtime?.mode === 'fixture') {
    return {
      state: { cookies: [], origins: [] },
      identity: { uid: 'fixture-consumer', nickname: 'fixture-consumer' },
      url: consumerLoginUrl,
      mode: qr ? 'consumer-qr' : 'consumer-headed',
    };
  }
  const login = qr ? performConsumerQrLogin : performConsumerHeadedLogin;
  return login({
    timeoutMs: opts.timeoutMs ?? (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED),
    headed: opts.headed ?? false,
    consumerLoginUrl,
    runtime,
    scrapeCooldown: runtime?.scrapeCooldown,
    onQrCaptured: async ({ qrContent }) => {
      if (qrContent) await renderQrToStream(qrContent);
    },
  });
}
