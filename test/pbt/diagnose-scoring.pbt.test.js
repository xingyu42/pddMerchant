import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreFunnelHealth,
  scoreInventoryHealth,
} from '../../src/services/diagnose/index.js';
import { property, gen, shuffle, mulberry32 } from './_harness.js';

// PBT 6.8: funnel_order_invariants.
// Structural invariants:
//  (1) fulfillment_rate = (total - refund_count) / total ∈ [0, 1] when total > 0
//  (2) status monotonicity: as refund_rate crosses thresholds, status downgrades
//      refund ≤ 0.05 → green; 0.05 < refund ≤ 0.15 → yellow; > 0.15 → red
//  (3) total === 0 → partial
test('pbt: funnel_order_invariants', async () => {
  await property(
    'funnel_invariants',
    gen.record({
      total: gen.int(0, 10000),
      refundRate: gen.float(0, 1),
    }),
    (s) => {
      const refundCount = Math.min(s.total, Math.floor(s.total * s.refundRate));
      const actualRefundRate = s.total > 0 ? refundCount / s.total : 0;
      const r = scoreFunnelHealth({
        orderStats: {
          total: s.total,
          refund_count: refundCount,
          refund_rate: actualRefundRate,
        },
      });

      if (s.total === 0) {
        return r.score === null && r.status === 'partial';
      }

      const fulfillment = r.detail.fulfillment_rate;
      if (!(fulfillment >= 0 && fulfillment <= 1)) return false;

      const eps = 1e-9;
      if (actualRefundRate > 0.15 + eps) {
        if (r.status !== 'red') return false;
        if (r.score > 40) return false;
      } else if (actualRefundRate > 0.05 + eps) {
        if (r.status !== 'yellow') return false;
        if (r.score !== 70) return false;
      } else {
        if (r.status !== 'green') return false;
        if (r.score !== 100) return false;
      }
      return true;
    },
    { runs: 200 },
  );
});

// PBT 6.8b: refund_rate monotonicity — as refund_rate ascends, score non-increases.
test('pbt: funnel score non-increasing in refund_rate', async () => {
  await property(
    'funnel_score_monotone',
    gen.record({
      total: gen.int(10, 5000),
      rateA: gen.float(0, 0.5),
      rateB: gen.float(0, 0.5),
    }),
    (s) => {
      const [lo, hi] = s.rateA <= s.rateB ? [s.rateA, s.rateB] : [s.rateB, s.rateA];
      const loRes = scoreFunnelHealth({
        orderStats: { total: s.total, refund_count: Math.floor(s.total * lo), refund_rate: lo },
      });
      const hiRes = scoreFunnelHealth({
        orderStats: { total: s.total, refund_count: Math.floor(s.total * hi), refund_rate: hi },
      });
      return hiRes.score <= loRes.score;
    },
    { runs: 100 },
  );
});

// --- Inventory PBT helpers ---

const goodsIdStrategyGen = gen.oneOf(['both', 'orders_only', 'goods_only', 'neither']);

function makeGoods(rng, strategy) {
  const count = Math.floor(rng() * 10) + 3; // 3..12
  const goods = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i += 1) {
    let name;
    do {
      name = 'G' + Math.floor(rng() * 1000);
    } while (usedNames.has(name));
    usedNames.add(name);
    const hasId = strategy === 'both' || strategy === 'goods_only';
    goods.push({
      goods_id: hasId ? i + 100 : null,
      goods_name: name,
      quantity: Math.floor(rng() * 100) + 1,
    });
  }
  return goods;
}

function makeOrders(rng, goods, strategy) {
  const orderCount = Math.floor(rng() * 8) + 1; // 1..8
  const orders = [];
  const hasId = strategy === 'both' || strategy === 'orders_only';
  // Only sell the first HALF of the goods; the rest should become stale.
  const sellableCount = Math.max(1, Math.floor(goods.length / 2));
  const sellable = goods.slice(0, sellableCount);
  for (let i = 0; i < orderCount; i += 1) {
    const pick = sellable[Math.floor(rng() * sellable.length)];
    orders.push({
      goods_id: hasId ? pick.goods_id ?? (i + 500) : null,
      goods_name: pick.goods_name,
      goods_quantity: Math.floor(rng() * 3) + 1,
    });
  }
  return { orders, sellable };
}

// PBT 6.9: inventory_stale_permutation_invariance — shuffling orders must not change
// stale_count / stale_sample sorted-by-name / ambiguous_groups / matched_by.
test('pbt: inventory_stale_permutation_invariance', async () => {
  await property(
    'stale_permutation_invariance',
    gen.record({
      strategy: goodsIdStrategyGen,
      shuffleSeed: gen.int(1, 1_000_000),
    }),
    ({ strategy, shuffleSeed }, { rng }) => {
      const goods = makeGoods(rng, strategy);
      const { orders } = makeOrders(rng, goods, strategy);
      const baseline = scoreInventoryHealth({ goods, orders30d: orders });

      const shuffleRng = mulberry32(shuffleSeed);
      const shuffled = shuffle(shuffleRng, orders);
      const reshuffled = shuffle(shuffleRng, goods);
      const after = scoreInventoryHealth({ goods: reshuffled, orders30d: shuffled });

      if (baseline.detail.stale_count !== after.detail.stale_count) return false;
      if (baseline.detail.matched_by !== after.detail.matched_by) return false;
      if (baseline.detail.ambiguous_groups.length !== after.detail.ambiguous_groups.length) return false;

      const sortByName = (arr) => arr
        .map((x) => x.goods_name)
        .sort();
      const baseSample = sortByName(baseline.detail.stale_sample ?? []);
      const afterSample = sortByName(after.detail.stale_sample ?? []);
      if (baseSample.length !== afterSample.length) return false;
      for (let i = 0; i < baseSample.length; i += 1) {
        if (baseSample[i] !== afterSample[i]) return false;
      }
      return true;
    },
    { runs: 60 },
  );
});

// PBT 6.10: inventory_duplicate_name_policy — on goods_name path, inserting a
// duplicate-name SKU marks that bucket ambiguous without changing the stale
// verdict for other SKUs.
test('pbt: inventory_duplicate_name_policy (goods_name path)', async () => {
  await property(
    'duplicate_name_policy',
    gen.record({
      // force goods_name path by having NO ids on either side
      baseCount: gen.int(3, 8),
      ratio: gen.float(0.1, 0.5), // sold ratio
    }),
    ({ baseCount, ratio }, { rng }) => {
      const baseGoods = Array.from({ length: baseCount }, (_, i) => ({
        goods_name: `X${i}`,
        quantity: Math.floor(rng() * 50) + 1,
      }));
      const sellableCount = Math.max(1, Math.floor(baseCount * ratio));
      const baseOrders = Array.from({ length: sellableCount * 2 }, () => ({
        goods_name: baseGoods[Math.floor(rng() * sellableCount)].goods_name,
        goods_quantity: 1,
      }));

      // Pick a name that is NOT sold (so it's stale in baseline).
      const staleName = baseGoods[baseCount - 1].goods_name;

      const baseline = scoreInventoryHealth({ goods: baseGoods, orders30d: baseOrders });
      const baseStaleNames = new Set((baseline.detail.stale_sample ?? []).map((s) => s.goods_name));
      if (!baseStaleNames.has(staleName)) return true; // property trivially holds

      // Insert duplicate of a *sold* SKU and verify the *other* stale verdict is unchanged.
      const soldName = baseGoods[0].goods_name;
      const augmentedGoods = [
        ...baseGoods,
        { goods_name: soldName, quantity: 42 }, // creates an ambiguous bucket
      ];
      const after = scoreInventoryHealth({ goods: augmentedGoods, orders30d: baseOrders });

      // The stale SKU (different bucket) should still appear as stale.
      const afterStaleNames = new Set((after.detail.stale_sample ?? []).map((s) => s.goods_name));
      if (!afterStaleNames.has(staleName)) return false;

      // The soldName bucket should now be ambiguous.
      const hasAmbig = (after.detail.ambiguous_groups ?? []).some(
        (g) => g.normalized_name === soldName,
      );
      if (!hasAmbig) return false;

      // matched_by stays on goods_name path.
      return after.detail.matched_by === 'goods_name';
    },
    { runs: 60 },
  );
});

// PBT 6.11: inventory_goods_id_preferred — when BOTH sides have ids, matched_by='goods_id'
// and ambiguous_groups is empty. When at least one side misses ids → fallback.
test('pbt: inventory_goods_id_preferred + fallback semantics', async () => {
  await property(
    'goods_id_vs_name_strategy',
    gen.record({
      strategy: goodsIdStrategyGen,
    }),
    ({ strategy }, { rng }) => {
      const goods = makeGoods(rng, strategy);
      const { orders } = makeOrders(rng, goods, strategy);
      const r = scoreInventoryHealth({ goods, orders30d: orders });

      if (strategy === 'both') {
        if (r.detail.matched_by !== 'goods_id') return false;
        if ((r.detail.ambiguous_groups ?? []).length !== 0) return false;
        return true;
      }
      if (strategy === 'neither') {
        return r.detail.matched_by === 'goods_name';
      }
      // orders_only or goods_only → mixed (one side has ids, other doesn't)
      return r.detail.matched_by === 'mixed';
    },
    { runs: 60 },
  );
});
