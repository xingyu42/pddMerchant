import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { captureConsumerQr, CONSUMER_LOGIN_URL } from '../../src/adapter/consumer-qr-login.js';
import { ensureQrTab, extractElementImage, findQrElement } from '../../src/adapter/qr-login.js';
import { ExitCodes } from '../../src/infra/errors.js';

function createFakeImageElement({
  width = 350,
  height = 350,
  ready = true,
  dataUrl = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')}`,
  screenshotBuffer = Buffer.from('png-screenshot'),
} = {}) {
  return {
    boundingBox: async () => ({ width, height }),
    evaluate: async (fn) => {
      const source = fn.toString();
      if (source.includes('naturalWidth')) return ready;
      if (dataUrl === null) return null;
      return { type: 'dataUrl', data: dataUrl };
    },
    screenshot: vi.fn(async () => screenshotBuffer),
  };
}

describe('qr-login multi-element and tab helpers', () => {
  it('findQrElement scans all matches from page.$$ and skips non-square logos before the QR image', async () => {
    const logo = createFakeImageElement({ width: 281, height: 98, ready: true });
    const qr = createFakeImageElement({ width: 350, height: 350, ready: true });
    const page = {
      $$: async (selector) => (selector === '[class*="qr-code"] img' ? [logo, qr] : []),
      $: async () => logo,
      waitForTimeout: async () => {},
    };

    const hit = await findQrElement(page, {
      timeoutMs: 0,
      selectors: ['[class*="qr-code"] img'],
    });
    assert.ok(hit);
    assert.equal(hit.element, qr);
    assert.equal(hit.selector, '[class*="qr-code"] img');
  });

  it('findQrElement falls back to page.$ when page.$$ is not implemented', async () => {
    const qr = createFakeImageElement({ width: 120, height: 120, ready: true });
    const page = {
      $: async (selector) => (selector === '[class*="qr-code"] canvas' ? qr : null),
      waitForTimeout: async () => {},
    };

    const hit = await findQrElement(page, {
      timeoutMs: 0,
      selectors: ['[class*="qr-code"] canvas'],
    });
    assert.ok(hit);
    assert.equal(hit.element, qr);
  });

  it('ensureQrTab continues to later selectors when click rejects and returns false when none succeed', async () => {
    const clicks = [];
    const pageWithFallback = {
      $: async (selector) => {
        if (selector === 'text=扫码登录') {
          return { click: async () => { throw new Error('detached'); } };
        }
        if (selector === '.qrcode-login') {
          return { click: async () => { clicks.push(selector); } };
        }
        return null;
      },
    };
    assert.equal(
      await ensureQrTab(pageWithFallback, { tabSelectors: ['text=扫码登录', '.qrcode-login'] }),
      true,
    );
    assert.deepEqual(clicks, ['.qrcode-login']);

    const pageAllFail = {
      $: async () => ({ click: async () => { throw new Error('not clickable'); } }),
    };
    assert.equal(
      await ensureQrTab(pageAllFail, { tabSelectors: ['text=扫码登录', '.qrcode-login'] }),
      false,
    );
  });

  it('extractElementImage decodes PNG data URLs directly and falls back to screenshot for non-PNG data URLs', async () => {
    const pngPayload = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
    const pngEl = createFakeImageElement({
      dataUrl: `data:image/png;base64,${pngPayload.toString('base64')}`,
    });
    const pngBuf = await extractElementImage({}, pngEl);
    assert.deepEqual(pngBuf, pngPayload);
    assert.equal(pngEl.screenshot.mock.calls.length, 0);

    const jpegEl = createFakeImageElement({
      dataUrl: `data:image/jpeg;base64,${Buffer.from([255, 216, 255]).toString('base64')}`,
      screenshotBuffer: Buffer.from('fallback-png'),
    });
    const fallbackBuf = await extractElementImage({}, jpegEl);
    assert.deepEqual(fallbackBuf, Buffer.from('fallback-png'));
    assert.equal(jpegEl.screenshot.mock.calls.length, 1);
  });
});

describe('captureConsumerQr', () => {
  it('clicks delayed QR tab once, skips logo-img, and captures img.qr-code-box PNG', async () => {
    const expectedPng = Buffer.from([137, 80, 78, 71, 9, 8, 7, 6]);
    const logo = createFakeImageElement({ width: 281, height: 98, ready: true });
    const qrBox = createFakeImageElement({
      width: 350,
      height: 350,
      ready: true,
      dataUrl: `data:image/png;base64,${expectedPng.toString('base64')}`,
    });

    let tick = 0;
    let tabReady = false;
    let qrVisible = false;
    let tabClicks = 0;

    const page = {
      url: () => CONSUMER_LOGIN_URL,
      goto: vi.fn(async () => {}),
      evaluate: async () => 0,
      waitForTimeout: vi.fn(async () => {
        tick += 1;
        if (tick >= 1) tabReady = true;
        if (tick >= 2) qrVisible = true;
      }),
      $: async (selector) => {
        if (selector === 'text=扫码登录' && tabReady) {
          return {
            click: async () => {
              tabClicks += 1;
            },
          };
        }
        return null;
      },
      $$: async (selector) => {
        if (!qrVisible) return [];
        if (selector === 'img.qr-code-box') return [qrBox];
        if (selector === '[class*="qr-code"] img') return [logo, qrBox];
        return [];
      },
    };

    const captured = await captureConsumerQr(page, { timeout: 2000 });
    assert.deepEqual(captured, expectedPng);
    assert.equal(tabClicks, 1);
    assert.equal(page.goto.mock.calls.length, 1);
    assert.equal(page.goto.mock.calls[0][0], CONSUMER_LOGIN_URL);
  });

  it('throws E_QR_NOT_FOUND when no ready QR element appears within timeout', async () => {
    const page = {
      url: () => CONSUMER_LOGIN_URL,
      goto: vi.fn(async () => {}),
      evaluate: async () => 0,
      waitForTimeout: vi.fn(async () => {}),
      $: async () => null,
      $$: async () => [],
    };

    await assert.rejects(
      captureConsumerQr(page, { timeout: 0 }),
      (err) => err?.code === 'E_QR_NOT_FOUND'
        && err?.exitCode === ExitCodes.AUTH
        && err?.detail?.pageUrl === CONSUMER_LOGIN_URL,
    );
  });
});
