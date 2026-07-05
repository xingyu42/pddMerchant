import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  PROMO_ENTITY_REPORT,
  PROMO_HOURLY_REPORT,
  moneyToNumber,
  flattenEntity,
} from '../src/adapter/endpoints/promo.js';

// ---------- moneyToNumber ----------

test('moneyToNumber: MoneyVO {unit, value, unitCode} → number', () => {
  assert.equal(moneyToNumber({ unit: 'YUAN', value: '123.45', unitCode: 1 }), 123.45);
});

test('moneyToNumber: percent MoneyVO → number', () => {
  assert.equal(moneyToNumber({ unit: 'PERCENT', value: '2.50', unitCode: 100 }), 2.5);
});

test('moneyToNumber: bare number passthrough', () => {
  assert.equal(moneyToNumber(42), 42);
  assert.equal(moneyToNumber(0), 0);
  assert.equal(moneyToNumber(-3.5), -3.5);
});

test('moneyToNumber: null/undefined → 0', () => {
  assert.equal(moneyToNumber(null), 0);
  assert.equal(moneyToNumber(undefined), 0);
});

test('moneyToNumber: non-object (string) → parsed number or 0', () => {
  assert.equal(moneyToNumber('99.9'), 99.9);
  assert.equal(moneyToNumber('not-a-number'), 0);
});

test('moneyToNumber: MoneyVO with non-numeric value → 0', () => {
  assert.equal(moneyToNumber({ unit: 'YUAN', value: 'abc', unitCode: 1 }), 0);
});

test('moneyToNumber: NaN/Infinity → 0', () => {
  assert.equal(moneyToNumber(Number.NaN), 0);
  assert.equal(moneyToNumber(Number.POSITIVE_INFINITY), 0);
});

// ---------- flattenEntity ----------

test('flattenEntity: flat structure (fields directly on entity)', () => {
  const e = {
    planId: 1, adId: 101, adName: 'A', goodsId: 1001, goodsName: '商品A',
    scenesType: 9, impression: 5000, click: 100, gmv: { unit: 'YUAN', value: '1500', unitCode: 1 },
    spend: { unit: 'YUAN', value: '300', unitCode: 1 },
  };
  const f = flattenEntity(e);
  assert.equal(f.planId, 1);
  assert.equal(f.impression, 5000);
  assert.equal(f.click, 100);
  assert.equal(f.gmv, 1500);
  assert.equal(f.spend, 300);
});

test('flattenEntity: nested reportInfo structure', () => {
  const e = {
    planId: 2, adId: 102, goodsId: 1002, goodsName: '商品B',
    reportInfo: {
      impression: 8000, click: 200,
      gmv: { unit: 'YUAN', value: '2000', unitCode: 1 },
      spend: { unit: 'YUAN', value: '500', unitCode: 1 },
      ctr: { unit: 'PERCENT', value: '2.5', unitCode: 100 },
    },
  };
  const f = flattenEntity(e);
  assert.equal(f.impression, 8000);
  assert.equal(f.click, 200);
  assert.equal(f.gmv, 2000);
  assert.equal(f.spend, 500);
  assert.equal(f.ctr, 2.5);
  assert.equal(f.goodsName, '商品B');
});

test('flattenEntity: null entity → null', () => {
  assert.equal(flattenEntity(null), null);
  assert.equal(flattenEntity(undefined), null);
});

test('flattenEntity: cost alias fallback (spend via cost field)', () => {
  const e = { planId: 3, cost: { unit: 'YUAN', value: '777', unitCode: 1 } };
  const f = flattenEntity(e);
  assert.equal(f.spend, 777);
});

// ---------- PROMO_ENTITY_REPORT.normalize ----------

test('PROMO_ENTITY_REPORT.normalize: MoneyVO totals → flat numbers', () => {
  const raw = {
    result: {
      entityReportList: [],
      totalSumReport: {
        impression: 10000, click: 300,
        gmv: { unit: 'YUAN', value: '35000', unitCode: 1 },
        spend: { unit: 'YUAN', value: '1300', unitCode: 1 },
        netGmv: { unit: 'YUAN', value: '32000', unitCode: 1 },
        ctr: { unit: 'PERCENT', value: '3.0', unitCode: 100 },
        costPerOrder: { unit: 'YUAN', value: '10', unitCode: 1 },
      },
    },
    success: true,
    errorCode: 1000,
  };
  const n = PROMO_ENTITY_REPORT.normalize(raw);
  assert.equal(n.impression, 10000);
  assert.equal(n.click, 300);
  assert.equal(n.gmv, 35000);
  assert.equal(n.totals.spend, 1300);
  assert.equal(n.totals.cost, 1300);
  assert.equal(n.netGmv, 32000);
  assert.equal(n.ctr, 3.0);
  assert.equal(n.costPerOrder, 10);
  assert.deepEqual(n.entities, []);
  assert.equal(n.raw, raw);
});

test('PROMO_ENTITY_REPORT.normalize: entityReportList flattened', () => {
  const raw = {
    result: {
      entityReportList: [
        { planId: 1, adId: 101, goodsName: 'A', scenesType: 9, impression: 100, click: 5,
          gmv: { unit: 'YUAN', value: '500', unitCode: 1 },
          spend: { unit: 'YUAN', value: '100', unitCode: 1 } },
        { planId: 2, adId: 102, goodsName: 'B', scenesType: 9,
          reportInfo: { impression: 200, click: 10,
            gmv: { unit: 'YUAN', value: '800', unitCode: 1 },
            spend: { unit: 'YUAN', value: '200', unitCode: 1 } } },
      ],
      totalSumReport: {},
    },
  };
  const n = PROMO_ENTITY_REPORT.normalize(raw);
  assert.equal(n.entities.length, 2);
  assert.equal(n.entities[0].gmv, 500);
  assert.equal(n.entities[0].spend, 100);
  assert.equal(n.entities[1].gmv, 800);
  assert.equal(n.entities[1].spend, 200);
  assert.equal(n.entities[1].impression, 200);
});

test('PROMO_ENTITY_REPORT.normalize: empty result → zeros', () => {
  const n = PROMO_ENTITY_REPORT.normalize({ result: {} });
  assert.equal(n.impression, 0);
  assert.equal(n.gmv, 0);
  assert.equal(n.spend, undefined); // totals empty, no spend field
  assert.deepEqual(n.entities, []);
});

test('PROMO_ENTITY_REPORT.isSuccess: result present → true', () => {
  assert.equal(PROMO_ENTITY_REPORT.isSuccess({ result: {} }), true);
  assert.equal(PROMO_ENTITY_REPORT.isSuccess({ success: true, errorCode: 1000, result: {} }), true);
  assert.equal(PROMO_ENTITY_REPORT.isSuccess({}), false);
});

// ---------- PROMO_HOURLY_REPORT.normalize ----------

test('PROMO_HOURLY_REPORT.normalize: sumReport MoneyVO flattened', () => {
  const raw = {
    result: {
      sumReport: {
        impression: 5000, click: 150,
        gmv: { unit: 'YUAN', value: '9000', unitCode: 1 },
        spend: { unit: 'YUAN', value: '450', unitCode: 1 },
      },
      hourlyPoints: [{ hour: 1 }],
      anchorPoints: { start: '2026-06-01' },
    },
  };
  const n = PROMO_HOURLY_REPORT.normalize(raw);
  assert.equal(n.totals.impression, 5000);
  assert.equal(n.totals.gmv, 9000);
  assert.equal(n.totals.spend, 450);
  assert.equal(n.hourlyPoints.length, 1);
  assert.deepEqual(n.anchorPoints, { start: '2026-06-01' });
});

// ---------- endpoint urlPattern (regression guard against apollo→poseidon fix) ----------

test('PROMO_ENTITY_REPORT.urlPattern matches poseidon gateway path', () => {
  assert.ok(PROMO_ENTITY_REPORT.urlPattern.test('/mms-gateway/poseidon/api/report/queryEntityReport'));
  assert.ok(!PROMO_ENTITY_REPORT.urlPattern.test('/mms-gateway/apollo/api/report/queryEntityReport'));
});

test('PROMO_HOURLY_REPORT.urlPattern matches poseidon gateway path', () => {
  assert.ok(PROMO_HOURLY_REPORT.urlPattern.test('/mms-gateway/poseidon/api/report/queryHourlyRangeReport'));
  assert.ok(!PROMO_HOURLY_REPORT.urlPattern.test('/mms-gateway/apollo/api/report/queryHourlyRangeReport'));
});

// ---------- buildPayload regression (page/size/since/until mapping) ----------

test('PROMO_ENTITY_REPORT.buildPayload: page/size/since/until mapped to queryRange and dates', () => {
  const payload = PROMO_ENTITY_REPORT.buildPayload(
    { page: 2, size: 50, since: new Date('2026-06-01'), until: new Date('2026-06-15') },
    { mallId: 684131980 },
  );
  assert.equal(payload.entityId, 684131980);
  assert.equal(payload.queryRange.pageNumber, 2);
  assert.equal(payload.queryRange.pageSize, 50);
  assert.equal(payload.startDate, '2026-06-01');
  assert.equal(payload.endDate, '2026-06-15');
  assert.equal(payload.reportPromotionType, 9);
});
