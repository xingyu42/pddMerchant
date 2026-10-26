import { it, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../../../../src/adapter/run-endpoint.js', () => ({
  runEndpoint: () => { throw new Error('network transport forbidden'); },
}));
vi.mock('../../../../src/adapter/browser.js', () => ({
  evaluateInMainWorld: () => { throw new Error('browser forbidden'); },
}));
const { analyzePromoRoi } = await import('../../../../src/services/promo-roi.js');
const { generateActionPlan } = await import('../../../../src/services/action-plan.js');
const { scoreInventoryHealth } = await import('../../../../src/services/diagnose/inventory-health.js');
const { segmentGoods } = await import('../../../../src/services/goods-segmentation.js');
const { GOODS_LIST } = await import('../../../../src/adapter/endpoints/goods.js');
const { PROMO_ENTITY_REPORT } = await import('../../../../src/adapter/endpoints/promo.js');

it('F5: ROI below configured break-even still recommends budget increase', () => {
  const promoRoi = analyzePromoRoi({ entities: [{ planId: 1, spend: 100, gmv: 250 }] }, { breakEvenRoi: 3 });
  assert.equal(promoRoi.rows[0].status, 'scale');
  assert.equal(generateActionPlan({ promoRoi }).actions[0].action, 'increase_budget');
});

it('F6: inventory discards goods-scan failure flags', () => {
  const goods = [{ goods_id: '1', goods_name: 'synthetic item', quantity: 100 }];
  const orders30d = [{ goods_id: '1', goods_name: 'synthetic item', quantity: 1 }];
  const full = scoreInventoryHealth({ goods, orders30d, goodsTotal: 1 });
  const partial = scoreInventoryHealth({
    goods, orders30d, goodsTotal: 1, goodsScanTruncated: true, goodsScanRateLimited: true,
  });
  assert.deepEqual(partial, full);
  assert.equal(partial.status, 'green');
});

it('F7: missing successful goods response fields become a real-looking empty shop', () => {
  const raw = { success: true, result: {} };
  assert.equal(GOODS_LIST.isSuccess(raw), true);
  assert.equal(GOODS_LIST.normalize(raw).total, 0);
  assert.deepEqual(GOODS_LIST.normalize(raw).goods, []);
});

it('F7: missing promotion report becomes zero spend and no entities', () => {
  const raw = { success: true, result: {} };
  assert.equal(PROMO_ENTITY_REPORT.isSuccess(raw), true);
  assert.equal(PROMO_ENTITY_REPORT.normalize(raw).spend, 0);
  assert.deepEqual(PROMO_ENTITY_REPORT.normalize(raw).entities, []);
});

it('F8: incomplete order scan still creates a clearance recommendation', () => {
  const segmentation = segmentGoods({
    goods: [{ goods_id: '1', goods_name: 'synthetic item', quantity: 100 }],
    orders30d: [], ratelimited: true,
  });
  assert.equal(segmentation.summary.data_completeness, 'partial_orders');
  assert.equal(segmentation.items[0].action, 'clearance');
  const plan = generateActionPlan({ segmentation });
  assert.equal(plan.actions[0].action, 'clearance');
  assert.equal(plan.actions[0].confidence, 'medium');
  assert.equal(plan.data_completeness.segmentation, true);
});
