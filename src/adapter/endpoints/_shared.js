import { responseShapeError } from '../../infra/errors.js';

// 白名单投影：只保留上游对象自身带有的字段，缺失字段不补键。
export function pickFields(item, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(item, field)).map((field) => [field, item[field]]));
}

// 响应 result 必须是普通对象，否则视为响应结构变化。
export function resultObject(raw, endpoint) {
  const result = raw?.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw responseShapeError(endpoint, 'result object');
  return result;
}
