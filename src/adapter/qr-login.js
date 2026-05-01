import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import qrTerminal from 'qrcode-terminal';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { DATA_DIR as DEFAULT_QR_DIR, ensureDir } from '../infra/paths.js';
import { PDD_HOME } from './auth-state.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { getLogger } from '../infra/logger.js';

export { DEFAULT_QR_DIR };

export const QR_LOGIN_URL = 'https://mms.pinduoduo.com/login/?login_tab=qrcode';

const MIN_QR_SIZE = 80;
const MAX_QR_ASPECT_RATIO = 1.4;

const QR_SELECTORS = [
  '.qr-code canvas',
  '.scan-login canvas',
  'div.qrcode canvas',
  'canvas.qrcode-canvas',
  '.qrcode-wrapper canvas',
  '#qrcode canvas',
  '[class*="qr-code"] canvas',
  '[class*="QrCode"] canvas',
  '[class*="qrcode"] canvas',
  '[class*="login-qr"] canvas',
  'img.qrcode-img',
  '.qrcode-img img',
  '.qrcode-wrapper img',
  'div.qrcode img',
  '#qrcode img',
  'img[src*="qrcode"]',
  '[class*="qr-code"] img',
  '[class*="QrCode"] img',
  '[class*="qrcode"] img',
  '[class*="login-qr"] img',
];

const QR_TAB_SELECTORS = [
  'text=扫码登录',
  'text=微信扫码',
  '[class*="qr-tab"]',
  '[data-test="qrcode-tab"]',
];

async function ensureQrTab(page) {
  for (const sel of QR_TAB_SELECTORS) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ timeout: 2000 });
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

async function isQrReady(element) {
  try {
    const box = await element.boundingBox();
    if (!box) return false;
    if (box.width < MIN_QR_SIZE || box.height < MIN_QR_SIZE) return false;
    const ratio = Math.max(box.width, box.height) / Math.min(box.width, box.height);
    if (ratio > MAX_QR_ASPECT_RATIO) return false;

    const loaded = await element.evaluate(el => {
      if (el.tagName === 'IMG') {
        if (!el.complete || el.naturalWidth === 0) return false;
        try {
          const c = document.createElement('canvas');
          const w = Math.min(el.naturalWidth, 30);
          const h = Math.min(el.naturalHeight, 30);
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(el, 0, 0, w, h);
          const d = c.getContext('2d').getImageData(0, 0, w, h).data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) return true;
          }
          return false;
        } catch {
          return el.complete && el.naturalWidth > 0;
        }
      }
      if (el.tagName === 'CANVAS') {
        try {
          const ctx = el.getContext('2d');
          const d = ctx.getImageData(0, 0, Math.min(el.width, 30), Math.min(el.height, 30)).data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) return true;
          }
        } catch { return true; }
        return false;
      }
      return true;
    });
    return loaded;
  } catch {
    return false;
  }
}

async function findQrElement(page, { timeoutMs = 0, pollIntervalMs = 500 } = {}) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const log = getLogger();
  do {
    for (const sel of QR_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (el && await isQrReady(el)) {
          log.debug({ selector: sel }, 'QR element matched');
          return { element: el, selector: sel };
        }
      } catch { /* try next */ }
    }
    if (timeoutMs > 0 && Date.now() < deadline) {
      const wait = Math.min(pollIntervalMs, deadline - Date.now());
      if (wait > 0) await page.waitForTimeout(wait);
    }
  } while (timeoutMs > 0 && Date.now() < deadline);
  return null;
}

function upgradeQrImageUrl(url) {
  if (!url || !url.includes('imageView2')) return url;
  return url
    .replace(/\/w\/\d+/, '/w/400')
    .replace(/\/q\/\d+/, '/q/100');
}

async function extractElementImage(page, element) {
  const info = await element.evaluate(el => {
    if (el.tagName === 'CANVAS') {
      try { return { type: 'dataUrl', data: el.toDataURL('image/png') }; }
      catch { return null; }
    }
    if (el.tagName === 'IMG') {
      if (el.src && el.src.startsWith('data:image/')) {
        return { type: 'dataUrl', data: el.src };
      }
      if (el.src) return { type: 'url', data: el.src };
    }
    return null;
  });

  if (info?.type === 'dataUrl') {
    const match = info.data.match(/^data:image\/\w+;base64,(.+)$/);
    if (match) return Buffer.from(match[1], 'base64');
  }

  if (info?.type === 'url') {
    const fetchUrl = upgradeQrImageUrl(info.data);
    try {
      const base64 = await page.evaluate(async (url) => {
        const r = await fetch(url);
        const ab = await r.arrayBuffer();
        const u8 = new Uint8Array(ab);
        let bin = '';
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
      }, fetchUrl);
      if (base64) return Buffer.from(base64, 'base64');
    } catch { /* fall through */ }
  }

  return element.screenshot({ type: 'png' });
}

async function dismissModalOverlay(page) {
  const removed = await page.evaluate(() => {
    let count = 0;
    document.querySelectorAll('[data-testid="beast-core-modal"]').forEach(el => { el.remove(); count++; });
    document.querySelectorAll('[class*="MDL_outerWrapper"]').forEach(el => { el.remove(); count++; });
    return count;
  });
  if (removed > 0) await page.waitForTimeout(500);
  return removed > 0;
}

export async function captureQrElement(page, { timeout = TIMEOUTS.QR_CAPTURE } = {}) {
  try {
    await page.goto(QR_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  } catch {
    await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAV });
  }

  await page.waitForTimeout(1500);
  await dismissModalOverlay(page);
  await ensureQrTab(page);

  const hit = await findQrElement(page, { timeoutMs: timeout, pollIntervalMs: 500 });
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

  return extractElementImage(page, hit.element);
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
