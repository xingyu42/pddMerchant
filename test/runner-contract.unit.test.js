import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { timeoutError } from '../src/infra/abort.js';
import { ExitCodes } from '../src/infra/errors.js';
import { TEST_RUNTIME_CONFIG } from './helpers/runtime-config.js';

const outputMock = vi.hoisted(() => ({
  emit: vi.fn(),
}));

const liveMocks = vi.hoisted(() => ({
  fakePage: { __fake: 'page' },
  fakeContext: { __fake: 'context' },
  closeAll: vi.fn(async () => {}),
  getAuthStateRevision: vi.fn(async () => 'revision-1'),
  isAuthValid: vi.fn(async () => true),
  resolveMallContext: vi.fn(async () => ({ activeId: '445301049', activeName: 'probe-mall', malls: [], source: 'probe' })),
  saveAuthStateIfCurrent: vi.fn(async () => ({ saved: true, reason: 'saved' })),
}));

vi.mock('../src/infra/output.js', async (importOriginal) => ({
  ...(await importOriginal()),
  emit: outputMock.emit,
}));

vi.mock('../src/adapter/browser.js', async (importOriginal) => ({
  ...(await importOriginal()),
  withBrowser: async (options, fn) => fn({
    browser: { __fake: 'browser', options },
    context: liveMocks.fakeContext,
    page: liveMocks.fakePage,
  }),
}));

vi.mock('../src/adapter/auth-state.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getAuthStateRevision: liveMocks.getAuthStateRevision,
  isAuthValid: liveMocks.isAuthValid,
  saveAuthStateIfCurrent: liveMocks.saveAuthStateIfCurrent,
}));

vi.mock('../src/adapter/mall-reader.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveMallContext: liveMocks.resolveMallContext,
}));

vi.mock('../src/adapter/mall-writer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  switchTo: async () => {},
}));

vi.mock('../src/adapter/page-session.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createPageSession: () => ({
    closeAll: liveMocks.closeAll,
    goto: async () => liveMocks.fakePage,
    getSiblings: () => [],
  }),
}));

const { executeSingle } = await import('../src/commands/_runner.js');
const { getSharedClient } = await import('../src/adapter/rate-limiter-singleton.js');
getSharedClient(TEST_RUNTIME_CONFIG);

function makeSpec(overrides = {}) {
  return {
    name: 'runner.contract',
    needsAuth: false,
    needsMall: 'none',
    async run() { return { value: 1 }; },
    ...overrides,
  };
}

describe('runner contract invariants', () => {
  let savedAdapter;
  let savedAuthInvalid;

  beforeEach(() => {
    savedAdapter = process.env.PDD_TEST_ADAPTER;
    savedAuthInvalid = process.env.PDD_TEST_AUTH_INVALID;
    process.env.PDD_TEST_ADAPTER = 'fixture';
    delete process.env.PDD_TEST_AUTH_INVALID;
    outputMock.emit.mockClear();
    liveMocks.closeAll.mockReset();
    liveMocks.closeAll.mockResolvedValue(undefined);
    liveMocks.getAuthStateRevision.mockReset();
    liveMocks.getAuthStateRevision.mockResolvedValue('revision-1');
    liveMocks.isAuthValid.mockClear();
    liveMocks.resolveMallContext.mockClear();
    liveMocks.saveAuthStateIfCurrent.mockReset();
    liveMocks.saveAuthStateIfCurrent.mockResolvedValue({ saved: true, reason: 'saved' });
  });

  afterEach(() => {
    if (savedAdapter !== undefined) process.env.PDD_TEST_ADAPTER = savedAdapter;
    else delete process.env.PDD_TEST_ADAPTER;
    if (savedAuthInvalid !== undefined) process.env.PDD_TEST_AUTH_INVALID = savedAuthInvalid;
    else delete process.env.PDD_TEST_AUTH_INVALID;
  });

  it('emits exactly once on success when emitResult=true', async () => {
    const envelope = await executeSingle(
      makeSpec({ name: 'runner.emit.success' }),
      { json: true, noColor: true },
      { emitResult: true, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(outputMock.emit.mock.calls.length, 1);
    assert.deepEqual(outputMock.emit.mock.calls[0][0], envelope);
  });

  it('emits exactly once on error when emitResult=true', async () => {
    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.emit.error',
        async run() { throw new Error('runner boom'); },
      }),
      { json: true, noColor: true },
      { emitResult: true, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, false);
    assert.equal(outputMock.emit.mock.calls.length, 1);
    assert.deepEqual(outputMock.emit.mock.calls[0][0], envelope);
  });

  it('returns an envelope without emitting when emitResult=false', async () => {
    const envelope = await executeSingle(
      makeSpec({ name: 'runner.emit.disabled' }),
      { json: true, noColor: true },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(outputMock.emit.mock.calls.length, 0);
  });

  it('merges runtime and result warnings once in order', async () => {
    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.warnings.merge',
        async run() { return { data: { ok: 1 }, warnings: ['result_warning'] }; },
      }),
      { json: true, noColor: true, mall: '445301049' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, ['unused_flag_mall', 'result_warning']);
    assert.equal(outputMock.emit.mock.calls.length, 0);
  });

  it('injects a live deadline and signal into command ctx when timeoutMs is supplied', async () => {
    let captured;
    const timeoutMs = 1000;
    const before = Date.now();
    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.deadline.ctx',
        async run(ctx) { captured = ctx; return { ok: true }; },
      }),
      { json: true, noColor: true, timeoutMs },
      { emitResult: false, skipDaemonStart: true },
    );
    const after = Date.now();

    assert.equal(envelope.ok, true);
    assert.ok(captured.signal, 'ctx.signal must be present when timeoutMs is supplied');
    assert.equal(captured.signal.aborted, false);
    assert.equal(typeof captured.deadlineAt, 'number');
    assert.ok(captured.deadlineAt >= before + timeoutMs);
    assert.ok(captured.deadlineAt <= after + timeoutMs);
  });

  it('finalizes live pageSession closeAll failures as one emitted error envelope', async () => {
    delete process.env.PDD_TEST_ADAPTER;
    liveMocks.closeAll.mockRejectedValueOnce(new Error('close boom'));

    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.live.close.failure',
        async run() { return { ok: true }; },
      }),
      { json: true, noColor: true },
      { emitResult: true, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_GENERAL');
    assert.equal(envelope.meta.exit_code, ExitCodes.GENERAL);
    assert.equal(liveMocks.closeAll.mock.calls.length, 1);
    assert.equal(outputMock.emit.mock.calls.length, 1);
    assert.deepEqual(outputMock.emit.mock.calls[0][0], envelope);
  });

  it('persists refreshed auth state after a successful live authenticated command', async () => {
    delete process.env.PDD_TEST_ADAPTER;

    const envelope = await executeSingle(
      makeSpec({ name: 'runner.auth.persist', needsAuth: true }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(liveMocks.getAuthStateRevision.mock.calls.length, 1);
    assert.equal(liveMocks.saveAuthStateIfCurrent.mock.calls.length, 1);
    assert.deepEqual(liveMocks.saveAuthStateIfCurrent.mock.calls[0], [
      liveMocks.fakeContext,
      'D:/tmp/auth-state.json',
      'revision-1',
    ]);
  });

  it('keeps command success and emits a warning when auth persistence conflicts', async () => {
    delete process.env.PDD_TEST_ADAPTER;
    liveMocks.saveAuthStateIfCurrent.mockResolvedValueOnce({ saved: false, reason: 'conflict' });

    const envelope = await executeSingle(
      makeSpec({ name: 'runner.auth.persist.conflict', needsAuth: true }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, ['auth_state_persist_conflict']);
  });

  it('keeps command success and emits a warning when auth persistence fails', async () => {
    delete process.env.PDD_TEST_ADAPTER;
    liveMocks.saveAuthStateIfCurrent.mockRejectedValueOnce(new Error('disk unavailable'));

    const envelope = await executeSingle(
      makeSpec({ name: 'runner.auth.persist.failure', needsAuth: true }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, ['auth_state_persist_failed']);
  });

  it('does not persist auth state after a failed live command', async () => {
    delete process.env.PDD_TEST_ADAPTER;

    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.auth.persist.error',
        needsAuth: true,
        async run() { throw new Error('business failed'); },
      }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, false);
    assert.equal(liveMocks.saveAuthStateIfCurrent.mock.calls.length, 0);
  });

  it('does not read or persist auth state for a live command that does not need auth', async () => {
    delete process.env.PDD_TEST_ADAPTER;

    const envelope = await executeSingle(
      makeSpec({ name: 'runner.auth.persist.not-required' }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(liveMocks.getAuthStateRevision.mock.calls.length, 0);
    assert.equal(liveMocks.saveAuthStateIfCurrent.mock.calls.length, 0);
  });

  it('does not read or persist real auth state in fixture mode', async () => {
    const envelope = await executeSingle(
      makeSpec({ name: 'runner.auth.persist.fixture', needsAuth: true }),
      { json: true, noColor: true, authStatePath: 'D:/tmp/auth-state.json' },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(envelope.ok, true);
    assert.equal(liveMocks.getAuthStateRevision.mock.calls.length, 0);
    assert.equal(liveMocks.saveAuthStateIfCurrent.mock.calls.length, 0);
  });

  it('finalizes an already-aborted parentSignal through the standard error envelope path', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parent aborted'));

    let observedSignal;
    const envelope = await executeSingle(
      makeSpec({
        name: 'runner.parent.abort',
        async run(ctx) {
          observedSignal = ctx.signal;
          if (ctx.signal?.aborted) throw timeoutError();
          return { ok: true };
        },
      }),
      { json: true, noColor: true },
      { emitResult: true, skipDaemonStart: true, parentSignal: controller.signal },
    );

    assert.equal(observedSignal, controller.signal);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_TIMEOUT');
    assert.equal(envelope.meta.exit_code, ExitCodes.NETWORK);
    assert.equal(outputMock.emit.mock.calls.length, 1);
    assert.deepEqual(outputMock.emit.mock.calls[0][0], envelope);
  });

  it('skips run(ctx) and returns auth error envelope when fixture auth is invalid', async () => {
    process.env.PDD_TEST_AUTH_INVALID = '1';
    const run = vi.fn(async () => ({ ok: true }));

    const envelope = await executeSingle(
      makeSpec({ name: 'runner.fixture.auth.invalid', needsAuth: true, run }),
      { json: true, noColor: true },
      { emitResult: false, skipDaemonStart: true },
    );

    assert.equal(run.mock.calls.length, 0);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, 'E_AUTH_EXPIRED');
    assert.equal(envelope.meta.exit_code, ExitCodes.AUTH);
    assert.equal(outputMock.emit.mock.calls.length, 0);
  });
});
