import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { errorToEnvelope, PddCliError, ExitCodes } from '../src/infra/errors.js';
import { buildEnvelope, emit } from '../src/infra/output.js';

describe('errorToEnvelope', () => {
  it('preserves PddCliError detail with redaction', () => {
    const err = new PddCliError({
      code: 'E_TEST',
      message: 'test error',
      detail: { url: '/api', cookies: 'secret-cookie-value' },
      exitCode: ExitCodes.GENERAL,
    });
    const envelope = errorToEnvelope('test.cmd', err);

    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.command, 'test.cmd');
    assert.strictEqual(envelope.error.code, 'E_TEST');
    assert.strictEqual(envelope.meta.exit_code, ExitCodes.GENERAL);
    assert.ok(envelope.error.detail);
    assert.strictEqual(envelope.error.detail.url, '/api');
    assert.ok(
      typeof envelope.error.detail.cookies === 'string' && envelope.error.detail.cookies.startsWith('fp:'),
      'cookies should be fingerprinted'
    );
  });

  it('adds E_ prefix to non-prefixed codes', () => {
    const err = new PddCliError({ code: 'CUSTOM', message: 'x', exitCode: 1 });
    const envelope = errorToEnvelope('cmd', err);
    assert.strictEqual(envelope.error.code, 'E_CUSTOM');
  });

  it('preserves E_ prefix when already present', () => {
    const err = new PddCliError({ code: 'E_AUTH', message: 'x', exitCode: 3 });
    const envelope = errorToEnvelope('cmd', err);
    assert.strictEqual(envelope.error.code, 'E_AUTH');
  });

  it('handles plain Error (non-PddCliError)', () => {
    const err = new Error('plain error');
    const envelope = errorToEnvelope('cmd', err);
    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.error.code, 'E_GENERAL');
    assert.strictEqual(envelope.meta.exit_code, ExitCodes.GENERAL);
  });

  it('propagates meta fields', () => {
    const err = new PddCliError({ code: 'E_X', message: 'x', exitCode: 1 });
    const envelope = errorToEnvelope('cmd', err, {
      latency_ms: 123,
      warnings: ['w1'],
      correlation_id: 'abc-123',
    });
    assert.strictEqual(envelope.meta.latency_ms, 123);
    assert.deepStrictEqual(envelope.meta.warnings, ['w1']);
    assert.strictEqual(envelope.meta.correlation_id, 'abc-123');
  });
});

describe('emit --json', () => {
  it('stdout output is a single newline-terminated JSON line', () => {
    const chunks = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (data) => { chunks.push(data); return true; };

    try {
      const envelope = emit(
        {
          ok: true,
          command: 'test',
          data: { key: 'value' },
          meta: { warnings: ['w1', 'w2'], latency_ms: 50 },
        },
        { json: true }
      );

      assert.strictEqual(chunks.length, 1, 'exactly one stdout write');
      const line = chunks[0];
      assert.ok(line.endsWith('\n'), 'must end with newline');
      assert.ok(!line.slice(0, -1).includes('\n'), 'no internal newlines');

      const parsed = JSON.parse(line);
      assert.strictEqual(parsed.ok, true);
      assert.strictEqual(parsed.command, 'test');
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it('error envelopes write error lines to stderr, not stdout', () => {
    const stdoutChunks = [];
    const stderrChunks = [];
    const origStdout = process.stdout.write;
    const origStderr = process.stderr.write;
    process.stdout.write = (d) => { stdoutChunks.push(d); return true; };
    process.stderr.write = (d) => { stderrChunks.push(d); return true; };

    try {
      emit(
        {
          ok: false,
          command: 'test',
          error: { code: 'E_TEST', message: 'boom', hint: 'fix it' },
        },
        { json: true }
      );

      assert.strictEqual(stdoutChunks.length, 1, 'one JSON line to stdout');
      assert.ok(stderrChunks.length > 0, 'error info goes to stderr');
    } finally {
      process.stdout.write = origStdout;
      process.stderr.write = origStderr;
    }
  });
});
