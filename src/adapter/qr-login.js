import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import qrTerminal from 'qrcode-terminal';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { DATA_DIR as DEFAULT_QR_DIR, ensureDir } from '../infra/paths.js';
import { PDD_HOME } from './auth-state.js';
import { findFirst } from './selector-scan.js';
import { TIMEOUTS } from '../infra/timeouts.js';

export { DEFAULT_QR_DIR };

export const QR_LOGIN_URL = 'https://mms.pinduoduo.com/login.html?login_tab=qrcode';

const QR_SELECTORS = [
  'img.qrcode-img',
  '.qrcode-img img',
  '.qrcode-wrapper img',
  '.qrcode-wrapper canvas',
  'canvas.qrcode-canvas',
  'div.qrcode canvas',
  'div.qrcode img',
  '#qrcode img',
  '#qrcode canvas',
  'img[src*="qrcode"]',
  'img[src^="data:image"]',
  '[class*="qr-code"] img',
  '[class*="qr-code"] canvas',
  '[class*="QrCode"] img',
];

const QR_TAB_SELECTORS = [
  'text=扫码登录',
  'text=微信扫码',
  '[class*="qr-tab"]',
  '[data-test="qrcode-tab"]',
];

async function ensureQrTab(page) {
  const hit = await findFirst(page, QR_TAB_SELECTORS);
  if (!hit) return false;
  try {
    await hit.element.click({ timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function captureQrElement(page, { timeout = TIMEOUTS.QR_CAPTURE } = {}) {
  try {
    await page.goto(QR_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  } catch {
    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  }

  await ensureQrTab(page);

  const hit = await findFirst(page, QR_SELECTORS, { timeoutMs: timeout, pollIntervalMs: 500 });
  if (!hit) {
    throw new PddCliError({
      code: 'E_QR_NOT_FOUND',
      message: '未能在登录页上找到二维码元素',
      hint: '页面结构可能已变更，尝试 pdd init（有头模式）',
      detail: {
        triedSelectors: QR_SELECTORS.length,
        pageUrl: (() => { try { return page.url(); } catch { return null; } })(),
        timeoutMs: timeout,
      },
      exitCode: ExitCodes.AUTH,
    });
  }

  return hit.element.screenshot({ type: 'png' });
}

export async function saveQrPng(pngBuffer, { dir } = {}) {
  const targetDir = dir || DEFAULT_QR_DIR;
  await ensureDir(targetDir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const path = join(targetDir, `qr-${ts}.png`);
  await writeFile(path, pngBuffer);
  return path;
}

export function decodeQrContent(pngBuffer) {
  try {
    const png = PNG.sync.read(pngBuffer);
    const { data, width, height } = png;
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    const code = jsQR(clamped, width, height);
    return code ? code.data : null;
  } catch {
    return null;
  }
}

export function renderQrToStream(content, { small = true, stream = process.stderr } = {}) {
  return new Promise((resolve) => {
    qrTerminal.generate(content, { small }, (output) => {
      stream.write(output);
      stream.write('\n');
      resolve();
    });
  });
}
