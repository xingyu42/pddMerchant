// 领域视图共用的投影辅助（输出契约 v2）：取值、文本归一。数值 / 金额 / 时间换算见 infra/units.js。
export { toFiniteNumber } from '../../infra/units.js';

// 按顺序取第一个非空（!= null）的字段值；全部缺失 → null
export function pick(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (value != null) return value;
  }
  return null;
}

// 仅接受 string / number（标识、名称等）；空串 → null
export function text(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

// 金额文案：29.9 → '29.90 元'；缺失 → missing（默认 '金额未记录'）
export function yuanText(value, missing = '金额未记录') {
  return value == null ? missing : `${value.toFixed(2)} 元`;
}

// 当前店铺 ID（runner 注入的 mall 上下文）；业务上下文放在 data 顶层
export function mallIdOf(ctx) {
  return ctx?.mallCtx?.activeId ?? null;
}
