import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildEnvelope, emit } from '../src/infra/output.js';

const EnvelopeSchema = z.object({
  ok: z.boolean(),
  command: z.string(),
  data: z.any().nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      hint: z.string().optional(),
    })
    .nullable(),
  meta: z.object({
    v: z.number(),
    latency_ms: z.number(),
    xhr_count: z.number(),
    warnings: z.array(z.string()),
  }),
});

test('buildEnvelope fills meta defaults', () => {
  const env = buildEnvelope({ ok: true, command: 'test', data: { a: 1 } });
  const parsed = EnvelopeSchema.safeParse(env);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(env.meta.latency_ms, 0);
  assert.equal(env.meta.xhr_count, 0);
  assert.deepEqual(env.meta.warnings, []);
  assert.equal(env.error, null);
});

test('buildEnvelope preserves passed meta and error', () => {
  const env = buildEnvelope({
    ok: false,
    command: 'orders.list',
    data: null,
    error: { code: 'E_AUTH', message: '登录失败', hint: '执行 pdd login' },
    meta: { latency_ms: 123, xhr_count: 1, warnings: ['slow'] },
  });
  const parsed = EnvelopeSchema.safeParse(env);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(env.meta.latency_ms, 123);
  assert.equal(env.meta.xhr_count, 1);
  assert.deepEqual(env.meta.warnings, ['slow']);
  assert.equal(env.error.code, 'E_AUTH');
});

test('emit with json=true returns envelope matching schema', () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  };
  try {
    const env = emit(
      { ok: true, command: 'test.emit', data: { x: 1 }, meta: { latency_ms: 50 } },
      { json: true }
    );
    const parsed = EnvelopeSchema.safeParse(env);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    const lines = captured.trim().split('\n');
    assert.equal(lines.length, 1, 'json mode must produce single stdout line');
    const payload = JSON.parse(lines[0]);
    assert.equal(payload.ok, true);
    assert.equal(payload.command, 'test.emit');
    assert.equal(payload.data.x, 1);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('emit error envelope also conforms to schema', () => {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    const env = emit(
      {
        ok: false,
        command: 'test.err',
        data: null,
        error: { code: 'E_BUSINESS', message: 'boom', hint: 'retry' },
      },
      { json: true }
    );
    const parsed = EnvelopeSchema.safeParse(env);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(env.ok, false);
    assert.equal(env.error.code, 'E_BUSINESS');
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErr;
  }
});
