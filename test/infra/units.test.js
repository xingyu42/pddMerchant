import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  isoToLocalDateTime, labelOf, parseYuanToFen, round, toFiniteNumber, toLocalDate, toLocalDateTime, toPct, yuanFromFen,
} from '../../src/infra/units.js';

const INVALID_NUMBERS = [null, undefined, '', '  ', 'abc', '0x10', true, NaN, Infinity, -Infinity, {}, []];

describe('toFiniteNumber', () => {
  it('accepts finite numbers and numeric strings only', () => {
    assert.equal(toFiniteNumber(2), 2);
    assert.equal(toFiniteNumber(' -1.5 '), -1.5);
    assert.equal(toFiniteNumber('0'), 0);
    for (const value of INVALID_NUMBERS) assert.equal(toFiniteNumber(value), null);
  });
});

describe('round', () => {
  it('rounds half away from zero without binary drift', () => {
    assert.equal(round(1.005, 2), 1.01);
    assert.equal(round(-1.005, 2), -1.01);
    assert.equal(round(2.345), 2.35);
    assert.equal(round(12.25, 1), 12.3);
    assert.equal(round(3, 0), 3);
    assert.equal(round('7.126'), 7.13);
  });

  it('never returns negative zero', () => {
    assert.ok(Object.is(round(-0.001, 2), 0));
  });

  it('returns null for invalid input', () => {
    for (const value of INVALID_NUMBERS) assert.equal(round(value), null);
  });
});

describe('yuanFromFen', () => {
  it('converts fen to yuan with 2 decimals', () => {
    assert.equal(yuanFromFen(2990), 29.9);
    assert.equal(yuanFromFen(1), 0.01);
    assert.equal(yuanFromFen(0), 0);
    assert.equal(yuanFromFen('12345'), 123.45);
    assert.equal(yuanFromFen(' 100 '), 1);
    assert.equal(yuanFromFen(-150), -1.5);
    assert.equal(yuanFromFen(0.5), 0.01);
  });

  it('returns null for invalid input', () => {
    for (const value of INVALID_NUMBERS) assert.equal(yuanFromFen(value), null);
  });
});

describe('parseYuanToFen', () => {
  it('parses yuan exactly into integer fen', () => {
    assert.equal(parseYuanToFen('29.9'), 2990);
    assert.equal(parseYuanToFen('0.01'), 1);
    assert.equal(parseYuanToFen('19.99'), 1999);
    assert.equal(parseYuanToFen(' 100 '), 10000);
    assert.equal(parseYuanToFen(29.9), 2990);
    assert.equal(parseYuanToFen(0.07), 7);
    assert.equal(parseYuanToFen('0'), 0);
  });

  it('rejects more than 2 decimals, negatives and non-decimal text', () => {
    for (const value of ['29.999', 29.999, '-1', -1, '1.', '.5', '1e3', '1,000', '', 'abc', null, undefined, NaN, Infinity]) {
      assert.equal(parseYuanToFen(value), null, `expected null for ${String(value)}`);
    }
  });

  it('rejects amounts beyond the safe integer range', () => {
    assert.equal(parseYuanToFen('90071992547409.91'), Number.MAX_SAFE_INTEGER);
    assert.equal(parseYuanToFen('90071992547409.92'), null);
    assert.equal(parseYuanToFen('123456789012345'), null);
  });
});

describe('toLocalDateTime / toLocalDate', () => {
  // 2026-10-06T16:30:05Z = 2026-10-07 00:30:05 +08:00（跨日边界）
  const SECONDS = 1791304205;

  it('formats unix seconds in Asia/Shanghai regardless of host TZ', () => {
    assert.equal(toLocalDateTime(SECONDS), '2026-10-07 00:30:05');
    assert.equal(toLocalDate(SECONDS), '2026-10-07');
    assert.equal(toLocalDateTime(String(SECONDS)), '2026-10-07 00:30:05');
  });

  it('treats values >= 1e11 as milliseconds', () => {
    assert.equal(toLocalDateTime(SECONDS * 1000 + 999), '2026-10-07 00:30:05');
    assert.equal(toLocalDate(SECONDS * 1000), '2026-10-07');
  });

  it('returns null for invalid, non-positive or out-of-range timestamps', () => {
    for (const value of [...INVALID_NUMBERS, 0, -1, 1e17]) {
      assert.equal(toLocalDateTime(value), null);
      assert.equal(toLocalDate(value), null);
    }
  });
});

describe('toPct', () => {
  it('converts a 0-1 ratio into a 2-decimal percentage', () => {
    assert.equal(toPct(0.0312), 3.12);
    assert.equal(toPct(0.12345), 12.35);
    assert.equal(toPct(1), 100);
    assert.equal(toPct(0), 0);
    assert.equal(toPct('0.5'), 50);
    assert.equal(toPct(-0.25), -25);
  });

  it('returns null for invalid input', () => {
    for (const value of INVALID_NUMBERS) assert.equal(toPct(value), null);
  });
});

describe('labelOf', () => {
  const LABELS = { 1: '待发货', 2: '已发货' };

  it('maps known codes to labels', () => {
    assert.equal(labelOf(LABELS, 1), '待发货');
    assert.equal(labelOf(LABELS, '2'), '已发货');
  });

  it('marks unknown codes and keeps prototype keys out', () => {
    assert.equal(labelOf(LABELS, 9), '未知(9)');
    assert.equal(labelOf(LABELS, 'constructor'), '未知(constructor)');
  });

  it('returns null for missing codes', () => {
    for (const code of [null, undefined, '']) assert.equal(labelOf(LABELS, code), null);
  });
});

describe('isoToLocalDateTime', () => {
  it('converts ISO timestamps to Shanghai local time', () => {
    assert.equal(isoToLocalDateTime('2026-10-06T16:30:05.000Z'), '2026-10-07 00:30:05');
    assert.equal(isoToLocalDateTime('2026-10-07T00:30:05+08:00'), '2026-10-07 00:30:05');
  });

  it('returns null for missing or unparsable values', () => {
    for (const value of [null, undefined, '', 'not a date', 1700000000]) assert.equal(isoToLocalDateTime(value), null);
  });
});
