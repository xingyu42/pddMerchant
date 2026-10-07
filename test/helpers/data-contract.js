import assert from 'node:assert/strict';

// 输出契约 v2 的 data 规则检查器（design.md §6 规则 1–3）：
//   1. data 为普通对象，headline 为非空字符串数组；
//   2. 各层级的键均为 snake_case；
//   3. 数值键名含 price|amount|gmv|spend|cost|fee 时须以 _yuan 结尾（由金额派生的百分比允许 _pct），
//      含 rate|ctr 时须以 _pct 结尾。
//
// freeKeyPaths：自由键映射的路径列表（如以中文标签为键的 'status_distribution'）。
// 命中路径的对象自身的键跳过规则 2/3，其值以 '<path>.*' 继续递归检查。
// 路径语法：对象键以 '.' 连接，数组元素记为 '[]'，自由键的子级记为 '*'，
// 例：'items[].status_distribution'、'accounts'、'accounts.*.data.status_distribution'。
//
// entityFields（规则 4）：{ <path>: 视图白名单 }，命中路径的每个对象键集合必须与白名单完全相等
// （多一个上游字段即失败）；声明的路径一次都未出现同样视为违规，防止空列表造成 vacuous pass。

const SNAKE_KEY = /^[a-z][a-z0-9_]*$/;
const MONEY_WORD = /price|amount|gmv|spend|cost|fee/i;
const RATE_WORD = /rate|ctr/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function joinPath(base, key) {
  return base ? `${base}.${key}` : key;
}

function checkKey(key, value, path, violations) {
  if (!SNAKE_KEY.test(key)) violations.push(`${path}: key is not snake_case`);
  if (typeof value !== 'number') return;
  if (MONEY_WORD.test(key) && !/_(yuan|pct)$/.test(key)) {
    violations.push(`${path}: numeric money key must end with _yuan`);
  }
  if (RATE_WORD.test(key) && !key.endsWith('_pct')) {
    violations.push(`${path}: numeric rate key must end with _pct`);
  }
}

function checkEntity(value, path, ctx) {
  const expected = ctx.entityFields.get(path);
  if (!expected) return;
  ctx.matchedEntities.add(path);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  const extra = actual.filter((key) => !wanted.includes(key));
  const missing = wanted.filter((key) => !actual.includes(key));
  if (extra.length > 0) ctx.violations.push(`${path}: unexpected entity keys ${extra.join(',')}`);
  if (missing.length > 0) ctx.violations.push(`${path}: missing entity keys ${missing.join(',')}`);
}

function walk(value, path, ctx) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, `${path}[]`, ctx);
    return;
  }
  if (!isPlainObject(value)) return;
  checkEntity(value, path, ctx);
  const freeForm = ctx.freeKeyPaths.has(path);
  for (const [key, child] of Object.entries(value)) {
    const childPath = freeForm ? joinPath(path, '*') : joinPath(path, key);
    if (!freeForm) checkKey(key, child, childPath, ctx.violations);
    walk(child, childPath, ctx);
  }
}

function checkHeadline(headline, violations) {
  const valid = Array.isArray(headline)
    && headline.length > 0
    && headline.every((line) => typeof line === 'string' && line.trim() !== '');
  if (!valid) violations.push('headline: must be a non-empty array of non-empty strings');
}

export function collectDataContractViolations(data, { freeKeyPaths = [], entityFields = {} } = {}) {
  if (!isPlainObject(data)) return ['data: must be a plain object'];
  const ctx = {
    freeKeyPaths: new Set(freeKeyPaths),
    entityFields: new Map(Object.entries(entityFields)),
    matchedEntities: new Set(),
    violations: [],
  };
  checkHeadline(data.headline, ctx.violations);
  walk(data, '', ctx);
  for (const path of ctx.entityFields.keys()) {
    if (!ctx.matchedEntities.has(path)) ctx.violations.push(`${path}: declared entity path not found`);
  }
  return ctx.violations;
}

export function assertDataContractV2(data, options) {
  const violations = collectDataContractViolations(data, options);
  assert.deepEqual(violations, [], `data violates output contract v2:\n${violations.join('\n')}`);
}
