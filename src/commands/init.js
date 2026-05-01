import { launchBrowser, closeBrowser } from '../adapter/browser.js';
import { saveAuthState, PDD_HOME } from '../adapter/auth-state.js';
import {
  captureQrElement,
  saveQrPng,
  decodeQrContent,
  renderQrToStream,
} from '../adapter/qr-login.js';
import { emit } from '../infra/output.js';
import { getLogger } from '../infra/logger.js';
import { PddCliError, ExitCodes, errorToEnvelope } from '../infra/errors.js';
import { AUTH_STATE_PATH as DEFAULT_AUTH_STATE_PATH } from '../infra/paths.js';
import { TIMEOUTS } from '../infra/timeouts.js';

async function waitForLogin(page, { timeoutMs }) {
  try {
    await page.waitForURL(
      (url) => {
        const u = new URL(url.toString());
        return u.hostname.includes('mms.pinduoduo.com') && !u.pathname.startsWith('/login');
      },
      { timeout: timeoutMs }
    );
    return { success: true, url: page.url() };
  } catch (err) {
    return { success: false, url: page.url(), error: err?.message || 'timeout' };
  }
}

async function runHeadedLogin({ command, authStatePath, timeoutMs, json, startedAt }) {
  const log = getLogger();
  let browser = null;
  try {
    const launched = await launchBrowser({ headed: true });
    browser = launched.browser;
    const { page, context } = launched;

    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
    log.info({ command }, `等待手动登录（最长 ${Math.round(timeoutMs / 60000)} 分钟）`);

    const result = await waitForLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: `重新执行 pdd ${command}`,
        exitCode: ExitCodes.AUTH,
      });
    }

    const savedPath = await saveAuthState(context, authStatePath);
    return emit(
      {
        ok: true,
        command,
        data: {
          path: savedPath,
          url: result.url,
          mode: 'headed',
          message: '授权成功，试试 pdd orders list',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  } finally {
    await closeBrowser(browser);
  }
}

async function runQrLogin({ command, authStatePath, timeoutMs, json, startedAt, headed, qrCaptureTimeoutMs }) {
  const log = getLogger();
  let browser = null;
  try {
    const launched = await launchBrowser({ headed });
    browser = launched.browser;
    const { page, context } = launched;

    log.info({ command, headed }, '无头模式：抓取登录二维码中');
    const pngBuffer = await captureQrElement(page, { timeout: qrCaptureTimeoutMs });
    const imagePath = await saveQrPng(pngBuffer);
    log.debug({ command, imagePath }, 'QR PNG 已保存');
    const qrContent = decodeQrContent(pngBuffer);
    log.debug({ command, decoded: Boolean(qrContent) }, 'QR 解码结果');

    if (!json) {
      process.stderr.write('\n📱 请使用拼多多商家 App 扫码登录：\n\n');
      if (qrContent) {
        await renderQrToStream(qrContent);
      } else {
        process.stderr.write(`（QR 解码失败：截图可能含周围留白或分辨率不足；PNG 已保存，可手动打开 ${imagePath} 扫码）\n`);
      }
      process.stderr.write(`🖼️  QR 图片本地路径：${imagePath}\n`);
      process.stderr.write(`⏳ 等待扫码（超时 ${Math.round(timeoutMs / 1000)}s）...\n\n`);
    }

    if (json) {
      const truncatedQr = qrContent && qrContent.length > 16384
        ? qrContent.slice(0, 16384)
        : qrContent;
      const intermediateWarnings = [];
      if (truncatedQr !== qrContent) intermediateWarnings.push('qr_content_truncated');
      intermediateWarnings.push('qr_pending');
      emit(
        {
          ok: true,
          command: `${command}.qr_pending`,
          data: {
            qr_image_path: imagePath,
            qr_content: truncatedQr || null,
          },
          meta: { warnings: intermediateWarnings },
        },
        { json: true }
      );
    }

    const result = await waitForLogin(page, { timeoutMs });
    if (!result.success) {
      throw new PddCliError({
        code: 'E_AUTH_TIMEOUT',
        message: `登录超时：${Math.round(timeoutMs / 1000)}s 内未检测到登录成功`,
        hint: `QR 可能已过期，重新执行 pdd ${command} --qr；或查看 ${imagePath}`,
        detail: { imagePath, qrContent },
        exitCode: ExitCodes.AUTH,
      });
    }

    const savedPath = await saveAuthState(context, authStatePath);
    return emit(
      {
        ok: true,
        command,
        data: {
          path: savedPath,
          url: result.url,
          mode: 'qr',
          qrImagePath: imagePath,
          qrContent: qrContent || null,
          message: '授权成功，试试 pdd orders list',
        },
        meta: { latency_ms: Date.now() - startedAt },
      },
      { json }
    );
  } finally {
    await closeBrowser(browser);
  }
}

export async function runInteractiveLogin(options = {}) {
  const {
    json = false,
    command = 'init',
    authStatePath = DEFAULT_AUTH_STATE_PATH,
    timeoutMs,
    timeout,
    qr = false,
    headed = false,
  } = options;

  const globalTimeout = typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : undefined;
  const effectiveTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
    ? timeoutMs
    : (qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED);
  const qrCaptureTimeoutMs = globalTimeout ?? TIMEOUTS.QR_CAPTURE;

  const startedAt = Date.now();
  try {
    if (qr) {
      return await runQrLogin({
        command,
        authStatePath,
        timeoutMs: effectiveTimeout,
        json,
        startedAt,
        headed,
        qrCaptureTimeoutMs,
      });
    }
    return await runHeadedLogin({ command, authStatePath, timeoutMs: effectiveTimeout, json, startedAt });
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
