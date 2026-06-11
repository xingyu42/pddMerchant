// PROP-RAW-1（refactor-arch-review-remediation task 1.3 红灯 → task 2.1 转绿）
// envelope 三条出口路径（buildEnvelope / executeSingle 返回值 / buildBatchEnvelope）
// 的 data 下任意深度不得含键名严格 === 'raw' 的属性（design §D-1）。
// stripRaw 已于 src/infra/output.js 落地，本属性自 task 2.1 起常绿。
// PROP-RAW-0 是常绿哨兵：保证探测管线本身健康。
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { property } from './_harness.js';
import { buildEnvelope, buildBatchEnvelope } from '../../src/infra/output.js';
import { executeSingle } from '../../src/commands/_runner.js';

// 键池刻意排除 normalizeRunResult 的保留键（data/meta/warnings）与 'raw' 本身；
// rawValue / raw_url 是必须存活的干扰项（严格键名匹配的反例）。
const KEY_POOL = ['alpha', 'beta', 'items', 'info', 'list', 'payload', 'rawValue', 'raw_url', 'nested'];

function leaf(rng) {
  const roll = rng();
  if (roll < 0.25) return Math.floor(rng() * 1000);
  if (roll < 0.5) return `s-${Math.floor(rng() * 1e6)}`;
  if (roll < 0.75) return rng() < 0.5;
  return null;
}

function genValue(rng, depth) {
  if (depth <= 0) return leaf(rng);
  const roll = rng();
  if (roll < 0.35) return genObject(rng, depth);
  if (roll < 0.55) return genArray(rng, depth);
  return leaf(rng);
}

function genObject(rng, depth) {
  const out = {};
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i += 1) {
    out[KEY_POOL[Math.floor(rng() * KEY_POOL.length)]] = genValue(rng, depth - 1);
  }
  return out;
}

function genArray(rng, depth) {
  const n = 1 + Math.floor(rng() * 3);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = genValue(rng, depth - 1);
  return out;
}

// 随机游走到某个对象节点植入 raw 键（根节点兜底，保证 ≥1 次植入）。
// 游走候选包含数组元素内的对象 — design §D-1 要求剥离须遍历数组。
function plantRaw(rng, root) {
  let target = root;
  while (rng() < 0.5) {
    const children = [];
    for (const v of Object.values(target)) {
      if (v == null || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        for (const el of v) {
          if (el != null && typeof el === 'object' && !Array.isArray(el)) children.push(el);
        }
      } else {
        children.push(v);
      }
    }
    if (children.length === 0) break;
    target = children[Math.floor(rng() * children.length)];
  }
  target.raw = { anti_content: 'AC-SECRET', endpoint_body: 'PLATFORM-LEAK' };
}

const rawPayloadGen = (rng) => {
  const data = genObject(rng, 3);
  plantRaw(rng, data);
  if (rng() < 0.4) plantRaw(rng, data);
  // 每个样本必含一个数组元素内的 raw — 仅遍历对象不遍历数组的 stripRaw 实现必须被证伪
  data.list = [{ raw: { anti_content: 'AC-ARRAY', endpoint_body: 'ARRAY-LEAK' } }, leaf(rng)];
  data.raw_url = 'https://decoy.example/keep';
  data.rawValue = 'decoy-keep';
  return data;
};

const cleanPayloadGen = (rng) => {
  const data = genObject(rng, 3);
  data.raw_url = 'https://decoy.example/keep';
  data.rawValue = 'decoy-keep';
  return data;
};

function countKeys(value, match) {
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + countKeys(v, match), 0);
  if (value != null && typeof value === 'object') {
    let sum = 0;
    for (const [k, v] of Object.entries(value)) {
      if (match(k)) sum += 1;
      sum += countKeys(v, match);
    }
    return sum;
  }
  return 0;
}
const countRaw = (v) => countKeys(v, (k) => k === 'raw');
const countDecoys = (v) => countKeys(v, (k) => k === 'rawValue' || k === 'raw_url');

async function runFixtureProbe(data) {
  const spec = {
    name: 'raw.probe',
    needsAuth: false,
    needsMall: 'none',
    run: async () => ({ data }),
  };
  return executeSingle(spec, {}, { emitResult: false, skipDaemonStart: true });
}

describe('raw-strip PBT (PROP-RAW-1 — green since task 2.1 stripRaw)', () => {
  it('PROP-RAW-0 sentinel (stays green): raw-free payload round-trips all three envelope paths', async () => {
    const saved = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';
    try {
      await property('raw-free-roundtrip', cleanPayloadGen, async (data) => {
        assert.equal(countRaw(data), 0, 'precondition: generator must not emit raw keys');
        const decoys = countDecoys(data);

        const single = buildEnvelope({ ok: true, command: 'raw.probe', data });
        assert.deepEqual(single.data, data);

        const fromRun = await runFixtureProbe(data);
        assert.equal(fromRun.ok, true, `probe must succeed, got: ${fromRun.error?.code}`);
        assert.deepEqual(fromRun.data, data);

        const batch = buildBatchEnvelope('raw.probe', {
          'shop-a': { ok: true, data, latency_ms: 1 },
        }, { exit_code: 0 });
        assert.deepEqual(batch.data.accounts['shop-a'].data, data);

        assert.equal(countDecoys(single.data), decoys, 'decoy keys must survive');
        return true;
      });
    } finally {
      if (saved !== undefined) process.env.PDD_TEST_ADAPTER = saved;
      else delete process.env.PDD_TEST_ADAPTER;
    }
  });

  it('PROP-RAW-0b sentinel (stays green): raw generator preconditions hold for every sample', async () => {
    await property('raw-generator-preconditions', rawPayloadGen, (data) => {
      // data.list 赋值可能覆盖游走植入的同名子树，故总数下界是 1（数组植入恒在）
      assert.ok(countRaw(data) >= 1, 'every sample must contain at least one raw key');
      assert.ok(Array.isArray(data.list) && countRaw(data.list) >= 1, 'every sample must contain an array-embedded raw key');
      assert.ok(countDecoys(data) >= 2, 'every sample must contain rawValue/raw_url decoys');
      return true;
    });
  });

  it('PROP-RAW-1a: buildEnvelope data contains no raw key at any depth', async () => {
    await property('buildEnvelope-strips-raw', rawPayloadGen, (data) => {
      assert.ok(countRaw(data) >= 1, 'precondition: payload must contain planted raw keys');
      const decoys = countDecoys(data);
      const envelope = buildEnvelope({ ok: true, command: 'raw.probe', data });
      assert.equal(countRaw(envelope.data), 0, 'raw keys must be stripped from envelope.data');
      assert.equal(countDecoys(envelope.data), decoys, 'rawValue/raw_url decoys must survive');
      return true;
    });
  });

  it('PROP-RAW-1b: executeSingle returned envelope data contains no raw key', async () => {
    const saved = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';
    try {
      await property('executeSingle-strips-raw', rawPayloadGen, async (data) => {
        assert.ok(countRaw(data) >= 1, 'precondition: payload must contain planted raw keys');
        const decoys = countDecoys(data);
        const envelope = await runFixtureProbe(data);
        assert.equal(envelope.ok, true, `probe must succeed, got: ${envelope.error?.code}`);
        assert.equal(countRaw(envelope.data), 0, 'raw keys must be stripped from returned envelope.data');
        assert.equal(countDecoys(envelope.data), decoys, 'rawValue/raw_url decoys must survive');
        return true;
      });
    } finally {
      if (saved !== undefined) process.env.PDD_TEST_ADAPTER = saved;
      else delete process.env.PDD_TEST_ADAPTER;
    }
  });

  it('PROP-RAW-1c: buildBatchEnvelope per-account data contains no raw key', async () => {
    await property('buildBatchEnvelope-strips-raw', rawPayloadGen, (data) => {
      assert.ok(countRaw(data) >= 1, 'precondition: payload must contain planted raw keys');
      const decoys = countDecoys(data);
      const envelope = buildBatchEnvelope('raw.probe', {
        'shop-a': { ok: true, data, latency_ms: 1 },
        'shop-b': { ok: false, error: { code: 'E_GENERAL', message: 'x' }, latency_ms: 1 },
      }, { exit_code: 7 });
      assert.equal(countRaw(envelope.data), 0, 'raw keys must be stripped from batch envelope data');
      assert.equal(countDecoys(envelope.data), decoys, 'rawValue/raw_url decoys must survive');
      return true;
    });
  });
});

// 评审修复回归：seen 采用路径栈语义（回溯 delete）——
// DAG 共享引用必须正常展开，仅真环替换为 '[Circular]'。
describe('raw-strip DAG / cycle semantics', () => {
  it('DAG: shared references expand on every path (no false [Circular])', () => {
    const shared = { keep: 1, raw: { secret: 'S' } };
    const data = { a: shared, b: shared, list: [shared] };
    const envelope = buildEnvelope({ ok: true, command: 'raw.dag', data });
    assert.deepEqual(envelope.data, { a: { keep: 1 }, b: { keep: 1 }, list: [{ keep: 1 }] });
  });

  it('true cycle: replaced with [Circular] without hanging', () => {
    const node = { keep: 1 };
    node.self = node;
    const envelope = buildEnvelope({ ok: true, command: 'raw.cycle', data: { node } });
    assert.equal(envelope.data.node.keep, 1);
    assert.equal(envelope.data.node.self, '[Circular]');
  });

  // 评审修复回归：剥离面与 JSON.stringify 输出面一致 ——
  // 类实例的自有可枚举 raw 属性必须被剥离；带 toJSON 的内建（Date）透传。
  it('non-plain object with enumerable raw key is stripped on the JSON surface', () => {
    class Carrier {
      constructor() {
        this.keep = 1;
        this.raw = { secret: 'S' };
      }
    }
    const envelope = buildEnvelope({ ok: true, command: 'raw.cls', data: { box: new Carrier() } });
    assert.deepEqual(envelope.data, { box: { keep: 1 } });
    assert.equal(JSON.stringify(envelope.data).includes('"raw"'), false);
  });

  it('Date passes through unchanged (toJSON handles serialization)', () => {
    const at = new Date(0);
    const envelope = buildEnvelope({ ok: true, command: 'raw.date', data: { at, keep: 2 } });
    assert.equal(envelope.data.at, at);
    assert.equal(envelope.data.keep, 2);
  });
});
