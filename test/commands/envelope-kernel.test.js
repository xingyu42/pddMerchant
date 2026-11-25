import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, vi } from 'vitest';
import { withCommand } from '../../src/commands/_runner.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { createOutputSink } from '../../src/infra/output-sink.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { abortableSleep } from '../../src/infra/abort.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import * as configCmd from '../../src/commands/config.js';
import { link as consoleLink } from '../../src/commands/console.js';
import { status as daemonStatus } from '../../src/commands/daemon.js';
import { run as goodsCostList } from '../../src/commands/goods/cost/list.js';
import { run as ordersList } from '../../src/commands/orders/list.js';
import { runCli, createCliSandbox, spawnNode } from '../helpers/isolated-cli.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';

const exampleConfig = fileURLToPath(new URL('../../config/config.example.json', import.meta.url));
const tempDirs = [];

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

function makeTempConfigDir({ corrupt = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pdd-kernel-cfg-'));
  tempDirs.push(root);
  const configDir = join(root, 'config');
  mkdirSync(configDir, { recursive: true });
  const baselinePath = join(configDir, 'config.example.json');
  const configPath = join(configDir, 'config.json');
  copyFileSync(exampleConfig, baselinePath);
  if (corrupt) writeFileSync(configPath, '{broken json');
  return {
    projectRoot: root,
    configDir,
    baselinePath,
    configPath,
    env: {},
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('envelope-kernel: dynamic command names, timing, noColor, timeout, single-emit', () => {
  it('evaluates functional command names safely on success and error paths and emits once via OutputSink stub', async () => {
    const { streams, readStdout } = makeMemoryStreams();
    const realSink = createOutputSink({ streams });
    const emitCalls = [];
    const outputSinkStub = {
      streams: realSink.streams,
      hasEmitted: () => realSink.hasEmitted(),
      writeDebugRaw: (payload) => realSink.writeDebugRaw(payload),
      emit: (envelope, options) => {
        emitCalls.push({ envelope, options });
        return realSink.emit(envelope, options);
      },
    };

    let nowMs = 1_700_000_000_000;
    const clock = {
      now: () => nowMs,
      sleep: async (ms) => { nowMs += ms; },
    };

    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      clock,
      overrides: { outputSink: outputSinkStub },
    });

    try {
      const cmd = withCommand({
        command: (opts) => (opts.consumer ? 'login.consumer' : 'login'),
        lifecycle: 'local',
        async run(ctx) {
          nowMs += 42;
          if (ctx.config.fail) {
            throw new PddCliError({
              code: 'E_USAGE',
              message: 'rejected by handler',
              exitCode: ExitCodes.USAGE,
            });
          }
          return { headline: ['ok'], mode: ctx.config.consumer ? 'consumer' : 'merchant' };
        },
      });

      assert.equal(cmd.runtimeConfigPolicy, 'required');
      assert.equal(cmd.lifecycle, 'local');

      const okEnv = await cmd({ consumer: true, json: true, color: false }, { runtime });
      assertEnvelopeShape(okEnv, { ok: true, command: 'login.consumer', exitCode: 0, hasData: true, hasError: false });
      assert.equal(typeof okEnv.meta.correlation_id, 'string');
      assert.ok(okEnv.meta.correlation_id.length > 0);
      assert.equal(okEnv.meta.latency_ms, 42);
      assert.equal(realSink.hasEmitted(), true);
      assert.equal(emitCalls.length, 1);
      assert.equal(emitCalls[0].options.noColor, true);
      assert.equal(emitCalls[0].options.json, true);
      assert.deepEqual(JSON.parse(readStdout().trim()), okEnv);

      // Error path with separate runtime to verify error envelope + dynamic name + safe fallback
      const errStreams = makeMemoryStreams();
      const errRuntime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: 'maintenance',
        env: {},
        streams: errStreams.streams,
        clock,
      });
      try {
        const errEnv = await cmd({ consumer: true, fail: true, json: true, noColor: true }, { runtime: errRuntime });
        assertEnvelopeShape(errEnv, { ok: false, command: 'login.consumer', exitCode: 2, hasData: false, hasError: true });
        assert.equal(typeof errEnv.meta.correlation_id, 'string');
        assert.equal(errEnv.meta.latency_ms, 42);
        assert.equal(errRuntime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(errStreams.readStdout().trim()), errEnv);
      } finally {
        await errRuntime.closeAll();
      }
    } finally {
      await runtime.closeAll();
    }
  });

  it('falls back safely when functional command name throws', async () => {
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
    });
    try {
      const cmd = withCommand({
        command: () => { throw new Error('command selector exploded'); },
        lifecycle: 'maintenance',
        run: () => ({ headline: ['safe'] }),
      });
      const env = await cmd({ json: true }, { runtime });
      assertEnvelopeShape(env, { ok: true, command: 'pdd', exitCode: 0, hasData: true });
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), env);
    } finally {
      await runtime.closeAll();
    }
  });

  it('applies cooperative defaultTimeoutMs and aborts cleanly via signal', async () => {
    vi.useFakeTimers();
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
    });

    try {
      const cmd = withCommand({
        name: 'test.timeout',
        lifecycle: 'local',
        defaultTimeoutMs: 50,
        async run(ctx) {
          assert.ok(ctx.signal);
          assert.equal(typeof ctx.deadlineAt, 'number');
          await abortableSleep(5000, ctx.signal);
          return { headline: ['unreachable'] };
        },
      });

      const pending = cmd({ json: true }, { runtime });
      await vi.advanceTimersByTimeAsync(60);
      const envelope = await pending;
      assertEnvelopeShape(envelope, { ok: false, command: 'test.timeout', exitCode: ExitCodes.NETWORK, hasData: false, hasError: true });
      assert.equal(envelope.error.code, 'E_TIMEOUT');
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      vi.useRealTimers();
      await runtime.closeAll();
    }
  });

  it('allows explicit timeoutMs to override defaultTimeoutMs and handles parent abort signal', async () => {
    const { streams } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
    });
    try {
      const controller = new AbortController();
      const cmd = withCommand({
        name: 'test.parentAbort',
        lifecycle: 'local',
        defaultTimeoutMs: () => 5000,
        async run(ctx) {
          assert.ok(ctx.deadlineAt <= Date.now() + 200);
          controller.abort();
          await abortableSleep(5000, ctx.signal);
          return { headline: ['never'] };
        },
      });
      const envelope = await cmd({ json: true, timeoutMs: 150, signal: controller.signal }, { runtime });
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'E_TIMEOUT');
      assert.equal(runtime.outputSink.hasEmitted(), true);
    } finally {
      await runtime.closeAll();
    }
  });

  it('aborts --all-accounts batch promptly on already-aborted and in-flight parentSignal without setting exitCode 130', async () => {
    const passState = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
    const accountA = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    const accountB = insertAccount({ identity: '900002', displayName: 'Shop B' });
    saveAuthStateSnapshot(passState, accountA.id);
    saveAuthStateSnapshot(passState, accountB.id);

    const visitedPre = [];
    const preAborted = new AbortController();
    preAborted.abort(new Error('pre-aborted'));
    const preStreams = makeMemoryStreams();
    const preRuntime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: preStreams.streams,
    });
    const exitCodeBefore = process.exitCode;
    try {
      const cmd = withCommand({
        name: 'test.batchParentAbortPre',
        needsAuth: true,
        needsMall: 'none',
        async run(ctx) {
          visitedPre.push(ctx.accountSlug);
          return { headline: ['ok'] };
        },
      });
      const env = await cmd({ allAccounts: true, json: true }, { runtime: preRuntime, parentSignal: preAborted.signal });
      assertEnvelopeShape(env, { ok: false, command: 'test.batchParentAbortPre', exitCode: ExitCodes.NETWORK, hasData: false, hasError: true });
      assert.equal(env.error.code, 'E_TIMEOUT');
      assert.deepEqual(visitedPre, []);
      assert.equal(preRuntime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(preStreams.readStdout().trim()), env);
      assert.equal(process.exitCode, exitCodeBefore);
    } finally {
      await preRuntime.closeAll();
    }

    const visitedMid = [];
    const midController = new AbortController();
    const midStreams = makeMemoryStreams();
    const midRuntime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: midStreams.streams,
    });
    try {
      const cmd = withCommand({
        name: 'test.batchParentAbortMid',
        needsAuth: true,
        needsMall: 'none',
        async run(ctx) {
          visitedMid.push(ctx.accountSlug);
          midController.abort(new Error('mid-aborted'));
          await abortableSleep(5000, ctx.signal);
          return { headline: ['unreachable'] };
        },
      });
      const env = await cmd({ allAccounts: true, json: true }, { runtime: midRuntime, parentSignal: midController.signal });
      assertEnvelopeShape(env, { ok: false, command: 'test.batchParentAbortMid', exitCode: ExitCodes.NETWORK, hasData: false, hasError: true });
      assert.equal(env.error.code, 'E_TIMEOUT');
      assert.deepEqual(visitedMid, ['shop-a']);
      assert.equal(midRuntime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(midStreams.readStdout().trim()), env);
      assert.equal(process.exitCode, exitCodeBefore);
    } finally {
      await midRuntime.closeAll();
    }
  });

  it('aborts --all-accounts batch promptly when --timeout fires during inter-account jitter', async () => {
    vi.useFakeTimers();
    const passState = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };
    const accountA = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    const accountB = insertAccount({ identity: '900002', displayName: 'Shop B' });
    saveAuthStateSnapshot(passState, accountA.id);
    saveAuthStateSnapshot(passState, accountB.id);

    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'fixture',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
    });
    const exitCodeBefore = process.exitCode;
    const visited = [];
    try {
      const cmd = withCommand({
        name: 'test.batchTimeout',
        needsAuth: true,
        needsMall: 'none',
        async run(ctx) {
          visited.push(ctx.accountSlug);
          return { headline: ['ok'] };
        },
      });
      const pending = cmd({ allAccounts: true, timeoutMs: 50, json: true }, { runtime });
      await vi.advanceTimersByTimeAsync(60);
      const env = await pending;
      assertEnvelopeShape(env, { ok: false, command: 'test.batchTimeout', exitCode: ExitCodes.NETWORK, hasData: false, hasError: true });
      assert.equal(env.error.code, 'E_TIMEOUT');
      assert.deepEqual(visited, ['shop-a']);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), env);
      assert.equal(process.exitCode, exitCodeBefore);
    } finally {
      vi.useRealTimers();
      await runtime.closeAll();
    }
  });
});

describe('lifecycle presets: backward compatibility, load-time validation, and --all-accounts rejection', () => {
  it('exposes runtimeConfigPolicy on command handlers and preserves backward compat', () => {
    assert.equal(configCmd.show.runtimeConfigPolicy, 'maintenance');
    assert.equal(configCmd.set.runtimeConfigPolicy, 'maintenance');
    assert.equal(configCmd.unset.runtimeConfigPolicy, 'maintenance');
    assert.equal(configCmd.validate.runtimeConfigPolicy, 'maintenance');

    assert.equal(consoleLink.runtimeConfigPolicy, 'required');
    assert.equal(consoleLink.lifecycle, 'local');
    assert.equal(daemonStatus.runtimeConfigPolicy, 'required');
    assert.equal(daemonStatus.lifecycle, 'local');
    assert.equal(goodsCostList.runtimeConfigPolicy, 'required');
    assert.equal(goodsCostList.lifecycle, 'local');

    assert.equal(ordersList.runtimeConfigPolicy, 'required');
    assert.equal(ordersList.lifecycle, 'merchant');
  });

  it.each([
    ['missing run', { name: 'x' }],
    ['missing name/command', { run: () => {} }],
    ['both name and command', { name: 'x', command: 'y', run: () => {} }],
    ['invalid lifecycle', { name: 'x', lifecycle: 'bogus', run: () => {} }],
    ['needsBrowser:false + needsAuth:true', { name: 'x', needsBrowser: false, needsAuth: true, run: () => {} }],
    ['merchant + needsBrowser:false', { name: 'x', lifecycle: 'merchant', needsBrowser: false, run: () => {} }],
    ['merchant + needsMall:stored', { name: 'x', lifecycle: 'merchant', needsMall: 'stored', needsAccount: true, run: () => {} }],
    ['merchant + needsAuth:true + needsAccount:none', { name: 'x', lifecycle: 'merchant', needsAuth: true, needsAccount: 'none', run: () => {} }],
    ['local + needsBrowser:true', { name: 'x', lifecycle: 'local', needsBrowser: true, run: () => {} }],
    ['local + needsAuth:true', { name: 'x', lifecycle: 'local', needsAuth: true, run: () => {} }],
    ['local + needsMall:switch', { name: 'x', lifecycle: 'local', needsMall: 'switch', run: () => {} }],
    ['local + needsMall:stored without required account', { name: 'x', lifecycle: 'local', needsMall: 'stored', run: () => {} }],
    ['local + needsMall:stored with optional account', { name: 'x', lifecycle: 'local', needsMall: 'stored', needsAccount: 'optional', run: () => {} }],
    ['local + allowAllAccounts:true', { name: 'x', lifecycle: 'local', allowAllAccounts: true, run: () => {} }],
    ['maintenance + needsAuth:true', { name: 'x', lifecycle: 'maintenance', needsAuth: true, run: () => {} }],
    ['maintenance + needsBrowser:true', { name: 'x', lifecycle: 'maintenance', needsBrowser: true, run: () => {} }],
    ['maintenance + needsAccount:optional', { name: 'x', lifecycle: 'maintenance', needsAccount: 'optional', run: () => {} }],
    ['maintenance + needsAccount:true', { name: 'x', lifecycle: 'maintenance', needsAccount: true, run: () => {} }],
    ['maintenance + needsMall:stored', { name: 'x', lifecycle: 'maintenance', needsMall: 'stored', run: () => {} }],
    ['maintenance + allowAllAccounts:true', { name: 'x', lifecycle: 'maintenance', allowAllAccounts: true, run: () => {} }],
    ['invalid defaultTimeoutMs', { name: 'x', defaultTimeoutMs: 0, run: () => {} }],
    ['invalid needsAccount', { name: 'x', needsAccount: 'bad', run: () => {} }],
  ])('rejects invalid preset combination at load time: %s', (_label, spec) => {
    assert.throws(() => withCommand(spec), { code: 'E_CONFIG_INVALID' });
  });

  it('rejects --all-accounts with E_USAGE in local and maintenance commands and emits once', async () => {
    for (const [handler, expectedCommand] of [
      [consoleLink, 'console.link'],
      [daemonStatus, 'daemon.status'],
      [goodsCostList, 'goods.cost.list'],
      [configCmd.show, 'config.show'],
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
        assertEnvelopeShape(envelope, { ok: false, command: expectedCommand, exitCode: 2, hasData: false, hasError: true });
        assert.equal(envelope.error.code, 'E_USAGE');
        assert.equal(runtime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      } finally {
        await runtime.closeAll();
      }
    }
  });
});

describe('config.* maintenance mode under corrupted JSON configuration', () => {
  it('remains reachable under corrupted local JSON and emits valid v2 error envelopes with correlation_id and noColor', async () => {
    const configOptions = makeTempConfigDir({ corrupt: true });
    const damagedBefore = readFileSync(configOptions.configPath, 'utf8');

    // Ordinary 'required' policy fails at composition root
    await assert.rejects(
      composeCommandRuntime({ mode: 'fixture', configOptions, runtimeConfigPolicy: 'required', env: {} }),
      { code: 'E_CONFIG_INVALID' },
    );

    for (const [handler, commandName, args] of [
      [configCmd.show, 'config.show', []],
      [configCmd.validate, 'config.validate', []],
      [configCmd.set, 'config.set', ['logLevel', 'debug']],
      [configCmd.unset, 'config.unset', ['logLevel']],
    ]) {
      const { streams, readStdout } = makeMemoryStreams();
      const runtime = await composeCommandRuntime({
        mode: 'fixture',
        runtimeConfigPolicy: configCmd.show.runtimeConfigPolicy,
        configOptions,
        env: {},
        streams,
      });
      try {
        const envelope = await handler({ args, json: true, noColor: true }, { runtime });
        assertEnvelopeShape(envelope, { ok: false, command: commandName, exitCode: 1, hasData: false, hasError: true });
        assert.equal(envelope.error.code, 'E_CONFIG_INVALID');
        assert.equal(typeof envelope.meta.correlation_id, 'string');
        assert.ok(envelope.meta.correlation_id.length > 0);
        assert.equal(typeof envelope.meta.latency_ms, 'number');
        assert.equal(runtime.outputSink.hasEmitted(), true);
        assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      } finally {
        await runtime.closeAll();
      }
    }

    assert.equal(readFileSync(configOptions.configPath, 'utf8'), damagedBefore);
  });
});

describe('CLI subprocess two-stage emit and maintenance policy', () => {
  it('emits v2 envelopes with correlation_id for config.show/validate and fallback-emits Commander errors once', () => {
    const shown = runCli(['config', 'show']);
    assert.equal(shown.status, 0);
    assert.equal(shown.envelope.command, 'config.show');
    assert.ok(shown.envelope.meta.correlation_id);

    const validated = runCli(['config', 'validate']);
    assert.equal(validated.status, 0);
    assert.equal(validated.envelope.command, 'config.validate');
    assert.ok(validated.envelope.meta.correlation_id);

    const unknownOpt = runCli(['config', 'show', '--bogus-flag']);
    assert.equal(unknownOpt.status, 2);
    assert.equal(unknownOpt.envelope.error.code, 'E_USAGE');
  });

  it('honors --no-color on non-JSON output for config.show', async () => {
    const sandbox = createCliSandbox();
    try {
      const cliPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
      const { NO_COLOR: _ignored, ...envWithoutNoColor } = sandbox.env;
      const result = await spawnNode([cliPath, 'config', 'show', '--no-color'], { env: envWithoutNoColor });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(/\u001b\[/.test(result.stdout), false, 'stdout should not contain ANSI color codes');
      assert.match(result.stdout, /config\.show/);
    } finally {
      sandbox.dispose();
    }
  });
});
