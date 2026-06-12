// PROP-RAW-2/3（refactor-arch-review-remediation task 2.2，design §D-1/§D-8）
// PROP-RAW-2: PDD_DEBUG_RAW 只改变 stderr —— stdout envelope 逐字节不变，
//             debug JSONL 仅 env=1 时存在且每个终结点恰好一行。
// PROP-RAW-3: debug 输出逐值经 redactRecursive（fp: 指纹，无原文），
//             单值 ≤65536 字节，超限截断并标 truncated:true。
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { property } from './_harness.js';
import { emit, buildBatchEnvelope } from '../../src/infra/output.js';

function captureStreams(fn) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (chunk) => { stdoutChunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

function debugLines(stderr) {
  return stderr.split('\n').filter((line) => line.includes('"type":"raw_debug"'));
}

// 键池排除 raw/list（植入位固定），rawValue/raw_url 为严格键名匹配的干扰项。
const KEY_POOL = ['alpha', 'beta', 'items', 'info', 'payload', 'rawValue', 'raw_url'];

function genNested(rng, depth) {
  const out = {};
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i += 1) {
    const key = KEY_POOL[Math.floor(rng() * KEY_POOL.length)];
    out[key] = depth > 0 && rng() < 0.4 ? genNested(rng, depth - 1) : `v-${Math.floor(rng() * 1e6)}`;
  }
  return out;
}

// 固定两处植入：根级 raw + 数组元素内 raw（路径可精确断言）。
const debugPayloadGen = (rng) => {
  const data = genNested(rng, 3);
  data.raw = { endpoint_body: `BODY-${Math.floor(rng() * 1e6)}` };
  data.list = [{ raw: { page: Math.floor(rng() * 100) } }];
  return data;
};

describe('raw-debug PBT (PROP-RAW-2/3 — PDD_DEBUG_RAW stderr channel)', () => {
  it('PROP-RAW-2: env flag only adds a stderr JSONL line; stdout is byte-identical', async () => {
    await property('debug-raw-stdout-invariant', debugPayloadGen, (data) => {
      const input = () => ({
        ok: true,
        command: 'raw.debug',
        data: structuredClone(data),
        meta: { correlation_id: 'cid-raw-2' },
      });

      delete process.env.PDD_DEBUG_RAW;
      const off = captureStreams(() => emit(input(), { json: true, noColor: true }));

      process.env.PDD_DEBUG_RAW = '1';
      const on = captureStreams(() => emit(input(), { json: true, noColor: true }));
      delete process.env.PDD_DEBUG_RAW;

      assert.equal(on.stdout, off.stdout, 'stdout must be byte-identical with env on/off');
      assert.equal(debugLines(off.stderr).length, 0, 'no raw_debug line when env is off');

      const lines = debugLines(on.stderr);
      assert.equal(lines.length, 1, 'exactly one raw_debug JSONL line when env is on');
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.type, 'raw_debug');
      assert.equal(parsed.command, 'raw.debug');
      assert.equal(parsed.correlation_id, 'cid-raw-2');
      assert.equal(parsed.raw.length, 2, 'both planted raw subtrees extracted');
      assert.ok(parsed.raw.some((e) => e.path === 'raw'));
      assert.ok(parsed.raw.some((e) => e.path === 'list[0].raw'));
      return true;
    });
  });

  it('PROP-RAW-2-batch: buildBatchEnvelope emits one line with accounts.<slug> prefixed paths', async () => {
    await property('debug-raw-batch-prefix', debugPayloadGen, (data) => {
      process.env.PDD_DEBUG_RAW = '1';
      const captured = captureStreams(() => {
        buildBatchEnvelope('raw.batch', {
          'shop-a': { ok: true, data: structuredClone(data), latency_ms: 1 },
          'shop-b': { ok: false, error: { code: 'E_GENERAL', message: 'x' }, latency_ms: 1 },
        }, { correlation_id: 'cid-batch', exit_code: 7 });
      });
      delete process.env.PDD_DEBUG_RAW;

      assert.equal(captured.stdout, '', 'debug channel never writes stdout');
      const lines = debugLines(captured.stderr);
      assert.equal(lines.length, 1, 'single JSONL line per batch finalization');
      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.command, 'raw.batch');
      assert.equal(parsed.correlation_id, 'cid-batch');
      assert.ok(parsed.raw.length >= 2);
      assert.ok(parsed.raw.every((e) => e.path.startsWith('accounts.shop-a')), 'paths must be account-prefixed');
      assert.ok(parsed.raw.some((e) => e.path === 'accounts.shop-a.raw'));
      assert.ok(parsed.raw.some((e) => e.path === 'accounts.shop-a.list[0].raw'));
      return true;
    });
  });

  it('DAG: shared raw subtree collected once per path', () => {
    const shared = { raw: { token: 'T' } };
    const data = { a: shared, b: shared };
    process.env.PDD_DEBUG_RAW = '1';
    const captured = captureStreams(() => emit(
      { ok: true, command: 'raw.dag', data, meta: { correlation_id: 'cid-dag' } },
      { json: true, noColor: true },
    ));
    delete process.env.PDD_DEBUG_RAW;
    const lines = debugLines(captured.stderr);
    assert.equal(lines.length, 1);
    const paths = JSON.parse(lines[0]).raw.map((e) => e.path).sort();
    assert.deepEqual(paths, ['a.raw', 'b.raw']);
  });

  it('PROP-RAW-3: debug output is redacted and each value is capped at 65536 bytes', async () => {
    const sensitiveGen = (rng) => {
      const tag = Math.floor(rng() * 1e9);
      const sentinels = {
        anti_content: `AC-SECRET-${tag}`,
        cookie: `COOKIE-SECRET-${tag}`,
        mobile: `13800${tag}`,
        authorization: `Bearer-SECRET-${tag}`,
      };
      const data = {
        info: 'plain',
        raw: { anti_content: sentinels.anti_content, cookie: sentinels.cookie },
        list: [{
          raw: {
            authorization: sentinels.authorization,
            mobile: sentinels.mobile,
            blob: 'x'.repeat(70000 + Math.floor(rng() * 4096)),
          },
        }],
      };
      return { sentinels, data };
    };

    await property('debug-raw-redaction-truncation', sensitiveGen, ({ sentinels, data }) => {
      process.env.PDD_DEBUG_RAW = '1';
      const captured = captureStreams(() => emit({
        ok: true, command: 'raw.debug', data, meta: { correlation_id: 'cid-raw-3' },
      }, { json: true, noColor: true }));
      delete process.env.PDD_DEBUG_RAW;

      for (const original of Object.values(sentinels)) {
        assert.ok(!captured.stderr.includes(original), `sentinel must not leak to stderr: ${original}`);
        assert.ok(!captured.stdout.includes(original), 'stripped stdout must not contain raw sentinels');
      }
      assert.ok(captured.stderr.includes('fp:'), 'redaction fingerprints must be present');

      const lines = debugLines(captured.stderr);
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(lines[0]);

      const small = parsed.raw.find((e) => e.path === 'raw');
      assert.ok(small, 'small entry present');
      assert.equal(small.truncated, undefined, 'small entry must not be truncated');
      const smallValue = JSON.parse(small.value);
      assert.ok(String(smallValue.anti_content).startsWith('fp:'));
      assert.ok(String(smallValue.cookie).startsWith('fp:'));

      const big = parsed.raw.find((e) => e.path === 'list[0].raw');
      assert.ok(big, 'oversize entry present');
      assert.equal(big.truncated, true, 'oversize value must be marked truncated');
      assert.ok(typeof big.value === 'string', 'truncated value is the serialized prefix');
      assert.ok(Buffer.byteLength(big.value, 'utf8') <= 65536, 'truncated value capped at 64KiB');
      assert.ok(big.value.includes('fp:'), 'truncated prefix still redacted');
      return true;
    });
  });

  // 双审收口回归（review-cx.md CX#2）：敏感键下循环值不得让 debug 开关改变命令结果
  it('CX#2: cyclic value under a sensitive key — no crash, stdout intact, stderr fingerprinted', () => {
    const cyc = {};
    cyc.self = cyc;
    const data = { raw: { anti_content: cyc }, keep: 1 };
    process.env.PDD_DEBUG_RAW = '1';
    let captured;
    try {
      captured = captureStreams(() => emit(
        { ok: true, command: 'raw.cyclic', data, meta: { correlation_id: 'cid-cyc' } },
        { json: true, noColor: true },
      ));
    } finally {
      delete process.env.PDD_DEBUG_RAW;
    }

    const envelope = JSON.parse(captured.stdout.trim());
    assert.equal(envelope.ok, true, 'debug channel must not flip a successful command');
    assert.equal(envelope.data.keep, 1);
    assert.equal(JSON.stringify(envelope.data).includes('"raw"'), false);

    const lines = debugLines(captured.stderr);
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]).raw.find((e) => e.path === 'raw');
    assert.ok(entry, 'raw entry present on stderr');
    const value = JSON.parse(entry.value);
    assert.ok(String(value.anti_content).startsWith('fp:'), 'cyclic sensitive value fingerprinted');
  });
});
