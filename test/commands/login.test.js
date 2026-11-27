import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, vi } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createOutputSink } from '../../src/infra/output-sink.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { run as runLogin } from '../../src/commands/login.js';
import { loginConsumerInteractive, loginMerchantInteractive } from '../../src/adapter/interactive-login.js';
import { createInMemoryAuthPort, createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';

function makeMemoryStreams() {
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

describe('login command lifecycle lowering', () => {
  it('declares local lifecycle with required runtimeConfigPolicy on login', () => {
    assert.equal(runLogin.lifecycle, 'local');
    assert.equal(runLogin.runtimeConfigPolicy, 'required');
  });

  it('honors --no-color (color: false and noColor: true), clock latency_ms, correlation_id, and single-emit on login', async () => {
    const { streams, readStdout, readStderr } = makeMemoryStreams();
    const realSink = createOutputSink({ streams });
    const emitCalls = [];
    const outputSink = {
      streams: realSink.streams,
      hasEmitted: () => realSink.hasEmitted(),
      writeDebugRaw: (payload) => realSink.writeDebugRaw(payload),
      emit: (envelope, options) => {
        emitCalls.push({ envelope, options });
        return realSink.emit(envelope, options);
      },
    };
    let nowMs = 1_700_000_000_000;
    const clock = { now: () => nowMs, sleep: async (ms) => { nowMs += ms; } };
    const seal = createCandidateSeal();

    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      clock,
      overrides: {
        seal,
        outputSink,
        interactiveLogin: {
          loginMerchant: async ({ onQrCaptured }) => {
            nowMs += 37;
            await onQrCaptured({ imagePath: '/tmp/init-qr.png', qrContent: null });
            const identity = { mallId: '900321', displayName: 'Colorless Shop' };
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
    });

    try {
      const envelope = await runLogin({ qr: true, color: false, json: false }, { runtime });
      assertEnvelopeShape(envelope, {
        ok: true,
        command: 'login',
        exitCode: ExitCodes.OK,
        hasData: true,
        hasError: false,
      });
      assert.equal(envelope.meta.latency_ms, 37);
      assert.ok(envelope.meta.correlation_id);
      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].options.noColor, true);
      assert.equal(realSink.hasEmitted(), true);
      assert.equal(readStdout().startsWith('OK  login\n'), true);
      assert.match(readStderr(), /\/tmp\/init-qr\.png/);
      assert.match(readStderr(), /QR 解码失败/);
    } finally {
      await runtime.closeAll();
    }
  });

  it('rejects --all-accounts with E_USAGE on login and login.consumer', async () => {
    for (const [handler, opts, expectedCommand] of [
      [runLogin, { allAccounts: true, json: true }, 'login'],
      [runLogin, { consumer: true, allAccounts: true, json: true }, 'login.consumer'],
    ]) {
      const { streams, readStdout } = makeMemoryStreams();
      const runtime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: 'maintenance',
        env: {},
        streams,
      });
      try {
        const envelope = await handler(opts, { runtime });
        assertEnvelopeShape(envelope, {
          ok: false,
          command: expectedCommand,
          exitCode: ExitCodes.USAGE,
          hasData: false,
          hasError: true,
        });
        assert.equal(envelope.error.code, 'E_USAGE');
        assert.equal(runtime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      } finally {
        await runtime.closeAll();
      }
    }
  });

  it('aborts cleanly on cooperative timeout and parent AbortSignal, closing browser resources', async () => {
    vi.useFakeTimers();
    const closedFlags = [];
    const hangingBrowser = createInMemoryBrowserRuntime({
      createPage: (context) => ({
        context: () => context,
        url: () => 'https://mms.pinduoduo.com/login',
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => 0,
        close: async () => { closedFlags.push('page'); },
      }),
    });
    const originalOpen = hangingBrowser.openSession;
    const trackedBrowser = {
      ...hangingBrowser,
      async openSession(options) {
        const session = await originalOpen(options);
        const origClose = session.close;
        return {
          ...session,
          async close() {
            closedFlags.push('session');
            return origClose();
          },
        };
      },
    };

    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: { browser: trackedBrowser },
    });

    try {
      const pending = runLogin({ headed: true, timeoutMs: 45, json: true }, { runtime });
      await vi.advanceTimersByTimeAsync(70);
      const envelope = await pending;
      assertEnvelopeShape(envelope, {
        ok: false,
        command: 'login',
        exitCode: ExitCodes.NETWORK,
        hasData: false,
        hasError: true,
      });
      assert.equal(envelope.error.code, 'E_AUTH_TIMEOUT');
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.equal(closedFlags.includes('session'), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      vi.useRealTimers();
      await runtime.closeAll();
    }
  });
});

describe('interactive-login adapter direct boundaries', () => {
  it('loginMerchantInteractive and loginConsumerInteractive close sessions on abort', async () => {
    const controller = new AbortController();
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => 'https://mms.pinduoduo.com',
          goto: async () => { controller.abort(); },
          waitForURL: () => new Promise(() => {}),
          close: async () => {},
        };
      },
    });
    const authPort = createInMemoryAuthPort();

    await assert.rejects(
      loginMerchantInteractive({
        transaction: {},
        headed: true,
        timeoutMs: 5000,
        signal: controller.signal,
        browserPort: browser,
        authPort,
      }),
      { code: 'E_AUTH_CANCELLED' },
    );

    const consumerController = new AbortController();
    const consumerBrowser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => 'https://mobile.yangkeduo.com/login.html',
          goto: async () => { consumerController.abort(); },
          waitForURL: () => new Promise(() => {}),
          close: async () => {},
        };
      },
    });

    await assert.rejects(
      loginConsumerInteractive({
        headed: true,
        timeoutMs: 5000,
        signal: consumerController.signal,
        browserPort: consumerBrowser,
      }),
      { code: 'E_TIMEOUT' },
    );
  });
});
