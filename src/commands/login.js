import { runInteractiveLogin } from './init.js';
import { loginWithPassword } from '../adapter/password-login.js';
import { launchBrowser, closeBrowser, createConsumerContext } from '../adapter/browser.js';
import {
  captureConsumerQr,
  waitForConsumerLogin,
  saveQrPng,
  decodeQrContent,
  renderQrToStream,
  CONSUMER_LOGIN_URL,
} from '../adapter/consumer-qr-login.js';
import { saveAuthState } from '../adapter/auth-state.js';
import { isMockEnabled } from '../adapter/mock-dispatcher.js';
import { CONSUMER_AUTH_STATE_PATH } from '../infra/paths.js';
import { resolveAccountContext } from '../infra/account-resolver.js';
import { emit } from '../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { promptText, promptPassword } from '../infra/prompts.js';
import { TIMEOUTS } from '../infra/timeouts.js';

export async function run(options = {}) {
  if (options.consumer) {
    return runConsumerLogin(options);
  }
  if (options.password) {
    return runPasswordLogin(options);
  }

  const authStatePath = await resolveAuthPath(options);
  return runInteractiveLogin({ ...options, command: 'login', authStatePath });
}

export async function resolveAuthPath(opts) {
  if (opts.authStatePath) return opts.authStatePath;
  const ctx = await resolveAccountContext(opts.account ? { account: opts.account } : {});
  return ctx.authPath;
}

async function runPasswordLogin(opts) {
  const startedAt = Date.now();
  const log = getLogger();

  try {
    const authPath = await resolveAuthPath(opts);
    const mobile = await promptText('手机号');
    const password = await promptPassword('密码');

    const result = await loginWithPassword({
      mobile,
      password,
      authStatePath: authPath,
      headed: opts.headed,
      log,
    });

    const envelope = {
      ok: true,
      command: 'login',
      data: result,
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  } catch (err) {
    const envelope = errorToEnvelope('login', err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

export default run;

async function runConsumerLogin(opts) {
  const command = 'login.consumer';
  const startedAt = Date.now();
  const log = getLogger();

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
      data: { path: authStatePath, url: 'https://mobile.yangkeduo.com/', mode, message: '消费端授权成功（mock）' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  try {
    if (qr) {
      return await runConsumerQrLogin({ command, authStatePath, timeoutMs, headed, startedAt, json: opts.json, noColor: opts.noColor, log });
    }
    return await runConsumerHeadedLogin({ command, authStatePath, timeoutMs, startedAt, json: opts.json, noColor: opts.noColor, log });
  } catch (err) {
    const envelope = errorToEnvelope(command, err, { latency_ms: Date.now() - startedAt });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }
}

async function runConsumerQrLogin({ command, authStatePath, timeoutMs, headed, startedAt, json, noColor, log }) {
  let browser = null;
  try {
    const launched = await launchBrowser({ headed });
    browser = launched.browser;
    const consumer = await createConsumerContext(browser);

    log.info({ command, headed }, '消费端：抓取登录二维码中');
    const pngBuffer = await captureConsumerQr(consumer.page);
    const imagePath = await saveQrPng(pngBuffer);
    const qrContent = decodeQrContent(pngBuffer);

    if (qrContent) {
      await renderQrToStream(qrContent);
    }
    log.info({ command, imagePath, qrContentPresent: Boolean(qrContent) }, '消费端 QR 已就绪，等待扫码');

    const result = await waitForConsumerLogin(consumer.page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: `QR 可能已过期，重新执行 pdd login --consumer --qr；或查看 ${imagePath}`,
        detail: { imagePath, qr_content_present: Boolean(qrContent) },
        exitCode: ExitCodes.AUTH,
      });
    }

    const savedPath = await saveAuthState(consumer.context, authStatePath);
    const envelope = {
      ok: true,
      command,
      data: { path: savedPath, url: result.url, mode: 'qr', qrImagePath: imagePath, message: '消费端授权成功' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json, noColor });
    return envelope;
  } finally {
    await closeBrowser(browser);
  }
}

async function runConsumerHeadedLogin({ command, authStatePath, timeoutMs, startedAt, json, noColor, log }) {
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: true, storageStatePath: null });
    browser = launched.browser;
    const { context, page } = launched;

    const loginUrl = CONSUMER_LOGIN_URL;
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
    log.info({ command }, `消费端：等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);

    const result = await waitForConsumerLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `消费端登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: '重新执行 pdd login --consumer',
        exitCode: ExitCodes.AUTH,
      });
    }

    const savedPath = await saveAuthState(context, authStatePath);
    const envelope = {
      ok: true,
      command,
      data: { path: savedPath, url: result.url, mode: 'headed', message: '消费端授权成功' },
      meta: { latency_ms: Date.now() - startedAt, warnings: [] },
    };
    emit(envelope, { json, noColor });
    return envelope;
  } finally {
    await closeBrowser(browser);
  }
}
