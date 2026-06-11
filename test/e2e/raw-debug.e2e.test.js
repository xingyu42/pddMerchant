// task 2.2 e2e 冒烟：PDD_DEBUG_RAW 调试通道的真实进程行为。
// 注：当前全部生产命令在命令层重映射 data，raw 不会到达 envelope 边界
// （边界剥离是纵深防御）——因此干净数据下 env=1 必须零 debug 噪音；
// ON 路径用真实子进程直驱 emit() 验证 stderr JSONL 通道。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPdd, assertOkEnvelope, PROJECT_ROOT } from './_helpers.js';

function findDebugLine(stderr) {
  return (stderr ?? '').split('\n').find((line) => line.includes('"type":"raw_debug"'));
}

function hasRawKey(value) {
  if (Array.isArray(value)) return value.some(hasRawKey);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => k === 'raw' || hasRawKey(v));
  }
  return false;
}

test('e2e: PDD_DEBUG_RAW=1 + raw-free command data → envelope intact, zero debug noise', () => {
  const r = runPdd(['goods', 'list', '--json'], { PDD_DEBUG_RAW: '1' });
  assert.equal(r.status, 0, `expected exit 0, stderr: ${r.stderr}`);
  assertOkEnvelope(r.envelope, 'goods.list');
  assert.equal(hasRawKey(r.envelope.data), false, 'envelope data must be raw-free');
  assert.equal(findDebugLine(r.stderr), undefined, 'clean data must not emit raw_debug');
});

test('e2e: PDD_DEBUG_RAW unset → no raw_debug on stderr', () => {
  const r = runPdd(['goods', 'list', '--json']);
  assert.equal(r.status, 0);
  assertOkEnvelope(r.envelope, 'goods.list');
  assert.equal(findDebugLine(r.stderr), undefined);
});

test('e2e: real subprocess emit() with raw data → redacted raw_debug JSONL on stderr only', () => {
  const outputUrl = pathToFileURL(join(PROJECT_ROOT, 'src', 'infra', 'output.js')).href;
  const script = `import(${JSON.stringify(outputUrl)}).then((m) => {
    m.emit({
      ok: true,
      command: 'raw.subproc',
      data: { raw: { anti_content: 'AC-E2E-SECRET' }, keep: 1 },
      meta: { correlation_id: 'cid-e2e' },
    }, { json: true, noColor: true });
  });`;
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, PDD_DEBUG_RAW: '1' },
  });

  assert.equal(r.status, 0, `subprocess failed: ${r.stderr}`);
  const envelope = JSON.parse(r.stdout.trim());
  assert.equal(hasRawKey(envelope.data), false, 'stdout envelope data must be stripped');
  assert.equal(envelope.data.keep, 1);
  assert.ok(!r.stdout.includes('AC-E2E-SECRET'), 'stdout must not leak raw values');

  const line = findDebugLine(r.stderr);
  assert.ok(line, 'raw_debug line expected on stderr');
  const parsed = JSON.parse(line);
  assert.equal(parsed.type, 'raw_debug');
  assert.equal(parsed.command, 'raw.subproc');
  assert.equal(parsed.correlation_id, 'cid-e2e');
  assert.equal(parsed.raw.length, 1);
  assert.equal(parsed.raw[0].path, 'raw');
  assert.ok(!r.stderr.includes('AC-E2E-SECRET'), 'debug output must be redacted');
  assert.ok(r.stderr.includes('fp:'), 'redaction fingerprint expected');
});
