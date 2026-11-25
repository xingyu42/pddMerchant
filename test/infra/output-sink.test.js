import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createOutputSink } from '../../src/infra/output-sink.js';
import { buildEnvelope, buildBatchEnvelope } from '../../src/infra/output.js';
import { createSystemClock, resolveClock } from '../../src/infra/clock.js';

function memoryStreams() {
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

describe('OutputSink', () => {
  it('emits single-line redacted JSON to injected stdout, tracks hasEmitted, and ignores duplicate emits', () => {
    const { streams, readStdout, readStderr } = memoryStreams();
    const sink = createOutputSink({ streams });

    assert.equal(sink.hasEmitted(), false);
    assert.equal(sink.streams.stdout, streams.stdout);
    assert.equal(sink.streams.stderr, streams.stderr);

    const first = sink.emit({
      ok: true,
      command: 'orders.list',
      data: { headline: ['ok'], password: 'secret-password', raw: { inner: 'ignored' } },
      meta: { latency_ms: 5, correlation_id: 'corr-1' },
    }, { json: true });

    assert.equal(sink.hasEmitted(), true);
    assert.equal(first.data.password, 'secret-password');
    assert.equal(Object.hasOwn(first.data, 'raw'), false);

    const second = sink.emit({ ok: true, command: 'orders.list', data: { headline: ['second'] } }, { json: true });
    assert.equal(second, first);

    const lines = readStdout().trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.data.password, '[REDACTED]');
    assert.equal(Object.hasOwn(parsed.data, 'raw'), false);
    assert.equal(parsed.meta.v, 2);
    assert.equal(readStderr(), '');
  });

  it('isolates PDD_DEBUG_RAW via debugRaw flag instead of reading process.env', () => {
    vi.stubEnv('PDD_DEBUG_RAW', '1');
    const off = memoryStreams();
    const offSink = createOutputSink({ streams: off.streams, debugRaw: false });
    offSink.emit({
      ok: true,
      command: 'test.cmd',
      data: { raw: { token: 'secret-val' } },
      meta: { correlation_id: 'c1' },
    }, { json: true });
    assert.equal(off.readStderr(), '');
    assert.equal(offSink.writeDebugRaw({ command: 'test.cmd', raw: { a: 1 } }), false);
    assert.equal(off.readStderr(), '');

    const on = memoryStreams();
    const onSink = createOutputSink({ streams: on.streams, debugRaw: true });
    onSink.emit({
      ok: true,
      command: 'test.cmd',
      data: { raw: { password: 'secret-val', safe: 1 } },
      meta: { correlation_id: 'c2' },
    }, { json: true });
    const debugLines = on.readStderr().trim().split(/\r?\n/);
    assert.equal(debugLines.length, 1);
    const debugObj = JSON.parse(debugLines[0]);
    assert.equal(debugObj.type, 'raw_debug');
    assert.equal(debugObj.command, 'test.cmd');
    assert.equal(debugObj.correlation_id, 'c2');
    assert.equal(debugLines[0].includes('secret-val'), false);
    assert.equal(debugLines[0].includes('[REDACTED]'), true);
  });

  it('supports direct writeDebugRaw(payload) with redaction when debugRaw is true', () => {
    const { streams, readStderr } = memoryStreams();
    const sink = createOutputSink({ streams, debugRaw: true });
    assert.equal(sink.writeDebugRaw({
      command: 'goods.list',
      correlation_id: 'c3',
      raw: { mobile: '13800138000', password: 'secret-value' },
    }), true);
    const output = readStderr().trim();
    const parsed = JSON.parse(output);
    assert.equal(parsed.type, 'raw_debug');
    assert.equal(parsed.command, 'goods.list');
    assert.equal(parsed.correlation_id, 'c3');
    assert.equal(output.includes('13800138000'), false);
    assert.equal(output.includes('secret-value'), false);
  });

  it('does not read PDD_DEBUG_RAW directly inside buildEnvelope or buildBatchEnvelope', () => {
    vi.stubEnv('PDD_DEBUG_RAW', '1');
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    buildEnvelope({ ok: true, command: 'x', data: { raw: { a: 1 } } });
    buildBatchEnvelope('x', { shop: { ok: true, data: { raw: { b: 2 } } } });
    assert.equal(stderrSpy.mock.calls.length, 0);
  });

  it('rejects invalid streams overrides with E_CONFIG_INVALID', () => {
    assert.throws(() => createOutputSink({ streams: { stdout: null, stderr: process.stderr } }), { code: 'E_CONFIG_INVALID' });
    assert.throws(() => createOutputSink({ streams: { stdout: process.stdout, stderr: {} } }), { code: 'E_CONFIG_INVALID' });
  });
});

describe('clock seam', () => {
  it('provides frozen system clock and validates custom clocks', async () => {
    const sys = createSystemClock();
    assert.equal(Object.isFrozen(sys), true);
    assert.equal(typeof sys.now(), 'number');

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(sys.sleep(10, controller.signal), { code: 'E_TIMEOUT' });

    const custom = resolveClock({ now: () => 12345 });
    assert.equal(custom.now(), 12345);
    assert.equal(typeof custom.sleep, 'function');

    assert.throws(() => resolveClock('bad'), { code: 'E_CONFIG_INVALID' });
    assert.throws(() => resolveClock({ now: 123 }), { code: 'E_CONFIG_INVALID' });
    assert.throws(() => resolveClock({ sleep: 'nope' }), { code: 'E_CONFIG_INVALID' });
  });
});
