import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'vitest';
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { run as doctor } from '../../src/commands/doctor.js';
import { insertAccount } from '../../src/infra/account-store.js';
import { getDatabasePath } from '../../src/infra/db.js';
import { ExitCodes } from '../../src/infra/errors.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { renderDoctor } from '../../src/services/views/auth.js';
import { assertDataContractV2 } from '../helpers/data-contract.js';
import { assertEnvelopeShape } from '../helpers/envelope-assertions.js';
import { createInMemoryAuthPort, createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';
import { createCliSandbox, runCli, spawnNode } from '../helpers/isolated-cli.js';
import { DEFAULT_ACCOUNT, seedDb } from '../helpers/seed-db.js';

const VALID_STATE = {
  cookies: [{ name: 'PASS_ID', value: 'synthetic-pass', domain: '.pinduoduo.com', path: '/' }],
  origins: [],
};

function makeMemoryStreams() {
  const stdoutChunks = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on('data', (chunk) => stdoutChunks.push(chunk.toString('utf8')));
  return {
    streams: { stdout, stderr },
    readStdout: () => stdoutChunks.join(''),
  };
}

describe('doctor command lifecycle and runtime port wiring', () => {
  it('declares local lifecycle preset and rejects --all-accounts with E_USAGE and 0 browsers', async () => {
    assert.equal(doctor.lifecycle, 'local');
    assert.equal(doctor.runtimeConfigPolicy, 'required');

    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort();
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: { browser, auth },
    });

    try {
      const envelope = await doctor({ allAccounts: true, json: true }, { runtime });
      assertEnvelopeShape(envelope, { ok: false, command: 'doctor', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
      assert.equal(envelope.error.code, 'E_USAGE');
      assert.equal(browser.launches.length, 0);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      await runtime.closeAll();
    }
  });

  it('launches 0 browsers when Chromium is missing in live mode and retains legacy_storage_detected', async () => {
    const account = insertAccount({ identity: '900001', displayName: 'Shop A' }, { setDefault: true });
    saveAuthStateSnapshot(VALID_STATE, account.id);
    const legacyFile = join(dirname(getDatabasePath()), 'merchant/stores/registry.json');
    mkdirSync(dirname(legacyFile), { recursive: true });
    writeFileSync(legacyFile, '{}');

    const browser = createInMemoryBrowserRuntime({ available: false });
    const auth = createInMemoryAuthPort();
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: { browser, auth },
    });

    try {
      const envelope = await doctor({ json: true }, { runtime });
      assertEnvelopeShape(envelope, { ok: false, command: 'doctor', exitCode: ExitCodes.GENERAL, hasData: false, hasError: true });
      assert.equal(envelope.error.code, 'E_CHROMIUM_MISSING');
      assert.deepEqual(envelope.meta.warnings, [{ code: 'legacy_storage_detected' }]);
      assert.equal(browser.launches.length, 0);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
    } finally {
      await runtime.closeAll();
    }
  });

  it('runs healthy live doctor with 1 browser session, runner account meta, and no duplicate resolvedAccount', async () => {
    const merchant = insertAccount({ identity: '900001', displayName: 'Shop A' });
    saveAuthStateSnapshot(VALID_STATE, merchant.id);
    const consumer = insertAccount({ kind: 'consumer', identity: 'uid-1', displayName: 'Buyer A' });
    saveAuthStateSnapshot(VALID_STATE, consumer.id);

    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort({ merchantVerdict: 'verified', consumerOnline: true });
    const { streams, readStdout } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: { browser, auth },
    });

    try {
      const envelope = await doctor({ json: true }, { runtime });
      assertEnvelopeShape(envelope, { ok: true, command: 'doctor', exitCode: ExitCodes.OK, hasData: true, hasError: false });
      assertDataContractV2(envelope.data);
      assert.equal(envelope.meta.account, merchant.slug);
      assert.equal(envelope.meta.account_source, 'auto-single');
      assert.equal(Object.hasOwn(envelope.data, 'resolvedAccount'), false);
      assert.equal(browser.launches.length, 1);
      assert.equal(browser.derivedContexts.length, 1);
      assert.equal(runtime.outputSink.hasEmitted(), true);
      assert.deepEqual(JSON.parse(readStdout().trim()), envelope);
      const rendered = renderDoctor(envelope);
      assert.match(rendered, /OK {2}doctor/);
      assert.match(rendered, /✓ Chromium 可用/);
      assert.match(rendered, /✓ 商家端登录态有效/);
      assert.match(rendered, /✓ 用户端登录态有效/);
    } finally {
      await runtime.closeAll();
    }
  });

  it('fails in runner with E_ACCOUNT_REQUIRED and 0 browsers when multiple accounts have no default', async () => {
    insertAccount({ identity: '900001', displayName: 'Shop A' });
    insertAccount({ identity: '900002', displayName: 'Shop B' });

    const browser = createInMemoryBrowserRuntime({ available: true });
    const auth = createInMemoryAuthPort();
    const { streams } = makeMemoryStreams();
    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams,
      overrides: { browser, auth },
    });

    try {
      const envelope = await doctor({ json: true }, { runtime });
      assertEnvelopeShape(envelope, { ok: false, command: 'doctor', exitCode: ExitCodes.USAGE, hasData: false, hasError: true });
      assert.equal(envelope.error.code, 'E_ACCOUNT_REQUIRED');
      assert.equal(browser.launches.length, 0);
    } finally {
      await runtime.closeAll();
    }
  });
});

describe('doctor CLI E2E in fixture mode', () => {
  it('succeeds in fixture mode, rejects removed --probe option, and rejects --all-accounts', async () => {
    const ok = runCli(['doctor'], { authState: VALID_STATE });
    assert.equal(ok.status, 0);
    assert.equal(ok.envelope.command, 'doctor');
    assert.equal(ok.envelope.meta.account, DEFAULT_ACCOUNT.slug);
    assert.equal(Object.hasOwn(ok.envelope.data, 'resolvedAccount'), false);
    assertDataContractV2(ok.envelope.data);

    const probe = runCli(['doctor', '--probe', 'xhr'], { authState: VALID_STATE });
    assert.equal(probe.status, ExitCodes.USAGE);
    assert.equal(probe.envelope.error.code, 'E_USAGE');

    const allAccounts = runCli(['doctor', '--all-accounts'], { authState: VALID_STATE });
    assert.equal(allAccounts.status, ExitCodes.USAGE);
    assert.equal(allAccounts.envelope.error.code, 'E_USAGE');

    const sandbox = createCliSandbox();
    try {
      seedDb(sandbox.env.PDD_DB_PATH, {
        accounts: [DEFAULT_ACCOUNT],
        authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: VALID_STATE }],
      });
      const human = await spawnNode(['bin/pdd.js', 'doctor', '--no-color'], { env: sandbox.env });
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /OK {2}doctor/);
      assert.match(human.stdout, /✓ Chromium 可用/);
      assert.match(human.stdout, /✓ 商家端登录态有效/);
    } finally {
      sandbox.dispose();
    }
  });
});
