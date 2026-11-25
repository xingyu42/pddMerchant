import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it, vi } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createOutputSink } from '../../src/infra/output-sink.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { getDatabasePath, run } from '../../src/infra/db.js';
import { insertAccount, putCredential, putReloginState } from '../../src/infra/account-store.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import * as accountCmd from '../../src/commands/account.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';
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

describe('account.* commands unified via withCommand local lifecycle', () => {
  it('declares local lifecycle and required runtimeConfigPolicy on all 4 handlers', () => {
    for (const handler of [accountCmd.add, accountCmd.remove, accountCmd.list, accountCmd.setDefault]) {
      assert.equal(handler.lifecycle, 'local');
      assert.equal(handler.runtimeConfigPolicy, 'required');
    }
  });

  it('emits v2 envelopes once with correlation_id, clock latency_ms, and noColor on account.list', async () => {
    const first = insertAccount({ identity: '900001', displayName: 'Shop Alpha' }, { setDefault: true });
    putCredential(first.id, 'sealed-placeholder');
    putReloginState(first.id, { status: 'awaiting_human', reason: 'sms' });

    const { streams, readStdout } = makeMemoryStreams();
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
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      clock,
      overrides: { outputSink },
    });

    try {
      const envelope = await accountCmd.list({ color: false, json: false }, { runtime });
      assertEnvelopeShape(envelope, {
        ok: true,
        command: 'account.list',
        exitCode: ExitCodes.OK,
        hasData: true,
        hasError: false,
      });
      assertDataContractV2(envelope.data);
      assert.ok(envelope.meta.correlation_id);
      assert.equal(typeof envelope.meta.latency_ms, 'number');
      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].options.noColor, true);
      assert.equal(realSink.hasEmitted(), true);
      assert.equal(envelope.data.items[0].password_relogin_status, '等待人工：短信验证');
      const outputLines = readStdout().trimEnd().split(/\r?\n/);
      assert.equal(outputLines[0], 'OK  account.list');
      assert.equal(/\u001b\[/.test(outputLines[0]), false);
      assert.equal(/\u001b\[/.test(outputLines.at(-1)), false);
    } finally {
      await runtime.closeAll();
    }
  });

  it('runs account.add through runtime.interactiveLogin with credentials_not_saved_headed_login warning', async () => {
    const { streams, readStdout } = makeMemoryStreams();
    const seal = createCandidateSeal();
    const calls = [];
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: {
        seal,
        interactiveLogin: {
          loginMerchant: async (loginOpts) => {
            calls.push(loginOpts);
            const identity = { mallId: '900888', displayName: 'Added Shop' };
            return {
              identity,
              mode: 'headed',
              url: 'https://mms.pinduoduo.com',
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
      const envelope = await accountCmd.add({ json: true }, { runtime });
      assertEnvelopeShape(envelope, {
        ok: true,
        command: 'account.add',
        exitCode: ExitCodes.OK,
        hasData: true,
        hasError: false,
      });
      assertDataContractV2(envelope.data);
      assert.ok(envelope.meta.correlation_id);
      assert.deepEqual(envelope.meta.warnings, ['credentials_not_saved_headed_login']);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].qr, false);
      assert.equal(calls[0].headed, true);
      assert.equal(envelope.data.slug, 'added-shop');
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      await runtime.closeAll();
    }
  });

  it('aborts account.add cleanly on cooperative timeout and closes browser session', async () => {
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
      const pending = accountCmd.add({ timeoutMs: 45, json: true }, { runtime });
      await vi.advanceTimersByTimeAsync(70);
      const envelope = await pending;
      assertEnvelopeShape(envelope, {
        ok: false,
        command: 'account.add',
        exitCode: ExitCodes.NETWORK,
        hasData: false,
        hasError: true,
      });
      assert.equal(envelope.error.code, 'E_AUTH_TIMEOUT');
      assert.equal(closedFlags.includes('session'), true);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      vi.useRealTimers();
      await runtime.closeAll();
    }
  });

  it('handles account.remove dry-run, confirm under mismatched master.key, and E_USAGE / E_ACCOUNT_NOT_FOUND envelopes', async () => {
    const account = insertAccount({ identity: '900001', displayName: 'Shop Remove' }, { setDefault: true });
    saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'p1' }], origins: [] }, account.id);
    writeFileSync(join(dirname(getDatabasePath()), 'master.key'), Buffer.alloc(32, 0xbb).toString('base64'));
    run("UPDATE auth_states SET state_sealed = 'corrupt-blob' WHERE account_id = ?", account.id);

    for (const [opts, assertFn] of [
      [{ json: true }, (env) => {
        assertEnvelopeShape(env, { ok: false, command: 'account.remove', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
        assert.equal(env.error.code, 'E_USAGE');
      }],
      [{ slug: 'missing', json: true }, (env) => {
        assertEnvelopeShape(env, { ok: false, command: 'account.remove', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
        assert.equal(env.error.code, 'E_ACCOUNT_NOT_FOUND');
      }],
      [{ slug: account.slug, json: true }, (env) => {
        assertEnvelopeShape(env, { ok: true, command: 'account.remove', exitCode: ExitCodes.OK, hasData: true, hasError: false });
        assertDataContractV2(env.data);
        assert.equal(env.data.dry_run, true);
        assert.equal(env.data.removed, false);
      }],
      [{ slug: account.slug, confirm: true, json: true }, (env) => {
        assertEnvelopeShape(env, { ok: true, command: 'account.remove', exitCode: ExitCodes.OK, hasData: true, hasError: false });
        assertDataContractV2(env.data);
        assert.equal(env.data.dry_run, false);
        assert.equal(env.data.removed, true);
      }],
    ]) {
      const { streams, readStdout } = makeMemoryStreams();
      const runtime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: 'maintenance',
        env: {},
        streams,
      });
      try {
        const envelope = await accountCmd.remove(opts, { runtime });
        assertFn(envelope);
        assert.ok(envelope.meta.correlation_id);
        assert.equal(runtime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      } finally {
        await runtime.closeAll();
      }
    }
  });

  it('handles account.default positional/--slug switching and E_USAGE / E_ACCOUNT_NOT_FOUND envelopes', async () => {
    const first = insertAccount({ identity: '900001', displayName: 'Shop One' }, { setDefault: true });
    const second = insertAccount({ identity: '900002', displayName: 'Shop Two' });

    for (const [opts, assertFn] of [
      [{ json: true }, (env) => {
        assertEnvelopeShape(env, { ok: false, command: 'account.default', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
        assert.equal(env.error.code, 'E_USAGE');
      }],
      [{ args: ['missing'], json: true }, (env) => {
        assertEnvelopeShape(env, { ok: false, command: 'account.default', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
        assert.equal(env.error.code, 'E_ACCOUNT_NOT_FOUND');
      }],
      [{ args: [second.slug], json: true }, (env) => {
        assertEnvelopeShape(env, { ok: true, command: 'account.default', exitCode: ExitCodes.OK, hasData: true, hasError: false });
        assertDataContractV2(env.data);
        assert.equal(env.data.slug, second.slug);
      }],
      [{ slug: first.slug, json: true }, (env) => {
        assertEnvelopeShape(env, { ok: true, command: 'account.default', exitCode: ExitCodes.OK, hasData: true, hasError: false });
        assertDataContractV2(env.data);
        assert.equal(env.data.slug, first.slug);
      }],
    ]) {
      const { streams, readStdout } = makeMemoryStreams();
      const runtime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: 'maintenance',
        env: {},
        streams,
      });
      try {
        const envelope = await accountCmd.setDefault(opts, { runtime });
        assertFn(envelope);
        assert.ok(envelope.meta.correlation_id);
        assert.equal(runtime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      } finally {
        await runtime.closeAll();
      }
    }
  });

  it('rejects --all-accounts with E_USAGE across all account.* handlers', async () => {
    for (const [handler, expectedCommand] of [
      [accountCmd.add, 'account.add'],
      [accountCmd.remove, 'account.remove'],
      [accountCmd.list, 'account.list'],
      [accountCmd.setDefault, 'account.default'],
    ]) {
      const { streams, readStdout } = makeMemoryStreams();
      const runtime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: 'maintenance',
        env: {},
        streams,
      });
      try {
        const envelope = await handler({ allAccounts: true, json: true }, { runtime });
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
});
