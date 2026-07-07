import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

const outputMock = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock('../src/infra/output.js', async (importOriginal) => ({
  ...(await importOriginal()),
  emit: outputMock.emit,
}));

const { executeSingle } = await import('../src/commands/_runner.js');

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
});
