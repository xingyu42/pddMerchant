import { round, toFiniteNumber, toPct, yuanFromFen } from './units.js';

export const METRIC_KINDS = Object.freeze({
  count: { convert: toFiniteNumber, suffixes: ['_count', '_qty'] },
  yuan: { convert: round, suffixes: ['_yuan'] },
  fen: { convert: yuanFromFen, suffixes: ['_yuan'] },
  ratio: { convert: toPct, suffixes: ['_pct'] },
  seconds: { convert: round, suffixes: ['_seconds'] },
});

// 声明保留在各 view，换算和输出单位规则由此处统一持有。
export function metricTable(entries) {
  const declared = Object.freeze(entries.map((entry) => Object.freeze([...entry])));
  return Object.freeze({
    entries: declared,
    fields: Object.freeze(declared.map(([key]) => key)),
    project(raw, { keySuffix = '', fieldSuffix = '' } = {}) {
      return Object.fromEntries(declared.map(([key, field, kind]) =>
        [key + keySuffix, METRIC_KINDS[kind].convert(raw?.[field + fieldSuffix])]));
    },
  });
}

// 空集合按加法单位元返回 0；缺少观测的空窗口由调用方明确返回 null。
export function sumKnown(values) {
  const numbers = values.map(toFiniteNumber);
  return numbers.some((value) => value === null) ? null : numbers.reduce((sum, value) => sum + value, 0);
}

export function ratioPct(numerator, denominator) {
  const top = toFiniteNumber(numerator);
  const bottom = toFiniteNumber(denominator);
  return top === null || bottom === null || bottom === 0 ? null : toPct(top / bottom);
}
