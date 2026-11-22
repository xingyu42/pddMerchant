import { ExitCodes, PddCliError, responseShapeError } from '../../infra/errors.js';

const PUA_GLYPH = /[\uE000-\uF8FF]/;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/;

// 校验 YYYY-MM-DD 格式与实际日历日期（拒绝 2026-02-30 等无效日期）。
export function isCalendarDate(value) {
  return typeof value === 'string' && DATE_TEXT.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

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

// 要求目标对象存在且具备全部必填自有属性（允许属性值为显式 null）。
export function requireFields(obj, required, endpoint, shapeLabel = 'result object') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw responseShapeError(endpoint, shapeLabel);
  }
  for (const field of required) {
    if (!Object.hasOwn(obj, field)) throw responseShapeError(endpoint, field);
  }
}

// 数值字段拒绝私有区字体混淆字符（fail-closed）；文本字段跳过以免误伤表情符号。
export function assertNoPua(row, fields, hint) {
  for (const field of fields) {
    if (typeof row?.[field] === 'string' && PUA_GLYPH.test(row[field])) {
      throw new PddCliError({
        code: 'E_BUSINESS',
        message: '平台返回字体混淆数据',
        hint,
        detail: { reason: 'pua_obfuscated', field },
        exitCode: ExitCodes.BUSINESS,
      });
    }
  }
}
