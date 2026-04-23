import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  scoreInventoryHealth,
  normalizeGoodsName,
} from '../../src/services/diagnose/inventory-health.js';
import {
  collectOrdersForStaleAnalysis,
  STALE_PAGE_SIZE,
  STALE_MAX_PAGES,
} from '../../src/services/diagnose/orders-collector.js';
import { property, gen } from './_harness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const BIN = join(PROJECT_ROOT, 'bin', 'pdd.js');
const FIXTURE_DIR = join(PROJECT_ROOT, 'test', 'fixtures');

// PBT 6.12: orders_scan_cap_and_truncation.
// Invariants (per src/services/diagnose/orders-collector.js):
//   pageCalls = ceil(N / pageSize), but capped at STALE_MAX_PAGES
//   truncated ↔ pageCalls === STALE_MAX_PAGES AND last page was full
//   With pager producing exactly N orders spread across pages of STALE_PAGE_SIZE:
//     truncated ↔ N >= STALE_MAX_PAGES * STALE_PAGE_SIZE
test('pbt: orders_scan_cap_and_truncation', async () => {
  await property(
    'orders_scan_cap',
    gen.int(0, STALE_PAGE_SIZE * (STALE_MAX_PAGES + 2)), // 0..600
    async (totalOrders) => {
      let callCount = 0;
      const pager = async (_page, params) => {
        callCount += 1;
        const pageNum = params.page;
        const startIndex = (pageNum - 1) * params.size;
        const remaining = Math.max(0, totalOrders - startIndex);
        const batch = Array.from(
          { length: Math.min(remaining, params.size) },
          (_, i) => ({ goods_name: `G${startIndex + i}`, goods_quantity: 1 }),
        );
        return { total: totalOrders, orders: batch, raw: {} };
      };
      const r = await collectOrdersForStaleAnalysis(null, {}, {
        listOrders: pager,
        delayMs: 0,
      });

      if (callCount > STALE_MAX_PAGES) return false;
      if (r.orders.length !== Math.min(totalOrders, STALE_PAGE_SIZE * STALE_MAX_PAGES)) return false;
      const expectedTruncated = totalOrders >= STALE_PAGE_SIZE * STALE_MAX_PAGES;
      if (r.truncated !== expectedTruncated) return false;
      if (r.ratelimited !== false) return false;
      return true;
    },
    { runs: 60 },
  );
});

// PBT 6.13: stale_detection_soundness_under_cap.
// `truncated: true` → stale_count strictly null; stock-level scoring still runs.
test('pbt: stale_detection_soundness_under_cap', async () => {
  await property(
    'stale_soundness',
    gen.record({
      goodsCount: gen.int(1, 20),
      qty: gen.int(0, 200),
    }),
    ({ goodsCount, qty }, { rng }) => {
      const goods = Array.from({ length: goodsCount }, (_, i) => ({
        goods_id: i + 1,
        goods_name: `X${i}`,
        quantity: Math.floor(rng() * qty),
      }));
      const r = scoreInventoryHealth({
        goods,
        orders30d: [],
        truncated: true,
      });
      return r.detail.stale_count === null
        && r.detail.stale_sample === null
        && r.detail.truncated === true
        && typeof r.detail.total === 'number'
        && typeof r.detail.out_of_stock === 'number';
    },
    { runs: 50 },
  );
});

// PBT 6.14: goods_name_normalization_idempotence.
// Property: normalize(normalize(x)) === normalize(x) for arbitrary strings.
test('pbt: goods_name_normalization_idempotence', async () => {
  // Character pool mixing ascii, cjk, fullwidth, whitespace, symbols.
  const pool = 'aA0  ĀﾊＡＢＣABC中商品測試\t\n 〜・「」';

  const stringWithWs = (rng) => {
    const len = Math.floor(rng() * 20);
    let s = '';
    if (rng() < 0.5) s += ' '.repeat(Math.floor(rng() * 3)); // leading ws
    for (let i = 0; i < len; i += 1) s += pool[Math.floor(rng() * pool.length)];
    if (rng() < 0.5) s += ' '.repeat(Math.floor(rng() * 3)); // trailing ws
    return s;
  };

  await property(
    'normalize_idempotent',
    stringWithWs,
    (raw) => {
      const once = normalizeGoodsName(raw);
      const twice = normalizeGoodsName(once);
      return once === twice;
    },
    { runs: 200 },
  );

  // Specific boundary cases.
  assert.equal(normalizeGoodsName(null), '');
  assert.equal(normalizeGoodsName(undefined), '');
  assert.equal(normalizeGoodsName('   '), '');
  assert.equal(normalizeGoodsName('ＡＢＣ'), 'ABC');
  assert.equal(normalizeGoodsName('  冬季羽绒服  '), '冬季羽绒服');
});

// PBT 6.15: envelope_schema_stability.
// Run the V0.1 runnable commands under MOCK_ENV and assert every stdout
// produces a single-line JSON envelope matching the frozen schema.
// The `promo ddk` command was removed in V0.2 (see openspec/changes/archive/
// *-remove-promo-ddk). `init`, `login`, `doctor` require a real browser /
// interactive input so they are excluded from PBT and covered by real-call
// regression in Section 7.

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
    latency_ms: z.number(),
    xhr_count: z.number(),
    warnings: z.array(z.string()),
  }).passthrough(),
});

const ERROR_RATE_LIMIT_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'error-rate-limit');
const ERROR_NOT_FOUND_DIR = join(PROJECT_ROOT, 'test', 'fixtures', 'error-not-found');

// Arg sets chosen to exercise both success and canonical failure envelopes.
const COMMANDS = [
  { name: 'shops.list', args: ['shops', 'list', '--json'] },
  { name: 'shops.current', args: ['shops', 'current', '--json'] },
  { name: 'orders.list', args: ['orders', 'list', '--json', '--size', '3'] },
  { name: 'orders.detail', args: ['orders', 'detail', '--json', '--sn', '240101MOCK001'] },
  { name: 'orders.stats', args: ['orders', 'stats', '--json'] },
  { name: 'goods.list', args: ['goods', 'list', '--json', '--size', '3'] },
  { name: 'goods.stock', args: ['goods', 'stock', '--json', '--threshold', '10'] },
  { name: 'promo.search', args: ['promo', 'search', '--json'] },
  { name: 'promo.scene', args: ['promo', 'scene', '--json'] },
  { name: 'diagnose.shop', args: ['diagnose', 'shop', '--json'] },
  { name: 'diagnose.orders', args: ['diagnose', 'orders', '--json'] },
  { name: 'diagnose.inventory', args: ['diagnose', 'inventory', '--json'] },
  { name: 'diagnose.promo', args: ['diagnose', 'promo', '--json'] },
  { name: 'diagnose.funnel', args: ['diagnose', 'funnel', '--json'] },
  // Failure envelopes must also conform to schema.
  {
    name: 'orders.detail.not_found',
    args: ['orders', 'detail', '--json', '--sn', 'MISSING'],
    fixtureDir: ERROR_NOT_FOUND_DIR,
    expectOk: false,
  },
  {
    name: 'orders.detail.rate_limit',
    args: ['orders', 'detail', '--json', '--sn', 'ANY'],
    fixtureDir: ERROR_RATE_LIMIT_DIR,
    expectOk: false,
  },
];

function runCmd(cmd) {
  const env = {
    ...process.env,
    PDD_TEST_ADAPTER: 'fixture',
    PDD_TEST_FIXTURE_DIR: cmd.fixtureDir ?? FIXTURE_DIR,
    NO_COLOR: '1',
  };
  const result = spawnSync(process.execPath, [BIN, ...cmd.args], {
    encoding: 'utf8',
    timeout: 15_000,
    env,
  });
  const raw = (result.stdout ?? '').trim();
  if (raw.length === 0) return { envelope: null, stdout: raw, stderr: result.stderr };
  const lastLine = raw.split('\n').pop();
  try {
    return { envelope: JSON.parse(lastLine), stdout: raw, stderr: result.stderr };
  } catch (err) {
    return { envelope: null, parseError: err.message, stdout: raw, stderr: result.stderr };
  }
}

test('pbt: envelope_schema_stability across runnable commands', async () => {
  // Each command is sampled at least once; total executions bounded by COMMANDS.length.
  await property(
    'envelope_schema',
    gen.oneOf(COMMANDS),
    (cmd) => {
      const { envelope, stdout, stderr, parseError } = runCmd(cmd);
      if (envelope == null) {
        throw new Error(
          `command=${cmd.name} produced no envelope (parseError=${parseError ?? 'n/a'})\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }
      const parsed = EnvelopeSchema.safeParse(envelope);
      if (!parsed.success) {
        throw new Error(
          `command=${cmd.name} envelope schema mismatch: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      if (cmd.expectOk === false && envelope.ok !== false) return false;
      return true;
    },
    { runs: COMMANDS.length * 2 },
  );
});

// Deterministic sweep: every command runs at least once regardless of seed.
test('envelope schema: every COMMANDS entry produces a schema-valid envelope', () => {
  for (const cmd of COMMANDS) {
    const { envelope, stdout, stderr, parseError } = runCmd(cmd);
    assert.ok(envelope, `${cmd.name}: no envelope (parseError=${parseError ?? 'n/a'})\nstdout=${stdout}\nstderr=${stderr}`);
    const parsed = EnvelopeSchema.safeParse(envelope);
    assert.ok(parsed.success, `${cmd.name}: ${JSON.stringify(parsed.error?.issues)}`);
    assert.equal(envelope.command, cmd.name.replace(/\.(not_found|rate_limit)$/, ''));
  }
});
