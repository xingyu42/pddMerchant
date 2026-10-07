import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { analyzePromoRoi } from '../../src/services/promo-roi.js';
import { PROMO_ROI_ITEM_FIELDS, PROMO_TOTALS_FIELDS, toPromoRoiView } from '../../src/services/views/promo.js';
import { toDimensionView, toShopView } from '../../src/services/views/diagnose.js';
import { diagnoseShop, summarizeInventory, summarizePromo } from '../../src/services/diagnose/index.js';
import { SAMPLE_PROMO_ENTITIES, SAMPLE_GOODS, SAMPLE_LIST_STATS } from '../fixtures/test-data.js';

describe('promo ROI view', () => {
  it('projects rows onto the whitelist with yuan, percentages and labels', () => {
    const analysis = analyzePromoRoi({
      entities: structuredClone(SAMPLE_PROMO_ENTITIES),
      totals: { impression: 500, click: 40, gmv: 600, spend: 500, netGmv: 550, costPerOrder: null },
    });
    const view = toPromoRoiView(analysis, { mallId: '900001' });
    assert.equal(view.by, '推广计划');
    assert.equal(view.total, 2);
    for (const item of view.items) assert.deepEqual(Object.keys(item), [...PROMO_ROI_ITEM_FIELDS]);
    const first = view.items.find((item) => item.plan_id === 'p1');
    assert.equal(first.spend_yuan, 400);
    assert.equal(first.ctr_pct, 10);
    assert.equal(first.scenes_type, '未知(1)');
    assert.deepEqual(Object.keys(view.totals), [...PROMO_TOTALS_FIELDS]);
    assert.equal(view.totals.net_gmv_yuan, 550);
    assert.equal(view.totals.cost_per_order_yuan, null);
    assert.equal(view.totals.ctr_pct, 8);
  });

  it('keeps sums null when an amount is unknown (e.g. unknown MoneyVO unit) instead of counting it as zero', () => {
    const view = toPromoRoiView(analyzePromoRoi({ entities: [
      { planId: 'p1', adId: 'a1', spend: 10, gmv: null, impression: 1, click: 0 },
      { planId: 'p2', adId: 'a2', spend: 5, gmv: 20, impression: 1, click: 0 },
    ] }));
    const unknown = view.items.find((item) => item.plan_id === 'p1');
    assert.equal(unknown.gmv_yuan, null);
    assert.equal(unknown.roi, null);
    assert.equal(view.summary.gmv_yuan, null);
    assert.equal(view.summary.spend_yuan, 15);
    assert.equal(view.summary.roi, null);
    assert.match(view.headline[0], /ROI 无法计算（金额缺失）/);

    const promo = summarizePromo({ totals: { impression: 3, click: 1, gmv: null, spend: 100 } });
    assert.equal(promo.detail.gmv_yuan, null);
    assert.equal(promo.detail.roi, null);
  });

  it('keeps zero-impression CTR and missing totals null', () => {
    const view = toPromoRoiView(analyzePromoRoi({ entities: [{ planId: 'x', spend: 0, gmv: 0, impression: 0, click: 0 }] }));
    assert.equal(view.items[0].ctr_pct, null);
    assert.equal(view.items[0].roi, null);
    assert.equal(view.totals, null);
    assert.match(view.headline[0], /ROI 无法计算/);
  });

  it('labels channel rows by documented scene codes only', () => {
    const view = toPromoRoiView(analyzePromoRoi({ entities: [
      { scenesType: 9, spend: 1, gmv: 2 }, { scenesType: 4, spend: 1, gmv: 1 },
    ] }, { by: 'channel' }));
    assert.equal(view.by, '推广场景');
    assert.deepEqual(view.items.map((item) => item.label).sort(), ['商品推广', '未知(4)'].sort());
  });
});

describe('diagnose views', () => {
  it('translates status, keeps detail keys and writes factual headlines', () => {
    const view = toDimensionView('promo', summarizePromo({ totals: { impression: 3, click: 1, gmv: 125, spend: 100 } }));
    assert.equal(view.status, '数据完整');
    assert.deepEqual(view.headline, ['推广花费 100.00 元，成交 125.00 元，ROI 1.25', '曝光 3 次，点击 1 次，点击率 33.33%']);
    const missing = toDimensionView('promo', summarizePromo());
    assert.equal(missing.status, '数据不完整');
    assert.deepEqual(missing.headline, ['推广数据缺失', '推广数据不完整，详见 hints']);
  });

  it('labels inventory matching and keeps samples whitelisted', () => {
    const view = toDimensionView('inventory', summarizeInventory({ goods: structuredClone(SAMPLE_GOODS), orders30d: [] }));
    assert.equal(view.detail.matched_by, '按商品 ID 匹配');
    for (const item of view.detail.stale_sample) assert.deepEqual(Object.keys(item), ['goods_id', 'goods_name', 'quantity']);
    const ambiguous = toDimensionView('inventory', summarizeInventory({
      goods: [{ goods_name: 'Tea', quantity: 2 }, { goods_name: ' Tea ', quantity: 4 }], orders30d: [],
    }));
    assert.equal(ambiguous.detail.matched_by, '按商品名匹配');
    assert.deepEqual(Object.keys(ambiguous.detail.ambiguous_groups[0]), ['normalized_name', 'sku_count', 'sample_quantities']);
  });

  it('labels shop dimensions in issues and hints', () => {
    const shop = diagnoseShop({
      orders: { stats: { unship: 0, delay: 0 }, listStats: structuredClone(SAMPLE_LIST_STATS) },
      goods: { goods: structuredClone(SAMPLE_GOODS), orders30d: [] },
      funnel: { orderStats: structuredClone(SAMPLE_LIST_STATS) },
    });
    const view = toShopView(shop, { mallId: '900001' });
    assert.equal(view.status, '数据不完整');
    assert.ok(view.issues.every((issue) => issue.dimension === '推广'));
    assert.deepEqual(view.headline, ['4 个维度中 3 个数据完整；不完整：推广']);
    assert.equal(view.mall_id, '900001');
    assert.equal(Object.hasOwn(view, 'compare'), false);
  });
});
