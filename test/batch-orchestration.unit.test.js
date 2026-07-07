import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

const batchMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  executeSingle: vi.fn(),
  listAccounts: vi.fn(),
  ensureDaemonRunning: vi.fn(async () => {}),
  abortableSleep: vi.fn(async () => {}),
}));

vi.mock('../src/infra/output.js', async (importOriginal) => ({
  ...(await importOriginal()),
  emit: batchMocks.emit,
}));

vi.mock('../src/commands/runner/single-lifecycle.js', () => ({
  executeSingle: batchMocks.executeSingle,
}));

vi.mock('../src/infra/account-registry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listAccounts: batchMocks.listAccounts,
}));

vi.mock('../src/infra/daemon-launcher.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureDaemonRunning: batchMocks.ensureDaemonRunning,
}));

vi.mock('../src/infra/abort.js', async (importOriginal) => ({
  ...(await importOriginal()),
  abortableSleep: batchMocks.abortableSleep,
}));

const { withCommand } = await import('../src/commands/_runner.js');
const { ExitCodes } = await import('../src/infra/errors.js');
const { accountAuthStatePath } = await import('../src/infra/paths.js');

function makeBatchCommand(overrides = {}) {
  return withCommand({
    name: 'test.batch.orchestration',
    needsAuth: true,
    needsMall: 'switch',
    async run() { return { value: 1 }; },
    ...overrides,
  });
}

function successEnvelope(command, slug) {
  return {
    ok: true,
    command,
    data: { slug },
    error: null,
    meta: { v: 1, exit_code: ExitCodes.OK, latency_ms: 1, xhr_count: 0, warnings: [`warn:${slug}`] },
  };
}

function resetMocks() {
  batchMocks.emit.mockClear();
  batchMocks.executeSingle.mockReset();
  batchMocks.listAccounts.mockReset();
  batchMocks.ensureDaemonRunning.mockClear();
  batchMocks.abortableSleep.mockReset();
  batchMocks.ensureDaemonRunning.mockResolvedValue(undefined);
  batchMocks.abortableSleep.mockResolvedValue(undefined);
}

describe('batch orchestration invariants', () => {
  const originalAuthStatePath = process.env.PDD_AUTH_STATE_PATH;

  beforeEach(() => {
    resetMocks();
    delete process.env.PDD_AUTH_STATE_PATH;
  });

  afterEach(() => {
    if (originalAuthStatePath !== undefined) process.env.PDD_AUTH_STATE_PATH = originalAuthStatePath;
    else delete process.env.PDD_AUTH_STATE_PATH;
  });

  it('rejects --all-accounts with --account before daemon, account iteration, or emit', async () => {
    const cmd = makeBatchCommand();

    await assert.rejects(
      () => cmd({ allAccounts: true, account: 'shop-a', json: true, noColor: true }),
      (err) => err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
    );

    assert.equal(batchMocks.listAccounts.mock.calls.length, 0);
    assert.equal(batchMocks.ensureDaemonRunning.mock.calls.length, 0);
    assert.equal(batchMocks.executeSingle.mock.calls.length, 0);
    assert.equal(batchMocks.abortableSleep.mock.calls.length, 0);
    assert.equal(batchMocks.emit.mock.calls.length, 0);
  });

  it('rejects PDD_AUTH_STATE_PATH with --all-accounts before daemon, account iteration, or emit', async () => {
    process.env.PDD_AUTH_STATE_PATH = 'D:/tmp/auth-state.json';
    const cmd = makeBatchCommand();

    await assert.rejects(
      () => cmd({ allAccounts: true, json: true, noColor: true }),
      (err) => err.code === 'E_USAGE' && err.exitCode === ExitCodes.USAGE,
    );

    assert.equal(batchMocks.listAccounts.mock.calls.length, 0);
    assert.equal(batchMocks.ensureDaemonRunning.mock.calls.length, 0);
    assert.equal(batchMocks.executeSingle.mock.calls.length, 0);
    assert.equal(batchMocks.abortableSleep.mock.calls.length, 0);
    assert.equal(batchMocks.emit.mock.calls.length, 0);
  });

  it('emits an OK empty batch without daemon, per-account execution, or jitter when all accounts are disabled', async () => {
    batchMocks.listAccounts.mockResolvedValue([
      { slug: 'disabled-a', disabled: true },
      { slug: 'disabled-b', disabled: true },
    ]);
    const cmd = makeBatchCommand();

    const envelope = await cmd({ allAccounts: true, json: true, noColor: true, mall: '445301049' });

    assert.equal(envelope.ok, true);
    assert.equal(envelope.meta.batch, true);
    assert.equal(envelope.meta.exit_code, ExitCodes.OK);
    assert.deepEqual(envelope.meta.warnings, ['unused_flag_mall_in_batch']);
    assert.deepEqual(envelope.data.summary, { total_accounts: 0, attempted: 0, succeeded: 0, failed: 0 });
    assert.deepEqual(envelope.data.accounts, {});
    assert.equal(batchMocks.ensureDaemonRunning.mock.calls.length, 0);
    assert.equal(batchMocks.executeSingle.mock.calls.length, 0);
    assert.equal(batchMocks.abortableSleep.mock.calls.length, 0);
    assert.equal(batchMocks.emit.mock.calls.length, 1);
    assert.deepEqual(batchMocks.emit.mock.calls[0][0], envelope);
  });

  it('runs enabled accounts sequentially with shaped per-account options, jitter between accounts, daemon once, and emit once', async () => {
    const accounts = [{ slug: 'shop-a' }, { slug: 'shop-b' }, { slug: 'shop-c' }];
    batchMocks.listAccounts.mockResolvedValue(accounts);
    batchMocks.executeSingle.mockImplementation(async (spec, opts) => successEnvelope(spec.name, opts._correlationId.split(':')[1]));
    const cmd = makeBatchCommand();

    const envelope = await cmd({ allAccounts: true, json: true, noColor: true, mall: '445301049', size: 20 });

    assert.equal(envelope.ok, true);
    assert.equal(batchMocks.ensureDaemonRunning.mock.calls.length, 1);
    assert.equal(batchMocks.executeSingle.mock.calls.length, 3);
    assert.equal(batchMocks.abortableSleep.mock.calls.length, 2);
    assert.equal(batchMocks.emit.mock.calls.length, 1);
    assert.deepEqual(batchMocks.emit.mock.calls[0][0], envelope);
    assert.deepEqual(envelope.meta.warnings, ['unused_flag_mall_in_batch', 'warn:shop-a', 'warn:shop-b', 'warn:shop-c']);

    for (let i = 0; i < accounts.length; i += 1) {
      const [spec, perOpts, runOptions] = batchMocks.executeSingle.mock.calls[i];
      assert.equal(spec.name, 'test.batch.orchestration');
      assert.equal(perOpts.allAccounts, false);
      assert.equal(perOpts.account, undefined);
      assert.equal(perOpts.mall, undefined);
      assert.equal(perOpts.size, 20);
      assert.equal(perOpts.authStatePath, accountAuthStatePath(accounts[i].slug));
      assert.match(perOpts._correlationId, new RegExp(`^[^:]+:${accounts[i].slug}$`));
      assert.equal(runOptions.emitResult, false);
      assert.equal(runOptions.skipDaemonStart, true);
      assert.ok(runOptions.parentSignal instanceof AbortSignal);
    }

    for (const [sleepMs, signal] of batchMocks.abortableSleep.mock.calls) {
      assert.ok(sleepMs >= 2000 && sleepMs < 5000, `jitter out of range: ${sleepMs}`);
      assert.ok(signal instanceof AbortSignal);
    }
  });

  it('does not route needsAuth=false commands into batch execution', async () => {
    batchMocks.executeSingle.mockResolvedValue({
      ok: true,
      command: 'test.batch.orchestration',
      data: { value: 1 },
      error: null,
      meta: { v: 1, exit_code: ExitCodes.OK, latency_ms: 1, xhr_count: 0, warnings: [] },
    });
    const cmd = makeBatchCommand({ needsAuth: false });

    const envelope = await cmd({ allAccounts: true, json: true, noColor: true });

    assert.equal(envelope.ok, true);
    assert.equal(batchMocks.executeSingle.mock.calls.length, 1);
    assert.deepEqual(batchMocks.executeSingle.mock.calls[0][2], { emitResult: true, skipDaemonStart: false });
    assert.equal(batchMocks.listAccounts.mock.calls.length, 0);
    assert.equal(batchMocks.ensureDaemonRunning.mock.calls.length, 0);
    assert.equal(batchMocks.abortableSleep.mock.calls.length, 0);
    assert.equal(batchMocks.emit.mock.calls.length, 0);
  });
});
