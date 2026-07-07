import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeRunResult, finalizeSuccess, finalizeError } from '../src/commands/runner/envelope-finalizer.js';
import { ExitCodes } from '../src/infra/errors.js';

function makeRuntime(overrides = {}) {
  return {
    emitResult: false,
    opts: { json: true, noColor: true },
    startedAt: Date.now(),
    warnings: ['runtime_warning'],
    correlationId: 'cid-finalizer',
    accountCtx: null,
    ...overrides,
  };
}

function makeSpec(overrides = {}) {
  return {
    name: 'finalizer.contract',
    ...overrides,
  };
}

describe('envelope finalizer contract', () => {
  it('normalizes nullish, primitive, array, plain object, and reserved result shapes', () => {
    assert.deepEqual(normalizeRunResult(null), { data: null });
    assert.deepEqual(normalizeRunResult(undefined), { data: null });
    assert.deepEqual(normalizeRunResult('ok'), { data: 'ok' });
    assert.deepEqual(normalizeRunResult([1, 2]), { data: [1, 2] });
    assert.deepEqual(normalizeRunResult({ value: 1 }), { data: { value: 1 } });
    assert.deepEqual(
      normalizeRunResult({ data: { value: 2 }, meta: { count: 1 }, warnings: ['result_warning'] }),
      { data: { value: 2 }, meta: { count: 1 }, warnings: ['result_warning'] },
    );
    assert.deepEqual(normalizeRunResult({ meta: { only: true } }), {
      data: null,
      meta: { only: true },
      warnings: undefined,
    });
  });

  it('finalizes success with normalized data, merged warnings, extra meta, and ok exit code', () => {
    const envelope = finalizeSuccess(
      makeSpec(),
      makeRuntime(),
      { data: { value: 1 }, meta: { custom: 'meta' }, warnings: ['result_warning'] },
    );

    assert.equal(envelope.ok, true);
    assert.equal(envelope.command, 'finalizer.contract');
    assert.deepEqual(envelope.data, { value: 1 });
    assert.equal(envelope.error, null);
    assert.equal(envelope.meta.exit_code, ExitCodes.OK);
    assert.equal(envelope.meta.correlation_id, 'cid-finalizer');
    assert.equal(envelope.meta.custom, 'meta');
    assert.deepEqual(envelope.meta.warnings, ['runtime_warning', 'result_warning']);
  });

  it('finalizes unknown errors through the standard error envelope shape', () => {
    const envelope = finalizeError(makeSpec(), makeRuntime(), new Error('finalizer boom'));

    assert.equal(envelope.ok, false);
    assert.equal(envelope.command, 'finalizer.contract');
    assert.equal(envelope.data, null);
    assert.equal(envelope.error.code, 'E_GENERAL');
    assert.equal(envelope.error.message, 'finalizer boom');
    assert.equal(envelope.meta.exit_code, ExitCodes.GENERAL);
    assert.equal(envelope.meta.correlation_id, 'cid-finalizer');
    assert.deepEqual(envelope.meta.warnings, ['runtime_warning']);
  });
});
