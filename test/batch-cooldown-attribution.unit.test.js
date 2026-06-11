import { describe, it, beforeEach, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../src/commands/runner/single-lifecycle.js', () => ({
  executeSingle: vi.fn(),
}));
vi.mock('../src/infra/account-registry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listAccounts: vi.fn(),
}));
vi.mock('../src/infra/daemon-launcher.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ensureDaemonRunning: vi.fn(async () => {}),
}));
// 批量 jitter 2-5s 真睡会拖垮测试；只替换 abortableSleep，其余 abort 工具保持原实现
vi.mock('../src/infra/abort.js', async (importOriginal) => ({
  ...(await importOriginal()),
  abortableSleep: vi.fn(async () => {}),
}));

import { withCommand } from '../src/commands/_runner.js';
import { executeSingle } from '../src/commands/runner/single-lifecycle.js';
import { listAccounts } from '../src/infra/account-registry.js';
import { ExitCodes } from '../src/infra/errors.js';

const COOLDOWN_PREFIX = 'cooldown_inherited_from:';

function baseMeta(exitCode) {
  return { v: 1, exit_code: exitCode, latency_ms: 1, xhr_count: 0, warnings: [] };
}

function envelopeFor(name, kind) {
  if (kind === 'success') {
    return { ok: true, command: name, data: { value: 1 }, error: null, meta: baseMeta(ExitCodes.OK) };
  }
  const detail = kind === 'inherited_cooldown'
    ? { endpoint: 'orders.list', cooldown_remaining_ms: 240000, cooldown_triggered: true }
    : { url: 'https://mms.pinduoduo.com', status: 429 };
  return {
    ok: false,
    command: name,
    data: null,
    error: { code: 'E_RATE_LIMIT', message: kind, hint: '', detail },
    meta: baseMeta(ExitCodes.RATE_LIMIT),
  };
}

// runOneAccount 经 _correlationId=`${batchId}:${slug}` 传递账号身份（batchId 为 UUID，无冒号）
function slugOf(opts) {
  return String(opts._correlationId).split(':')[1];
}

function arrangeBatch(scenario) {
  listAccounts.mockResolvedValue(Object.keys(scenario).map((slug) => ({ slug })));
  executeSingle.mockImplementation(async (spec, opts) => envelopeFor(spec.name, scenario[slugOf(opts)]));
  return withCommand({
    name: 'test.cooldown',
    needsAuth: true,
    needsMall: 'none',
    async run() { return null; },
  });
}

const originalAuthStatePath = process.env.PDD_AUTH_STATE_PATH;

describe('executeBatch cooldown attribution wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PDD_AUTH_STATE_PATH;
  });

  afterAll(() => {
    if (originalAuthStatePath !== undefined) {
      process.env.PDD_AUTH_STATE_PATH = originalAuthStatePath;
    }
  });

  it('propagates cooldown_inherited_from:<source> to batch envelope warnings (deduped)', async () => {
    const cmd = arrangeBatch({
      'shop-a': 'self_rate_limited',
      'shop-b': 'inherited_cooldown',
      'shop-c': 'success',
      'shop-d': 'inherited_cooldown',
    });

    const envelope = await cmd({ allAccounts: true, json: true, noColor: true });

    const inherited = envelope.meta.warnings.filter((w) => w.startsWith(COOLDOWN_PREFIX));
    assert.deepEqual(inherited, ['cooldown_inherited_from:shop-a']);
    assert.equal(envelope.meta.exit_code, ExitCodes.PARTIAL);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.data.accounts['shop-b'].error.code, 'E_RATE_LIMIT');
    assert.equal(envelope.data.summary.failed, 3);
  });

  it('emits no attribution when cooldown hit has no in-batch source', async () => {
    const cmd = arrangeBatch({
      'shop-b': 'inherited_cooldown',
      'shop-c': 'success',
    });

    const envelope = await cmd({ allAccounts: true, json: true, noColor: true });

    assert.equal(envelope.meta.warnings.some((w) => w.startsWith(COOLDOWN_PREFIX)), false);
    assert.equal(envelope.meta.exit_code, ExitCodes.PARTIAL);
  });
});
