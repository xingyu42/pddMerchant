import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it, vi } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { run as runLogin } from '../../src/commands/login.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';

const tempDirs = [];

function makeTempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-login-cooldown-'));
  tempDirs.push(dir);
  return join(dir, 'scrape-cooldown.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('login --consumer runtime scrapeCooldown wiring', () => {
  it('clears the runtime-injected persistent scrapeCooldown upon successful consumer login', async () => {
    const statePath = makeTempStatePath();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        let currentUrl = 'https://mobile.yangkeduo.com/login.html';
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => currentUrl,
          waitForTimeout: async () => {},
          evaluate: async () => 0,
          goto: async (url) => { currentUrl = url; },
          waitForURL: async () => {
            currentUrl = 'https://mobile.yangkeduo.com/home';
            await Promise.all(
              emitter.listeners('response').map((listener) => listener({
                url: () => 'https://mobile.yangkeduo.com/proxy/api/api/apollo/v3/user/me',
                status: () => 200,
                json: async () => ({ uid: '991122', nickname: 'Replacement Buyer' }),
              })),
            );
          },
          close: async () => {},
        };
      },
    });

    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout, stderr },
      overrides: {
        browser,
        scrapeCooldownStatePath: statePath,
        runtimeConfig: {
          consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
          scrapeSoftBlockThreshold: 1,
          scrapeSoftBlockCooldownMs: 60_000,
        },
      },
    });

    try {
      runtime.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      assert.throws(() => runtime.scrapeCooldown.check(), { code: 'E_RATE_LIMIT' });

      const envelope = await runLogin({ consumer: true, headed: true, json: true }, { runtime });
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, 'login.consumer');
      assert.equal(runtime.scrapeCooldown.status().consecutiveSoftBlock, 0);
      runtime.scrapeCooldown.check();
    } finally {
      await runtime.closeAll();
    }
  });

  it('preserves in-process --consumer --password E_USAGE seam with command login.consumer', async () => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
    stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));
    let nowMs = 1_700_000_000_000;
    const clock = { now: () => nowMs, sleep: async (ms) => { nowMs += ms; } };

    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout, stderr },
      clock,
    });

    try {
      const envelope = await runLogin({ consumer: true, password: 'secret', json: true }, { runtime });
      assertEnvelopeShape(envelope, {
        ok: false,
        command: 'login.consumer',
        exitCode: ExitCodes.USAGE,
        hasData: false,
        hasError: true,
      });
      assert.equal(envelope.error.code, 'E_USAGE');
      assert.ok(envelope.meta.correlation_id);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      const stdoutLines = stdoutChunks.join('').trim().split(/\r?\n/);
      assert.equal(stdoutLines.length, 1);
      assert.deepEqual(JSON.parse(stdoutLines[0]), envelope);
    } finally {
      await runtime.closeAll();
    }
  });

  it('rejects consumer uid mismatch with E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH and preserves cooldown', async () => {
    const existing = insertAccount({ kind: 'consumer', identity: 'uid-expected', displayName: 'Expected Buyer' });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const statePath = makeTempStatePath();
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        let currentUrl = 'https://mobile.yangkeduo.com/login.html';
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => currentUrl,
          waitForTimeout: async () => {},
          evaluate: async () => 0,
          goto: async (url) => { currentUrl = url; },
          waitForURL: async () => {
            currentUrl = 'https://mobile.yangkeduo.com/home';
            await Promise.all(
              emitter.listeners('response').map((listener) => listener({
                url: () => 'https://mobile.yangkeduo.com/proxy/api/api/apollo/v3/user/me',
                status: () => 200,
                json: async () => ({ uid: 'uid-wrong', nickname: 'Wrong Buyer' }),
              })),
            );
          },
          close: async () => {},
        };
      },
    });

    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout, stderr },
      overrides: {
        browser,
        scrapeCooldownStatePath: statePath,
        runtimeConfig: {
          consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
          scrapeSoftBlockThreshold: 1,
          scrapeSoftBlockCooldownMs: 60_000,
        },
      },
    });

    try {
      runtime.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      const envelope = await runLogin({
        consumer: true,
        consumerAccount: existing.slug,
        headed: true,
        json: true,
      }, { runtime });

      assertEnvelopeShape(envelope, {
        ok: false,
        command: 'login.consumer',
        exitCode: ExitCodes.AUTH,
        hasData: false,
        hasError: true,
      });
      assert.equal(envelope.error.code, 'E_CONSUMER_ACCOUNT_IDENTITY_MISMATCH');
      assert.equal(runtime.scrapeCooldown.status().consecutiveSoftBlock, 1);
    } finally {
      await runtime.closeAll();
    }
  });

  it('writes QR ASCII art strictly to injected stderr, keeps --json stdout 1-line pure, and cleans up browser on timeout', async () => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
    stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));

    let evalCount = 0;
    const closedPages = [];
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        let currentUrl = 'https://mobile.yangkeduo.com/login.html';
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
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => currentUrl,
          waitForTimeout: async () => {},
          evaluate: async () => 0,
          $: async (selector) => (selector === '[class*="qr-code"] canvas' ? qrElement : null),
          goto: async (url) => { currentUrl = url; },
          waitForURL: async () => {
            currentUrl = 'https://mobile.yangkeduo.com/home';
            await Promise.all(
              emitter.listeners('response').map((listener) => listener({
                url: () => 'https://mobile.yangkeduo.com/proxy/api/api/apollo/v3/user/me',
                status: () => 200,
                json: async () => ({ uid: '777888', nickname: 'QR Buyer' }),
              })),
            );
          },
          close: async () => { closedPages.push(true); },
        };
      },
    });

    const qrDir = mkdtempSync(join(tmpdir(), 'pdd-login-qr-'));
    tempDirs.push(qrDir);
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout, stderr },
      overrides: {
        browser,
        runtimeConfig: {
          consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
          scrapeSoftBlockThreshold: 2,
          scrapeSoftBlockCooldownMs: 60_000,
        },
      },
    });

    try {
      const envelope = await runLogin({ consumer: true, qr: true, qrDir, json: true }, { runtime });
      assertEnvelopeShape(envelope, {
        ok: true,
        command: 'login.consumer',
        exitCode: ExitCodes.OK,
        hasData: true,
        hasError: false,
      });
      assert.equal(closedPages.length >= 1, true);
      const stdoutLines = stdoutChunks.join('').trim().split(/\r?\n/);
      assert.equal(stdoutLines.length, 1);
      assert.equal(JSON.parse(stdoutLines[0]).command, 'login.consumer');
      assert.match(stderrChunks.join(''), /等待本次消费端扫码授权：/);
    } finally {
      await runtime.closeAll();
    }

    // Timeout cleanup test with fake timers
    vi.useFakeTimers();
    const timeoutStdout = new PassThrough();
    const timeoutStderr = new PassThrough();
    const timeoutClosed = [];
    const hangingBrowser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => 'https://mobile.yangkeduo.com/login.html',
          waitForTimeout: async () => {},
          evaluate: async () => 0,
          goto: async () => {},
          waitForURL: () => new Promise(() => {}),
          close: async () => { timeoutClosed.push(true); },
        };
      },
    });
    const timeoutRuntime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout: timeoutStdout, stderr: timeoutStderr },
      overrides: {
        browser: hangingBrowser,
        runtimeConfig: {
          consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
          scrapeSoftBlockThreshold: 2,
          scrapeSoftBlockCooldownMs: 60_000,
        },
      },
    });

    try {
      const pending = runLogin({ consumer: true, headed: true, timeoutMs: 40, json: true }, { runtime: timeoutRuntime });
      await vi.advanceTimersByTimeAsync(60);
      const timeoutEnv = await pending;
      assertEnvelopeShape(timeoutEnv, {
        ok: false,
        command: 'login.consumer',
        exitCode: ExitCodes.NETWORK,
        hasData: false,
        hasError: true,
      });
      assert.equal(timeoutEnv.error.code, 'E_TIMEOUT');
      assert.equal(timeoutRuntime.outputSink.hasEmitted(), true);
      assert.equal(timeoutClosed.length >= 1, true);
      assert.equal(TIMEOUTS.LOGIN_QR, 180_000);
    } finally {
      vi.useRealTimers();
      await timeoutRuntime.closeAll();
    }
  });
});
