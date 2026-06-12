import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { gen, property } from './_harness.js';
import { applyCooldownAttribution } from '../../src/commands/runner/batch-executor.js';
import { getSharedClient, _resetSharedClient } from '../../src/adapter/rate-limiter-singleton.js';
import { batchExitCode, ExitCodes } from '../../src/infra/errors.js';

const COOLDOWN_PREFIX = 'cooldown_inherited_from:';
const EVENT_KINDS = ['success', 'self_rate_limited', 'inherited_cooldown'];
const MATRIX_KINDS = [...EVENT_KINDS, 'auth_failure', 'network_failure'];

function slugFrom(index) {
  return `shop-${index}`;
}

function priorWarningsGen(rng) {
  const values = gen.arrayOf(gen.string({ minLen: 1, maxLen: 8 }), { minLen: 0, maxLen: 3 })(rng);
  return values.map((warning, index) => `prior_${index}_${warning}`);
}

// 事件流：slug 取小池（0-4）制造重复账号触发，覆盖 last-wins 与 source===self 分支
function eventSequenceGen(rng) {
  const length = gen.int(1, 24)(rng);
  const events = [];
  for (let i = 0; i < length; i += 1) {
    events.push({
      slug: slugFrom(gen.int(0, 4)(rng)),
      kind: gen.oneOf(EVENT_KINDS)(rng),
    });
  }
  return events;
}

// 成功/失败混合矩阵：slug 唯一（与 accountResults 键语义一致）
function matrixGen(rng) {
  const length = gen.int(1, 16)(rng);
  const entries = [];
  for (let i = 0; i < length; i += 1) {
    entries.push({
      slug: slugFrom(i),
      kind: gen.oneOf(MATRIX_KINDS)(rng),
      warnings: priorWarningsGen(rng),
    });
  }
  return entries;
}

function failureResult(code, exitCode, warnings, index, detail) {
  return {
    ok: false,
    data: null,
    error: { code, message: code, ...(detail ? { detail } : {}) },
    exit_code: exitCode,
    latency_ms: index,
    meta: { warnings: [...warnings], latency_ms: index },
  };
}

function makeResult(kind, warnings = [], index = 0) {
  if (kind === 'success') {
    return {
      ok: true,
      data: { index, nested: { marker: `data-${index}` } },
      error: null,
      exit_code: ExitCodes.OK,
      latency_ms: index,
      meta: { warnings: [...warnings], latency_ms: index },
    };
  }
  if (kind === 'auth_failure') {
    return failureResult('E_AUTH_EXPIRED', ExitCodes.AUTH, warnings, index);
  }
  if (kind === 'network_failure') {
    return failureResult('E_NETWORK', ExitCodes.NETWORK, warnings, index);
  }
  // 自身被限流的 detail 形状取自 endpoint-client 429 路径；cooldown_triggered:false 变体
  // 覆盖 "非真即自身" 的判定鲁棒性
  const detail = kind === 'inherited_cooldown'
    ? { endpoint: 'orders.list', cooldown_remaining_ms: 300000, cooldown_triggered: true }
    : (index % 2 === 0 ? { status: 429, cooldown_triggered: false } : { status: 429 });
  return failureResult('E_RATE_LIMIT', ExitCodes.RATE_LIMIT, warnings, index, detail);
}

describe('cooldown attribution PBT', () => {
  // 本属性事件 detail 缺 endpoint（旧错误形状）→ 全部退化记入 '*'：钉死退化路径的 last-wins 语义
  it('PROP-COOL-1: inherited warning always names the most recent self-rate-limited slug (last-wins, fallback key)', async () => {
    await property('cooldown-attribution-accuracy', eventSequenceGen, (events) => {
      let expectedSource = null;
      let sources = {};
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        const result = makeResult(event.kind, [], i);
        const sourceBefore = expectedSource;

        sources = applyCooldownAttribution(result, event.slug, sources);
        if (event.kind === 'self_rate_limited') expectedSource = event.slug;

        assert.equal(sources['*'] ?? null, expectedSource);
        const inherited = result.meta.warnings.filter((w) => w.startsWith(COOLDOWN_PREFIX));
        const shouldInherit = event.kind === 'inherited_cooldown'
          && Boolean(sourceBefore)
          && sourceBefore !== event.slug;
        assert.deepEqual(inherited, shouldInherit ? [`${COOLDOWN_PREFIX}${sourceBefore}`] : []);
      }
      return true;
    });
  });

  it('PROP-COOL-2: attribution is additive-only — batchExitCode, data and prior warnings unchanged', async () => {
    await property('cooldown-attribution-additive-only', matrixGen, (entries) => {
      const results = {};
      const dataRefs = {};
      for (let i = 0; i < entries.length; i += 1) {
        const result = makeResult(entries[i].kind, entries[i].warnings, i);
        results[entries[i].slug] = result;
        dataRefs[entries[i].slug] = result.data;
      }
      const baseline = structuredClone(results);

      let sources = {};
      for (const entry of entries) {
        sources = applyCooldownAttribution(results[entry.slug], entry.slug, sources);
      }

      assert.equal(batchExitCode(results), batchExitCode(baseline));
      for (const entry of entries) {
        const after = results[entry.slug];
        const before = baseline[entry.slug];
        assert.equal(after.ok, before.ok);
        assert.equal(after.exit_code, before.exit_code);
        assert.deepEqual(after.error, before.error);
        assert.strictEqual(after.data, dataRefs[entry.slug]);
        assert.deepEqual(after.meta.warnings.slice(0, entry.warnings.length), entry.warnings);
        assert.ok(after.meta.warnings.length >= before.meta.warnings.length);
      }
      return true;
    });
  });

  // PROP-COOL-4（R3.1，codex 终审建议转属性）：归因按 endpoint 隔离——
  // 继承警告只归因同 endpoint 的最近源，跨 endpoint 不串扰；带 endpoint 的事件不得触碰退化键 '*'。
  it('PROP-COOL-4: attribution is endpoint-scoped — no cross-endpoint blame', async () => {
    const ENDPOINTS = ['ep.alpha', 'ep.beta'];
    const endpointEventSequenceGen = (rng) => {
      const length = gen.int(1, 24)(rng);
      const events = [];
      for (let i = 0; i < length; i += 1) {
        events.push({
          slug: slugFrom(gen.int(0, 4)(rng)),
          kind: gen.oneOf(EVENT_KINDS)(rng),
          endpoint: gen.oneOf(ENDPOINTS)(rng),
        });
      }
      return events;
    };
    const makeEndpointResult = (kind, endpoint, index) => {
      if (kind === 'success') return makeResult('success', [], index);
      const detail = kind === 'inherited_cooldown'
        ? { endpoint, cooldown_remaining_ms: 300000, cooldown_triggered: true }
        : { endpoint, status: 429 };
      return failureResult('E_RATE_LIMIT', ExitCodes.RATE_LIMIT, [], index, detail);
    };

    await property('cooldown-attribution-endpoint-scope', endpointEventSequenceGen, (events) => {
      const expected = {};
      let sources = {};
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        const result = makeEndpointResult(event.kind, event.endpoint, i);
        const sourceBefore = expected[event.endpoint] ?? null;

        sources = applyCooldownAttribution(result, event.slug, sources);
        if (event.kind === 'self_rate_limited') expected[event.endpoint] = event.slug;

        assert.equal(sources[event.endpoint] ?? null, expected[event.endpoint] ?? null);
        assert.equal(sources['*'] ?? null, null, 'endpoint-carrying events must never touch the fallback key');

        const inherited = (result.meta?.warnings ?? []).filter((w) => w.startsWith(COOLDOWN_PREFIX));
        const shouldInherit = event.kind === 'inherited_cooldown'
          && Boolean(sourceBefore)
          && sourceBefore !== event.slug;
        assert.deepEqual(inherited, shouldInherit ? [`${COOLDOWN_PREFIX}${sourceBefore}`] : []);
      }
      return true;
    });
  });

  it('PROP-COOL-3: one process-global client/limiter; cooldown state shared across getSharedClient calls', async () => {
    await property('cooldown-singleton-client', gen.int(1, 12), (accountCount) => {
      _resetSharedClient();
      try {
        const clients = new Set();
        const limiters = new Set();
        for (let i = 0; i < accountCount; i += 1) {
          const client = getSharedClient();
          clients.add(client);
          limiters.add(client._limiter);
        }
        assert.equal(clients.size, 1);
        assert.equal(limiters.size, 1);

        const client = getSharedClient();
        const endpointName = `pbt.cooldown.singleton.${accountCount}`;
        const threshold = client._cooldownState.threshold;
        for (let i = 0; i < threshold; i += 1) client._recordRateLimitFailure(endpointName);
        assert.ok(getSharedClient()._cooldownRemainingMs(endpointName) > 0);
        return true;
      } finally {
        _resetSharedClient();
      }
    });
  });
});
