import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { describe, it, vi } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { runCloseAllHooks } from '../../src/infra/runtime-cleanup.js';
import { withCommand } from '../../src/commands/_runner.js';
import { runEndpoint } from '../../src/adapter/run-endpoint.js';
import { TRAFFIC_READY_TIME } from '../../src/adapter/endpoints/traffic.js';
import { insertAccount, insertPendingAction } from '../../src/infra/account-store.js';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import {
  createInMemoryBrowserRuntime,
  createInMemoryMallPort,
  createInMemoryAuthPort,
  createInMemoryDaemonProcessPort,
} from '../helpers/in-memory-ports.js';
import { createMemoryEndpointTransport } from '../helpers/test-ctx.js';

const PASS_STATE = { cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] };

function trackBrowserCloses(inner) {
  const closeCounts = new Map();
  return {
    ...inner,
    closeCount: (session) => closeCounts.get(session) ?? 0,
    async openSession(options) {
      const real = await inner.openSession(options);
      const tracked = {
        ...real,
        async close() {
          closeCounts.set(tracked, (closeCounts.get(tracked) ?? 0) + 1);
          return real.close();
        },
      };
      return tracked;
    },
  };
}

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const exampleConfigPath = join(projectRoot, 'config', 'config.example.json');

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
  const root = mkdtempSync(join(tmpdir(), 'pdd-cmd-rt-'));
  const configDir = join(root, 'config');
  mkdirSync(configDir, { recursive: true });
  const baselinePath = join(configDir, 'config.example.json');
  const configPath = join(configDir, 'config.json');
  copyFileSync(exampleConfigPath, baselinePath);
  if (corrupt) writeFileSync(configPath, '{broken json');
  return {
    configOptions: { baselinePath, configPath, env: {} },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('composeCommandRuntime', () => {
  it('returns frozen shape { mode, ports, outputSink, clock, scopeRuntime, closeAll } and honors runtimeConfigPolicy', async () => {
    const temp = makeTempConfigDir({ corrupt: true });
    try {
      await assert.rejects(
        composeCommandRuntime({ mode: 'fixture', configOptions: temp.configOptions, runtimeConfigPolicy: 'required', env: {} }),
        { code: 'E_CONFIG_INVALID' },
      );

      await assert.rejects(
        composeCommandRuntime({ mode: 'fixture', configOptions: temp.configOptions, runtimeConfigPolicy: 'unknown', env: {} }),
        { code: 'E_CONFIG_INVALID' },
      );

      const maintenance = await composeCommandRuntime({
        mode: 'fixture',
        configOptions: temp.configOptions,
        runtimeConfigPolicy: 'maintenance',
        env: {},
      });
      assert.equal(maintenance.mode, 'fixture');
      assert.equal(maintenance.runtimeConfig, null);
      assert.equal(Object.hasOwn(maintenance, 'rawEnv'), false);
      assert.deepEqual(Object.keys(maintenance.ports).sort(), ['auth', 'browser', 'daemonProcess', 'endpoint', 'goodsPublish', 'mall']);
      assert.equal(typeof maintenance.outputSink.emit, 'function');
      assert.equal(typeof maintenance.outputSink.hasEmitted, 'function');
      assert.equal(typeof maintenance.outputSink.writeDebugRaw, 'function');
      assert.equal(typeof maintenance.clock.now, 'function');
      assert.equal(typeof maintenance.clock.sleep, 'function');
      assert.equal(typeof maintenance.scopeRuntime, 'function');
      assert.equal(typeof maintenance.closeAll, 'function');
      assert.equal(typeof maintenance.scrapeCooldown?.check, 'function');
      assert.equal(typeof maintenance.scrapeCooldown?.recordSoftBlock, 'function');
      assert.equal(typeof maintenance.scrapeCooldown?.recordSuccess, 'function');
      await maintenance.closeAll();
    } finally {
      temp.dispose();
    }
  });

  it('wires overrides, streams, clock, and ADR-0003 read-only daemon_not_running warning through withCommand', async () => {
    const account = insertAccount({ identity: '900001', displayName: 'Memory Shop' }, { setDefault: true });
    saveAuthStateSnapshot(PASS_STATE, account.id);
    insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });

    let nowMs = 1_700_000_000_000;
    const sleepCalls = [];
    const clock = {
      now: () => nowMs,
      sleep: async (ms, signal) => {
        sleepCalls.push(ms);
        if (signal?.aborted) throw new Error('aborted');
        nowMs += ms;
      },
    };

    const { streams, readStdout } = makeMemoryStreams();
    const browser = createInMemoryBrowserRuntime();
    const mall = createInMemoryMallPort({ currentMall: { id: '900001', name: 'Memory Shop' } });
    const auth = createInMemoryAuthPort({ merchantIdentity: { mallId: '900001', displayName: 'Memory Shop' }, now: clock.now });
    const daemonProcess = createInMemoryDaemonProcessPort();
    const transport = createMemoryEndpointTransport({
      responses: {
        'traffic.readyTime': { success: true, errorCode: 0, result: '2026-11-20' },
      },
    });

    const temp = makeTempConfigDir();
    try {
      const runtime = await composeCommandRuntime({
        mode: 'live',
        env: {},
        configOptions: temp.configOptions,
        streams,
        clock,
        overrides: {
          browser,
          mall,
          auth,
          daemonProcess,
          endpointTransport: transport,
          daemonIsRunning: () => false,
        },
      });

      const cmd = withCommand({
        name: 'test.composed',
        needsAuth: true,
        needsMall: 'current',
        async run(ctx) {
          const readyTime = await runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx);
          return { headline: [`ready ${readyTime}`], ready_time: readyTime, mall_id: ctx.mallId };
        },
      });

      const envelope = await cmd({ json: true, timeoutMs: 5000 }, { runtime });
      assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
      assert.equal(envelope.data.ready_time, '2026-11-20');
      assert.equal(envelope.data.mall_id, '900001');
      assert.deepEqual(
        envelope.meta.warnings.filter((w) => w?.code === 'daemon_not_running'),
        [{ code: 'daemon_not_running' }],
      );
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.equal(browser.launches.length, 1);
      assert.equal(transport.calls.length, 1);

      const line = JSON.parse(readStdout().trim());
      assert.equal(line.ok, true);
      assert.equal(line.data.ready_time, '2026-11-20');
      assert.equal(sleepCalls.length, 0);
      await runtime.closeAll();
    } finally {
      temp.dispose();
    }
  });

  it('registers closeAll with runtime-cleanup hooks so signal cleanup closes active sessions', async () => {
    const browser = trackBrowserCloses(createInMemoryBrowserRuntime());
    const temp = makeTempConfigDir();
    try {
      const runtime = await composeCommandRuntime({
        mode: 'live',
        env: {},
        configOptions: temp.configOptions,
        overrides: { browser },
      });

      const session = await runtime.ports.browser.openSession({ headed: false });
      await runCloseAllHooks({ timeoutMs: 1000 });
      assert.equal(browser.closeCount(session), 1);

      await runtime.closeAll();
      // Subsequent hook runs do not retain an unregistered hook.
      const nextSession = await browser.openSession({ headed: false });
      await runCloseAllHooks({ timeoutMs: 1000 });
      assert.equal(browser.closeCount(nextSession), 0);
      await nextSession.close();
    } finally {
      temp.dispose();
    }
  });

  it('derives --all-accounts scopes sharing parent rate limiter & cooldown with cooldown_inherited_from while isolating signal, deadline, correlationId, and BrowserSession', async () => {
    const accountA = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    const accountB = insertAccount({ identity: '900002', displayName: 'Shop B' });
    saveAuthStateSnapshot(PASS_STATE, accountA.id);
    saveAuthStateSnapshot(PASS_STATE, accountB.id);

    const { streams } = makeMemoryStreams();
    const browser = trackBrowserCloses(createInMemoryBrowserRuntime());
    const mall = createInMemoryMallPort({ currentMall: { id: '900001', name: 'Shop A' } });
    const auth = createInMemoryAuthPort({
      merchantIdentity: (_snapshot, opts) => ({
        mallId: String(opts?.expectedMallId ?? '900001'),
        displayName: opts?.expectedMallId === '900002' ? 'Shop B' : 'Shop A',
      }),
    });
    const transport = createMemoryEndpointTransport({
      responses: {
        'traffic.readyTime': () => ({
          status: 200,
          raw: { success: false, errorCode: 54001, errorMsg: 'rate limited' },
        }),
      },
    });

    const temp = makeTempConfigDir();
    try {
      const runtime = await composeCommandRuntime({
        mode: 'live',
        env: {},
        configOptions: temp.configOptions,
        streams,
        clock: { now: () => 1_700_000_000_000, sleep: async () => {} },
        overrides: {
          browser,
          mall,
          auth,
          endpointTransport: transport,
          runtimeConfig: {
            rateLimitQps: 100,
            rateLimitBurst: 100,
            cooldownThreshold: 1,
            cooldownMs: 60_000,
            passwordReloginMinIntervalMs: 1_800_000,
          },
        },
      });

      // Direct scopeRuntime isolation guarantees
      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const scopeA = runtime.scopeRuntime({ signal: controllerA.signal, deadlineAt: 1000, correlationId: 'corr-a' });
      const scopeB = runtime.scopeRuntime({ signal: controllerB.signal, deadlineAt: 2000, correlationId: 'corr-b' });
      assert.equal(scopeA.correlationId, 'corr-a');
      assert.equal(scopeB.correlationId, 'corr-b');
      assert.notEqual(scopeA.signal, scopeB.signal);
      assert.equal(scopeA.deadlineAt, 1000);
      assert.equal(scopeB.deadlineAt, 2000);

      const sessionA = await scopeA.ports.browser.openSession({ headed: false });
      const sessionB = await scopeB.ports.browser.openSession({ headed: false });

      controllerA.abort();
      assert.equal(scopeA.signal.aborted, true);
      assert.equal(scopeB.signal.aborted, false);
      assert.equal(runtime.signal?.aborted ?? false, false);

      await scopeA.closeAll();
      assert.equal(browser.closeCount(sessionA), 1);
      assert.equal(browser.closeCount(sessionB), 0);
      await scopeB.closeAll();
      assert.equal(browser.closeCount(sessionB), 1);

      // --all-accounts batch shares parent cooldown state and emits cooldown_inherited_from
      const cmd = withCommand({
        name: 'test.batchScope',
        needsAuth: true,
        needsMall: 'none',
        run: async (ctx) => runEndpoint(ctx.page, TRAFFIC_READY_TIME, {}, ctx),
      });
      const batch = await cmd({ allAccounts: true, json: true }, { runtime });
      assert.equal(batch.ok, false);
      assert.equal(batch.data.accounts['shop-a'].error.code, 'E_RATE_LIMIT');
      assert.equal(batch.data.accounts['shop-b'].error.code, 'E_RATE_LIMIT');
      assert.equal(batch.data.accounts['shop-b'].error.detail.cooldown_triggered, true);
      assert.ok(batch.meta.warnings.includes('cooldown_inherited_from:shop-a'));
      assert.equal(transport.calls.length, 1);
      await runtime.closeAll();
    } finally {
      temp.dispose();
    }
  });

  it('writes redacted batch raw_debug entries via OutputSink when PDD_DEBUG_RAW=1 in --all-accounts', async () => {
    const accountA = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    const accountB = insertAccount({ identity: '900002', displayName: 'Shop B' });
    saveAuthStateSnapshot(PASS_STATE, accountA.id);
    saveAuthStateSnapshot(PASS_STATE, accountB.id);

    const { streams, readStdout, readStderr } = makeMemoryStreams();
    const browser = createInMemoryBrowserRuntime();
    const mall = createInMemoryMallPort({ currentMall: { id: '900001', name: 'Shop A' } });
    const auth = createInMemoryAuthPort({
      merchantIdentity: (_snapshot, opts) => ({
        mallId: String(opts?.expectedMallId ?? '900001'),
        displayName: opts?.expectedMallId === '900002' ? 'Shop B' : 'Shop A',
      }),
    });

    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: { PDD_DEBUG_RAW: '1' },
      streams,
      clock: { now: () => 1_700_000_000_000, sleep: async () => {} },
      overrides: { browser, mall, auth },
    });

    try {
      const cmd = withCommand({
        name: 'test.batchDebugRaw',
        needsAuth: true,
        needsMall: 'none',
        async run(ctx) {
          if (ctx.accountSlug === 'shop-b') {
            throw new PddCliError({
              code: 'E_BUSINESS',
              message: 'batch item failed',
              detail: { raw: { password: 'secret-batch-password', marker: 'batch-error-raw' } },
              exitCode: ExitCodes.BUSINESS,
            });
          }
          return { headline: ['ok'], raw: { authToken: 'secret-item-token', marker: 'batch-ok-raw' } };
        },
      });

      const batch = await cmd({ allAccounts: true, json: true }, { runtime });
      assert.equal(batch.ok, false);
      assert.equal(Object.hasOwn(batch.data.accounts['shop-a'].data, 'raw'), false);
      assert.equal(Object.hasOwn(batch.data.accounts['shop-b'].error.detail, 'raw'), false);

      const stderrLines = readStderr()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('{'));
      const debugEntries = stderrLines.map((line) => JSON.parse(line)).filter((entry) => entry.type === 'raw_debug');
      const allRawRecords = debugEntries.flatMap((entry) => entry.raw);

      assert.equal(allRawRecords.some((item) => item.value.includes('batch-ok-raw')), true);
      assert.equal(allRawRecords.some((item) => item.path === 'accounts.shop-b.error.detail.raw' && item.value.includes('batch-error-raw')), true);
      assert.equal(readStderr().includes('secret-batch-password'), false);
      assert.equal(readStderr().includes('secret-item-token'), false);
      assert.equal(readStdout().includes('secret-batch-password'), false);
      assert.equal(readStdout().includes('secret-item-token'), false);
    } finally {
      await runtime.closeAll();
    }
  });

  it('loads Live bundle without fixture modules and Fixture bundle without Patchright', () => {
    const commandUrl = new URL('../../src/runtime/command-runtime.js', import.meta.url).href;

    const checkIsolation = (mode, forbiddenPattern) => {
      const script = `
        import { registerHooks } from 'node:module';
        const loaded = [];
        registerHooks({
          resolve(specifier, context, nextResolve) {
            const resolved = nextResolve(specifier, context);
            loaded.push(resolved.url);
            if (${forbiddenPattern}.test(resolved.url) || ${forbiddenPattern}.test(specifier)) {
              throw new Error('Forbidden module loaded in ${mode} mode: ' + specifier + ' -> ' + resolved.url);
            }
            return resolved;
          },
        });
        const { composeCommandRuntime } = await import(${JSON.stringify(commandUrl)});
        const rt = await composeCommandRuntime({ mode: ${JSON.stringify(mode)}, env: {}, runtimeConfigPolicy: 'maintenance' });
        await rt.closeAll();
      `;
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 15_000,
      });
      assert.equal(res.status, 0, res.stderr || res.stdout);
    };

    checkIsolation('live', '/(?:adapter\\/fixtures\\/|console-login-fixture\\.js)/');
    checkIsolation('fixture', '/^patchright$/');
  });

  it('provides instance-scoped persistent scrapeCooldown in live mode and memory-only scrapeCooldown in fixture mode', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pdd-cmd-cooldown-'));
    const statePath = join(tempDir, 'scrape-cooldown.json');
    const config = makeTempConfigDir();
    let nowMs = 1_700_000_000_000;
    const clock = { now: () => nowMs, sleep: async () => {} };

    try {
      const liveA = await composeCommandRuntime({
        mode: 'live',
        env: {},
        configOptions: config.configOptions,
        clock,
        overrides: {
          scrapeCooldownStatePath: statePath,
          runtimeConfig: { scrapeSoftBlockThreshold: 1, scrapeSoftBlockCooldownMs: 30_000 },
        },
      });
      const liveB = await composeCommandRuntime({
        mode: 'live',
        env: {},
        configOptions: config.configOptions,
        clock,
        overrides: {
          scrapeCooldownStatePath: statePath,
          runtimeConfig: { scrapeSoftBlockThreshold: 1, scrapeSoftBlockCooldownMs: 30_000 },
        },
      });

      const scopedA = liveA.scopeRuntime();
      assert.equal(scopedA.scrapeCooldown, liveA.scrapeCooldown);
      assert.notEqual(liveA.scrapeCooldown, liveB.scrapeCooldown);

      liveA.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      assert.throws(() => liveB.scrapeCooldown.check(), { code: 'E_RATE_LIMIT' });
      liveB.scrapeCooldown.recordSuccess();
      liveA.scrapeCooldown.check();

      const fixtureRt = await composeCommandRuntime({
        mode: 'fixture',
        env: {},
        configOptions: config.configOptions,
        clock,
      });
      fixtureRt.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      fixtureRt.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      assert.throws(() => fixtureRt.scrapeCooldown.check(), { code: 'E_RATE_LIMIT' });
      liveA.scrapeCooldown.check();

      await scopedA.closeAll();
      await liveA.closeAll();
      await liveB.closeAll();
      await fixtureRt.closeAll();
    } finally {
      config.dispose();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('wires instance-scoped GoodsPublishPort ({ sourceFetcher, categoryResolver, draftEditor }) in live and fixture modes', async () => {
    const config = makeTempConfigDir();
    try {
      for (const mode of ['live', 'fixture']) {
        const rt = await composeCommandRuntime({
          mode,
          env: {},
          configOptions: config.configOptions,
        });
        const port = rt.ports.goodsPublish;
        assert.equal(typeof port?.sourceFetcher?.prepare, 'function', mode);
        assert.equal(typeof port?.categoryResolver?.resolve, 'function', mode);
        assert.equal(typeof port?.draftEditor?.openDraft, 'function', mode);
        assert.equal(typeof port?.draftEditor?.populateAndSaveDraft, 'function', mode);
        assert.equal(typeof port?.draftEditor?.submitDraft, 'function', mode);
        await rt.closeAll();
      }
    } finally {
      config.dispose();
    }
  });

  it('isolates fixture goodsPublish.sourceFetcher from Qingguo proxy env and external fetch calls', async () => {
    const config = makeTempConfigDir();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    let runtime = null;
    try {
      runtime = await composeCommandRuntime({
        mode: 'fixture',
        env: {
          PDD_SOURCE_PROXY_PROVIDER: 'qingguo',
          PDD_QINGGUO_AUTH_KEY: 'k',
          PDD_QINGGUO_KEY: 'k',
          PDD_QINGGUO_PWD: 'p',
        },
        configOptions: config.configOptions,
      });
      const acquisition = await runtime.ports.goodsPublish.sourceFetcher.prepare('https://mobile.yangkeduo.com/goods.html?goods_id=123456');
      const source = await acquisition.fetch();
      assert.equal(source.goodsID, '123456');
      assert.equal(fetchSpy.mock.calls.length, 0);
    } finally {
      fetchSpy.mockRestore();
      if (runtime) await runtime.closeAll();
      config.dispose();
    }
  });

  it('propagates PDD_TEST_ADAPTER=fixture when spawning daemon subprocesses from fixture runtime', () => {
    const commandUrl = new URL('../../src/runtime/command-runtime.js', import.meta.url).href;
    const script = `
      import { registerHooks } from 'node:module';
      const spawns = [];
      globalThis.__capturedDaemonSpawns = spawns;
      const mockChildProcess = 'data:text/javascript,' + encodeURIComponent(\`
        export function spawn(execPath, args, options) {
          globalThis.__capturedDaemonSpawns.push({ execPath, args, env: options?.env ?? null });
          return { pid: 42424, once() {}, unref() {} };
        }
      \`);
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'node:child_process' && context.parentURL?.endsWith('/src/adapter/daemon-process.js')) {
            return { url: mockChildProcess, shortCircuit: true };
          }
          return nextResolve(specifier, context);
        },
      });
      const { composeCommandRuntime } = await import(${JSON.stringify(commandUrl)});
      const rt = await composeCommandRuntime({ mode: 'fixture', env: {}, runtimeConfigPolicy: 'maintenance' });
      rt.ports.daemonProcess.spawnDetached({ env: { PDD_TEST_ADAPTER: 'live', PDD_TEST_EXTRA: '1' } });
      await rt.closeAll();
      process.stdout.write(JSON.stringify(spawns));
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const spawns = JSON.parse(res.stdout.trim());
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0].env.PDD_TEST_ADAPTER, 'fixture');
    assert.equal(spawns[0].env.PDD_TEST_EXTRA, '1');
  });
});
