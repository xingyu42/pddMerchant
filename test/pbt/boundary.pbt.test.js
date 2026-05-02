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
import { analyzePromoRoi } from '../../src/services/promo-roi.js';
import { segmentGoods } from '../../src/services/goods-segmentation.js';
import { resolveCompareWindows, compareShopDiagnosis } from '../../src/services/diagnose/trend-compare.js';
import { generateActionPlan } from '../../src/services/action-plan.js';
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
  { name: 'promo.roi', args: ['promo', 'roi', '--json'] },
  { name: 'goods.segment', args: ['goods', 'segment', '--json', '--no-promo'] },
  { name: 'action.plan', args: ['action', 'plan', '--json', '--no-promo', '--no-segment'] },
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

// PBT: ROI arithmetic invariant
// spend > 0 → roi === round(gmv / spend, 2); spend === 0 → roi === null
test('pbt: promo_roi_arithmetic_invariant', async () => {
  await property(
    'roi_arithmetic',
    gen.record({
      spend: gen.int(0, 10000),
      gmv: gen.int(0, 50000),
    }),
    ({ spend, gmv }) => {
      const input = {
        entities: [{ planId: 1, adId: 1, impression: 100, click: 5, gmv, spend }],
        totals: {},
      };
      const r = analyzePromoRoi(input);
      const row = r.rows[0];
      if (spend === 0) {
        return row.roi === null && row.status === 'no_spend';
      }
      const expected = Number((gmv / spend).toFixed(2));
      return row.roi === expected;
    },
    { runs: 200 },
  );
});

// PBT: promo-roi score clamping — all summary values are non-negative
test('pbt: promo_roi_summary_non_negative', async () => {
  const entityGen = gen.record({
    spend: gen.int(0, 5000),
    gmv: gen.int(0, 20000),
    impression: gen.int(0, 50000),
    click: gen.int(0, 1000),
    isDeleted: gen.bool(),
  });

  await property(
    'roi_summary_non_negative',
    gen.arrayOf(entityGen, { minLen: 0, maxLen: 8 }),
    (entities) => {
      const input = {
        entities: entities.map((e, i) => ({ planId: i, adId: i, ...e })),
        totals: {},
      };
      const r = analyzePromoRoi(input);
      const s = r.summary;
      return s.total_rows >= 0
        && s.waste_count >= 0
        && s.waste_spend >= 0
        && s.scale_count >= 0
        && s.optimize_count >= 0
        && s.total_spend >= 0
        && s.total_gmv >= 0
        && (s.overall_roi === null || s.overall_roi >= 0);
    },
    { runs: 100 },
  );
});

// PBT: tier mutual exclusivity — every goods item in exactly one tier
test('pbt: segmentation_tier_mutual_exclusivity', async () => {
  const goodsGen = gen.record({
    quantity: gen.int(0, 500),
    sold: gen.int(0, 100),
  });

  await property(
    'tier_mutual_exclusivity',
    gen.arrayOf(goodsGen, { minLen: 1, maxLen: 15 }),
    (entries) => {
      const goods = entries.map((e, i) => ({
        goods_id: i + 1,
        goods_name: `G${i}`,
        quantity: e.quantity,
      }));
      const orders = entries
        .filter((e) => e.sold > 0)
        .map((e, i) => ({
          goods_id: i + 1,
          goods_name: `G${i}`,
          goods_quantity: e.sold,
        }));
      const r = segmentGoods({ goods, orders30d: orders });
      const tierCounts = { A: 0, B: 0, C: 0, D: 0 };
      for (const item of r.items) {
        if (!['A', 'B', 'C', 'D'].includes(item.tier)) return false;
        tierCounts[item.tier] += 1;
      }
      const total = tierCounts.A + tierCounts.B + tierCounts.C + tierCounts.D;
      return total === r.items.length
        && r.tiers.A.count === tierCounts.A
        && r.tiers.B.count === tierCounts.B
        && r.tiers.C.count === tierCounts.C
        && r.tiers.D.count === tierCounts.D;
    },
    { runs: 100 },
  );
});

// PBT: composite_score clamping — 0-100 integer
test('pbt: segmentation_composite_score_clamping', async () => {
  const goodsGen = gen.record({
    quantity: gen.int(0, 1000),
    sold: gen.int(0, 200),
  });

  await property(
    'composite_clamping',
    gen.arrayOf(goodsGen, { minLen: 1, maxLen: 10 }),
    (entries) => {
      const goods = entries.map((e, i) => ({
        goods_id: i + 1,
        goods_name: `G${i}`,
        quantity: e.quantity,
      }));
      const orders = entries.map((e, i) => ({
        goods_id: i + 1,
        goods_name: `G${i}`,
        goods_quantity: e.sold,
      }));
      const r = segmentGoods({ goods, orders30d: orders });
      return r.items.every((item) =>
        Number.isInteger(item.composite_score)
        && item.composite_score >= 0
        && item.composite_score <= 100,
      );
    },
    { runs: 100 },
  );
});

// PBT: delta arithmetic invariant — delta === current - previous
test('pbt: trend_compare_delta_arithmetic', async () => {
  const scoreGen = gen.record({
    curScore: gen.int(0, 100),
    prevScore: gen.int(0, 100),
    curOrders: gen.int(0, 100),
    prevOrders: gen.int(0, 100),
  });

  await property(
    'delta_arithmetic',
    scoreGen,
    ({ curScore, prevScore, curOrders, prevOrders }) => {
      const current = { score: curScore, dimensions: { orders: { score: curOrders } } };
      const previous = { score: prevScore, dimensions: { orders: { score: prevOrders } } };
      const r = compareShopDiagnosis({ current, previous });
      if (r.score_delta !== curScore - prevScore) return false;
      if (r.dimensions.orders.delta !== curOrders - prevOrders) return false;
      return true;
    },
    { runs: 200 },
  );
});

// PBT: zero previous produces null delta_pct
test('pbt: trend_compare_zero_previous_null_pct', async () => {
  await property(
    'zero_prev_null_pct',
    gen.int(1, 100),
    (curScore) => {
      const current = { score: curScore, dimensions: { orders: { score: curScore } } };
      const previous = { score: 0, dimensions: { orders: { score: 0 } } };
      const r = compareShopDiagnosis({ current, previous });
      return r.score_delta_pct === null && r.dimensions.orders.delta_pct === null;
    },
    { runs: 50 },
  );
});

// PBT: action ordering invariant — actions sorted by priority_score descending
test('pbt: action_plan_ordering_invariant', async () => {
  const statusGen = gen.oneOf(['critical_waste', 'waste', 'scale', 'optimize', 'no_spend']);
  const planGen = gen.record({
    status: statusGen,
    spend: gen.int(0, 10000),
    gmv: gen.int(0, 50000),
    roi: gen.float(0, 20),
  });

  await property(
    'action_ordering',
    gen.arrayOf(planGen, { minLen: 0, maxLen: 10 }),
    (plans) => {
      const promoRoi = {
        rows: plans.map((p, i) => ({
          plan_id: i,
          ad_name: `Plan ${i}`,
          ...p,
        })),
      };
      const r = generateActionPlan({ promoRoi });
      for (let i = 1; i < r.actions.length; i += 1) {
        if (r.actions[i - 1].priority_score < r.actions[i].priority_score) return false;
      }
      return true;
    },
    { runs: 100 },
  );
});

// PBT: no duplicates — no two actions share target_type + target_id + action
test('pbt: action_plan_no_duplicates', async () => {
  const statusGen = gen.oneOf(['critical_waste', 'waste', 'scale']);
  const planGen = gen.record({
    status: statusGen,
    spend: gen.int(100, 5000),
    gmv: gen.int(0, 20000),
  });

  await property(
    'no_duplicates',
    gen.arrayOf(planGen, { minLen: 0, maxLen: 8 }),
    (plans) => {
      const promoRoi = {
        rows: plans.map((p, i) => ({
          plan_id: i,
          ad_name: `Plan ${i}`,
          roi: p.gmv > 0 && p.spend > 0 ? p.gmv / p.spend : 0,
          ...p,
        })),
      };
      const r = generateActionPlan({ promoRoi });
      const keys = r.actions.map((a) => `${a.target_type}:${a.target_id}:${a.action}`);
      return new Set(keys).size === keys.length;
    },
    { runs: 100 },
  );
});

// PBT: count summation — urgent + important + suggestion === total
test('pbt: action_plan_count_summation', async () => {
  const statusGen = gen.oneOf(['critical_waste', 'waste', 'scale', 'optimize']);

  await property(
    'count_sum',
    gen.arrayOf(gen.record({ status: statusGen, spend: gen.int(0, 5000), gmv: gen.int(0, 20000) }), { minLen: 0, maxLen: 6 }),
    (plans) => {
      const promoRoi = {
        rows: plans.map((p, i) => ({ plan_id: i, ad_name: `P${i}`, roi: 1, ...p })),
      };
      const r = generateActionPlan({ promoRoi });
      return r.summary.urgent + r.summary.important + r.summary.suggestion === r.summary.total;
    },
    { runs: 100 },
  );
});
