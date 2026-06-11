// PROP-RAW-4（refactor-arch-review-remediation task 2.3，design §D-1/§D-8）
// 全部 human 渲染路径（默认表格 / 自定义 renderer / renderError / batchRenderer）
// 一律消费 redactRecursive 展示副本 —— 敏感原值不得出现在任何输出流。
// batchRenderer 从闭包读 accountResults（绕过 emit 的 envelope 参数），须在入口单独脱敏。
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { property } from './_harness.js';
import { emit, batchRenderer } from '../../src/infra/output.js';

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

const SENSITIVE_KEYS = ['anti_content', 'cookie', 'mobile', 'authorization', 'phone', 'password'];

// 敏感哨兵分布在顶层 + 嵌套对象 + 数组行三种形态；plain/keep 为必须存活的公开值。
const sensitiveGen = (rng) => {
  const tag = Math.floor(rng() * 1e9);
  const flat = {};
  for (const key of SENSITIVE_KEYS) flat[key] = `${key.toUpperCase()}-SECRET-${tag}`;
  const nestKey = SENSITIVE_KEYS[Math.floor(rng() * SENSITIVE_KEYS.length)];
  const asArray = rng() < 0.5;
  const data = asArray
    ? [{ goods_name: 'A', ...flat }, { goods_name: 'B', ...flat }]
    : { ...flat, info: { [nestKey]: `NEST-SECRET-${tag}`, keep: 'public' }, plain: 'visible' };
  return { sentinels: [...Object.values(flat), `NEST-SECRET-${tag}`], data };
};

function assertNoSentinels(captured, sentinels) {
  for (const sentinel of sentinels) {
    assert.ok(!captured.stdout.includes(sentinel), `sentinel leaked to stdout: ${sentinel}`);
    assert.ok(!captured.stderr.includes(sentinel), `sentinel leaked to stderr: ${sentinel}`);
  }
}

describe('render-redaction PBT (PROP-RAW-4 — human output paths)', () => {
  it('PROP-RAW-4a: default renderTable path outputs no unredacted sensitive value', async () => {
    await property('render-table-redacted', sensitiveGen, ({ sentinels, data }) => {
      const captured = captureStreams(() => emit(
        { ok: true, command: 'render.probe', data, meta: {} },
        { noColor: true, tty: false },
      ));
      assertNoSentinels(captured, sentinels);
      assert.ok(captured.stdout.includes('fp:'), 'redaction fingerprints expected in table output');
      return true;
    });
  });

  it('PROP-RAW-4b: custom renderer receives a redacted display copy', async () => {
    await property('render-custom-redacted', sensitiveGen, ({ sentinels, data }) => {
      let seenEnvelope = null;
      const captured = captureStreams(() => emit(
        { ok: true, command: 'render.probe', data, meta: {} },
        {
          noColor: true,
          tty: false,
          renderer: (env) => {
            seenEnvelope = env;
            return JSON.stringify(env);
          },
        },
      ));
      assertNoSentinels(captured, sentinels);
      const rendererInput = JSON.stringify(seenEnvelope);
      for (const sentinel of sentinels) {
        assert.ok(!rendererInput.includes(sentinel), 'renderer argument must already be redacted');
      }
      assert.ok(rendererInput.includes('fp:'));
      return true;
    });
  });

  it('PROP-RAW-4c: error envelope human path outputs no sensitive detail', async () => {
    await property('render-error-redacted', sensitiveGen, ({ sentinels, data }) => {
      const captured = captureStreams(() => emit(
        {
          ok: false,
          command: 'render.probe',
          data: null,
          error: { code: 'E_BUSINESS', message: 'op failed', hint: 'retry later', detail: { wrapped: data } },
          meta: { exit_code: 6 },
        },
        { noColor: true, tty: false },
      ));
      assertNoSentinels(captured, sentinels);
      assert.ok(captured.stderr.includes('[E_BUSINESS]'), 'error line still rendered');
      return true;
    });
  });

  it('PROP-RAW-4d: batchRenderer redacts closure-provided accountResults at entry', async () => {
    await property('render-batch-redacted', sensitiveGen, ({ sentinels, data }) => {
      const rendered = batchRenderer({
        'shop-a': { ok: true, command: 'render.probe', data, meta: { latency_ms: 1 } },
        'shop-b': { ok: false, command: 'render.probe', error: { code: 'E_GENERAL', message: 'x' }, meta: { latency_ms: 2 } },
      }, { useColor: false });
      for (const sentinel of sentinels) {
        assert.ok(!rendered.includes(sentinel), `sentinel leaked in batch render: ${sentinel}`);
      }
      assert.ok(rendered.includes('fp:'), 'fingerprints expected in batch render');
      assert.ok(rendered.includes('shop-a') && rendered.includes('shop-b'), 'both account sections rendered');
      return true;
    });
  });
});
