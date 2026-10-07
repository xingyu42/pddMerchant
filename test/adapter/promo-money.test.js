import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { moneyToNumber, parseMoney, PROMO_ENTITY_REPORT } from '../../src/adapter/endpoints/promo.js';
import { createFactResponses } from '../fixtures/test-data.js';

describe('MoneyVO unit handling', () => {
  it('keeps YUAN values and bare numbers as yuan', () => {
    assert.equal(moneyToNumber({ unit: 'YUAN', value: '500', unitCode: 1 }), 500);
    assert.equal(moneyToNumber({ unit: 'yuan', value: 12.5 }), 12.5);
    assert.equal(moneyToNumber({ value: '7' }), 7);
    assert.equal(moneyToNumber(3), 3);
    assert.equal(moneyToNumber('4.5'), 4.5);
  });

  it('converts FEN values to yuan', () => {
    assert.equal(moneyToNumber({ unit: 'FEN', value: '2990' }), 29.9);
  });

  it('returns null with the unknown unit instead of guessing', () => {
    assert.deepEqual(parseMoney({ unit: 'JIAO', value: '10' }), { value: null, unknownUnit: 'JIAO' });
  });

  it('keeps missing or invalid amounts null rather than zero', () => {
    for (const value of [null, undefined, '', 'abc', true, {}, { unit: 'YUAN', value: null }, NaN]) {
      assert.equal(moneyToNumber(value), null);
    }
    assert.equal(moneyToNumber(0), 0);
    assert.equal(moneyToNumber({ unit: 'FEN', value: 0 }), 0);
  });

  it('reports unknown units from a report as warnings without failing the response', () => {
    const raw = createFactResponses()['endpoints/promo.entityReport.json'];
    raw.result.totalSumReport.netGmv = { unit: 'JIAO', value: '10' };
    raw.result.entityReportList[0].reportInfo.netGmv = { unit: 'JIAO', value: '5' };
    const report = PROMO_ENTITY_REPORT.normalize(raw);
    assert.equal(report.totals.netGmv, null);
    assert.equal(report.totals.spend, 100);
    assert.deepEqual(report.unitWarnings, ['推广金额单位未知（JIAO），相关金额输出为 null']);
    assert.equal(Object.hasOwn(report.totals, 'cost'), false);
  });
});
