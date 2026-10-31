import { it } from 'vitest';
import assert from 'node:assert/strict';
import { PROMO_ENTITY_REPORT } from '../../src/adapter/endpoints/promo.js';
import { ORDER_LIST } from '../../src/adapter/endpoints/orders.js';
import { resolveProfitWindow } from '../../src/services/goods-profit.js';

it('uses explicit inclusive report dates aligned with the exclusive group-time end', () => {
  const window = resolveProfitWindow(30, Date.parse('2026-10-31T04:00:00Z') / 1000);
  const payload = PROMO_ENTITY_REPORT.buildPayload(window, { mallId: '900001' });
  assert.equal(payload.startDate, '2026-10-01');
  assert.equal(payload.endDate, '2026-10-30');
  assert.equal(payload.reportPromotionType, 9);
  assert.equal(ORDER_LIST.fixtureListKey, 'orders');
  assert.equal(PROMO_ENTITY_REPORT.fixtureListKey, 'entities');
});

it('preserves legacy since/until date payloads and rejects invalid explicit dates', () => {
  const payload = PROMO_ENTITY_REPORT.buildPayload({ since: new Date('2026-10-01T00:00:00Z'), until: new Date('2026-10-02T00:00:00Z') });
  assert.equal(payload.startDate, '2026-10-01');
  assert.equal(payload.endDate, '2026-10-02');
  assert.throws(() => PROMO_ENTITY_REPORT.buildPayload({ startDate: '2026-02-30', endDate: '2026-10-30' }), { code: 'E_USAGE' });
});
