import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it, vi } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { createScrapeCooldown } from '../../src/infra/scrape-cooldown.js';
import { insertAccount } from '../../src/infra/account-store.js';
import {
  createQrTerminalPresenter,
  loginConsumer,
  loginMerchant,
  performQrLogin,
  performHeadedLogin,
  performConsumerQrLogin,
  performConsumerHeadedLogin,
} from '../../src/services/auth.js';
import * as fixtureMall from '../../src/adapter/fixtures/mall.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

const sandboxes = [];
const tempDirs = [];

function makeSandbox(fixtures = {}) {
  const sandbox = createCliSandbox(fixtures);
  sandboxes.push(sandbox);
  return sandbox;
}

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-auth-svc-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (sandboxes.length > 0) {
    sandboxes.pop().dispose();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('fixture merchant auth verification without ports.auth', () => {
  it('exposes verifyFixtureMerchantContext on fixture runtime bound to bundle seal and fixtureStore', async () => {
    const sandbox = makeSandbox({
      'shops.current.json': { id: '900123', name: 'Bundle Shop' },
    });
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: { PDD_TEST_FIXTURE_DIR: sandbox.fixtureDir },
    });

    try {
      assert.equal(typeof runtime.fixture.verifyFixtureMerchantContext, 'function');
      const verified = await runtime.fixture.verifyFixtureMerchantContext(null, {
        expectedMallId: '900123',
      });
      assert.equal(verified.verdict, 'verified');
      assert.deepEqual(verified.identity, { mallId: '900123', displayName: 'Bundle Shop' });
      assert.equal(runtime.seal.has(verified.candidate), true);

      await assert.rejects(
        runtime.fixture.verifyFixtureMerchantContext(null, { seal: null }),
        { code: 'E_CONFIG_INVALID' },
      );
    } finally {
      await runtime.closeAll();
    }
  });

  it('performQrLogin and performHeadedLogin pass runtime.seal and use runtime.fixture when ports.auth is absent', async () => {
    const sandbox = makeSandbox({
      'shops.current.json': { id: '900456', name: 'No AuthPort Shop' },
    });
    const composed = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: { PDD_TEST_FIXTURE_DIR: sandbox.fixtureDir },
    });

    try {
      const runtimeWithoutAuthPort = {
        mode: 'fixture',
        seal: composed.seal,
        fixture: composed.fixture,
      };
      const qrResult = await performQrLogin({
        transaction: {},
        expectedMallId: '900456',
        runtime: runtimeWithoutAuthPort,
      });
      assert.deepEqual(qrResult.identity, { mallId: '900456', displayName: 'No AuthPort Shop' });
      assert.equal(qrResult.mode, 'qr');
      assert.equal(composed.seal.has(qrResult.candidate), true);

      const customSeal = createCandidateSeal();
      const headedResult = await performHeadedLogin({
        transaction: {},
        expectedMallId: '900456',
        seal: customSeal,
        runtime: { mode: 'fixture', fixture: composed.fixture },
      });
      assert.equal(headedResult.mode, 'headed');
      assert.equal(customSeal.has(headedResult.candidate), true);
    } finally {
      await composed.closeAll();
    }
  });

  it('performQrLogin passes runtime.seal when both ports.auth and runtime.fixture are absent', async () => {
    vi.spyOn(fixtureMall, 'mockCurrentMall').mockResolvedValue({ id: '900789', name: 'Fallback Fixture Shop' });
    const seal = createCandidateSeal();
    const result = await performQrLogin({
      transaction: {},
      expectedMallId: '900789',
      runtime: { mode: 'fixture', seal },
    });
    assert.deepEqual(result.identity, { mallId: '900789', displayName: 'Fallback Fixture Shop' });
    assert.equal(seal.has(result.candidate), true);
  });
});

function createFakeConsumerPage(context, { loginSuccess = true, includeQr = false } = {}) {
  const emitter = new EventEmitter();
  let currentUrl = 'https://mobile.yangkeduo.com/login.html';
  let closed = false;
  let evalCount = 0;

  const qrElement = {
    boundingBox: async () => ({ width: 120, height: 120 }),
    evaluate: async () => {
      evalCount += 1;
      if (evalCount === 1) return true;
      return {
        type: 'dataUrl',
        data: `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`,
      };
    },
    screenshot: async () => Buffer.from([137, 80, 78, 71]),
  };

  const page = {
    context: () => context,
    on: (event, fn) => emitter.on(event, fn),
    off: (event, fn) => emitter.off(event, fn),
    url: () => currentUrl,
    waitForTimeout: async () => {},
    evaluate: async () => 0,
    $: async (selector) => (includeQr && selector === '[class*="qr-code"] canvas' ? qrElement : null),
    goto: async (url) => {
      currentUrl = url;
    },
    waitForURL: async () => {
      if (!loginSuccess) {
        throw new Error('login timed out');
      }
      currentUrl = 'https://mobile.yangkeduo.com/home';
      await Promise.all(
        emitter.listeners('response').map((listener) => listener({
          url: () => 'https://mobile.yangkeduo.com/proxy/api/api/apollo/v3/user/me',
          status: () => 200,
          json: async () => ({ uid: '880011', nickname: 'Consumer Buyer' }),
        })),
      );
    },
    close: async () => {
      closed = true;
    },
    get isClosed() {
      return closed;
    },
  };
  return page;
}

describe('consumer login BrowserRuntimePort wiring', () => {
  it('performConsumerHeadedLogin uses runtime.ports.browser and resets runtime.scrapeCooldown on success, closing session on success and timeout', async () => {
    const pages = [];
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const page = createFakeConsumerPage(context, { loginSuccess: true });
        pages.push(page);
        return page;
      },
    });
    const scrapeCooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
    assert.throws(() => scrapeCooldown.check(), { code: 'E_RATE_LIMIT' });

    const res = await performConsumerHeadedLogin({
      timeoutMs: 5000,
      consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      runtime: { ports: { browser }, scrapeCooldown },
    });
    assert.equal(browser.launches.length, 1);
    assert.equal(browser.launches[0].headed, true);
    assert.deepEqual(res.identity, { uid: '880011', nickname: 'Consumer Buyer' });
    assert.equal(res.mode, 'consumer-headed');
    assert.equal(res.url, 'https://mobile.yangkeduo.com/home');
    assert.equal(pages[0].isClosed, true);
    assert.equal(scrapeCooldown.status().consecutiveSoftBlock, 0);
    scrapeCooldown.check();

    const timeoutPages = [];
    const timeoutBrowser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const page = createFakeConsumerPage(context, { loginSuccess: false });
        timeoutPages.push(page);
        return page;
      },
    });
    const timeoutCooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    timeoutCooldown.recordSoftBlock({ reason: 'empty_shell' });
    await assert.rejects(
      performConsumerHeadedLogin({
        timeoutMs: 1000,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
        runtime: { ports: { browser: timeoutBrowser }, scrapeCooldown: timeoutCooldown },
      }),
      { code: 'E_AUTH_TIMEOUT' },
    );
    assert.equal(timeoutPages[0].isClosed, true);
    assert.equal(timeoutCooldown.status().consecutiveSoftBlock, 1);
  });

  it('performConsumerQrLogin uses runtime.ports.browser, deriveConsumerContext, and optional explicit scrapeCooldown override', async () => {
    const qrDir = makeTempDir();
    const pages = [];
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const page = createFakeConsumerPage(context, { loginSuccess: true, includeQr: true });
        pages.push(page);
        return page;
      },
    });
    const runtimeCooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    runtimeCooldown.recordSoftBlock({ reason: 'empty_shell' });
    const explicitCooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    explicitCooldown.recordSoftBlock({ reason: 'empty_shell' });
    const captured = [];
    const res = await performConsumerQrLogin({
      timeoutMs: 5000,
      headed: false,
      consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      scrapeCooldown: explicitCooldown,
      qrDir,
      onQrCaptured: async (payload) => captured.push(payload),
      runtime: { ports: { browser }, scrapeCooldown: runtimeCooldown },
    });

    assert.equal(browser.launches.length, 1);
    assert.equal(browser.launches[0].headed, false);
    assert.equal(browser.derivedContexts.length, 1);
    assert.equal(captured.length, 1);
    assert.equal(existsSync(res.qrImagePath), true);
    assert.deepEqual(res.identity, { uid: '880011', nickname: 'Consumer Buyer' });
    assert.equal(res.mode, 'consumer-qr');
    assert.equal(pages.every((page) => page.isClosed), true);
    assert.equal(explicitCooldown.status().consecutiveSoftBlock, 0);
    assert.equal(runtimeCooldown.status().consecutiveSoftBlock, 1);
  });

  it('falls back to legacy launchBrowser only when runtime.ports.browser is absent', async () => {
    await assert.rejects(
      performConsumerHeadedLogin({
        timeoutMs: 1000,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      }),
      /Real browsers are disabled in offline tests/,
    );
    await assert.rejects(
      performConsumerQrLogin({
        timeoutMs: 1000,
        consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
      }),
      /Real browsers are disabled in offline tests/,
    );
  });
});

function createMemoryStreamPair() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
  stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));
  return {
    streams: { stdout, stderr },
    readStdout: () => stdoutChunks.join(''),
    readStderr: () => stderrChunks.join(''),
  };
}

describe('lowered auth domain services (loginMerchant, loginConsumer, createQrTerminalPresenter)', () => {
  it('createQrTerminalPresenter writes ASCII QR, fallback, and JSON notice strictly to injected stderr', async () => {
    const merchantPair = createMemoryStreamPair();
    const merchantPresent = createQrTerminalPresenter({
      streams: merchantPair.streams,
      json: false,
      timeoutMs: 180_000,
      kind: 'merchant',
      renderQr: async (content, { stream }) => {
        stream.write(`[QR:${content}]\n`);
      },
    });
    await merchantPresent({ imagePath: '/tmp/qr-merchant.png', qrContent: 'https://pdd.test/qr' });
    await merchantPresent({ imagePath: '/tmp/qr-missing.png', qrContent: null });

    assert.equal(merchantPair.readStdout(), '');
    assert.match(merchantPair.readStderr(), /\[QR:https:\/\/pdd\.test\/qr\]/);
    assert.match(merchantPair.readStderr(), /QR 解码失败/);
    assert.match(merchantPair.readStderr(), /\/tmp\/qr-merchant\.png/);
    assert.match(merchantPair.readStderr(), /超时 180s/);

    const jsonPair = createMemoryStreamPair();
    const consumerJsonPresent = createQrTerminalPresenter({
      stderr: jsonPair.streams.stderr,
      json: true,
      timeoutMs: 180_000,
      kind: 'consumer',
    });
    await consumerJsonPresent({ imagePath: '/tmp/qr-consumer.png', qrContent: 'ignored-in-json' });
    assert.equal(jsonPair.readStdout(), '');
    assert.equal(jsonPair.readStderr(), '等待本次消费端扫码授权：/tmp/qr-consumer.png\n');
  });

  it('loginMerchant orchestrates interactiveLogin, routes QR output to stderr, and projects v2 view', async () => {
    const { streams, readStdout, readStderr } = createMemoryStreamPair();
    const seal = createCandidateSeal();
    const calls = [];
    const view = await loginMerchant(
      { qr: true, json: false, timeoutMs: 30_000 },
      {
        streams,
        seal,
        clock: { now: () => 1_700_000_000_000 },
        interactiveLogin: {
          loginMerchant: async (loginOptions) => {
            calls.push(loginOptions);
            await loginOptions.onQrCaptured({ imagePath: '/tmp/merchant.png', qrContent: null });
            const identity = { mallId: '900111', displayName: 'Lowered Shop' };
            return {
              identity,
              mode: 'qr',
              url: 'https://mms.pinduoduo.com',
              qrContentPresent: false,
              candidate: seal.seal({
                state: { cookies: [{ name: 'PASS_ID', value: 'p1' }], origins: [] },
                identity,
                checked_at: '2026-11-25T00:00:00.000Z',
                scope: 'shop_read',
              }),
            };
          },
        },
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].qr, true);
    assert.equal(readStdout(), '');
    assert.match(readStderr(), /\/tmp\/merchant\.png/);
    assert.equal(view.mall_id, '900111');
    assert.equal(view.display_name, 'Lowered Shop');
    assert.equal(view.mode, '扫码登录');
    assert.equal(view.qr_decoded, false);
    assert.equal(view.account_slug, 'lowered-shop');
  });

  it('loginConsumer validates --password, enforces uid match, and resets injected scrapeCooldown on success only', async () => {
    await assert.rejects(
      loginConsumer({ password: 'secret' }),
      { code: 'E_USAGE', exitCode: 2 },
    );

    const cooldown = createScrapeCooldown({ threshold: 1, cooldownMs: 60_000, statePath: null });
    cooldown.recordSoftBlock({ reason: 'empty_shell' });
    assert.throws(() => cooldown.check(), { code: 'E_RATE_LIMIT' });

    const existingConsumer = insertAccount({ kind: 'consumer', identity: 'uid-expected', displayName: 'Alice' });
    await assert.rejects(
      loginConsumer(
        { consumerAccount: existingConsumer.slug, headed: true },
        {
          scrapeCooldown: cooldown,
          interactiveLogin: {
            loginConsumer: async () => ({
              state: { cookies: [{ name: 'PDDAccessToken', value: 'tok' }], origins: [] },
              identity: { uid: 'uid-different', nickname: 'Bob' },
              url: 'https://mobile.yangkeduo.com/home',
              mode: 'consumer-headed',
            }),
          },
        },
      ),
      { code: 'E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH', exitCode: 3 },
    );
    assert.equal(cooldown.status().consecutiveSoftBlock, 1);

    const { streams, readStdout, readStderr } = createMemoryStreamPair();
    const view = await loginConsumer(
      { consumerAccount: existingConsumer.slug, qr: true, json: true },
      {
        streams,
        scrapeCooldown: cooldown,
        interactiveLogin: {
          loginConsumer: async (loginOptions) => {
            await loginOptions.onQrCaptured({ imagePath: '/tmp/consumer.png', qrContent: null });
            return {
              state: { cookies: [{ name: 'PDDAccessToken', value: 'tok' }], origins: [] },
              identity: { uid: 'uid-expected', nickname: 'Alice Renamed' },
              url: 'https://mobile.yangkeduo.com/home',
              mode: 'consumer-qr',
              qrImagePath: '/tmp/consumer.png',
            };
          },
        },
      },
    );

    assert.equal(readStdout(), '');
    assert.equal(readStderr(), '等待本次消费端扫码授权：/tmp/consumer.png\n');
    assert.equal(cooldown.status().consecutiveSoftBlock, 0);
    cooldown.check();
    assert.equal(view.mode, '扫码登录');
    assert.equal(view.qr_image_path, '/tmp/consumer.png');
    assert.ok(view.account_fingerprint);
  });
});
