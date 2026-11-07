import { PddCliError, ExitCodes } from '../infra/errors.js';
import { throwIfAborted } from '../infra/abort.js';

export function defineReport({ days, hints }) {
  const choices = Object.keys(days.choices ?? {});
  const range = choices.length ? choices.join('、') : `${days.min}${days.separator ?? '-'}${days.max}`;
  const choicesOr = range.replace(/、([^、]+)$/, ' 或 $1');
  const expand = (text) => text.replaceAll('{range}', range).replaceAll('{choices_or}', choicesOr)
    .replaceAll('{default}', String(days.default));
  return Object.freeze({
    days: Object.freeze({ ...days, choices: days.choices ? Object.freeze(days.choices) : undefined,
      message: expand(days.message), description: expand(days.description) }),
    hints: Object.freeze(hints),
  });
}

export function acceptsReportDays(definition, days) {
  const allowed = definition.days;
  return Number.isSafeInteger(days) && (allowed.choices
    ? Object.hasOwn(allowed.choices, days) : days >= allowed.min && days <= allowed.max);
}

export function validateReportDays(definition, days) {
  if (!acceptsReportDays(definition, days)) {
    throw new PddCliError({ code: 'E_USAGE', message: definition.days.message, exitCode: ExitCodes.USAGE });
  }
  return days;
}

export function reportHints(definition, keys) {
  return Array.from(keys, (key) => {
    const label = Object.hasOwn(definition.hints, key) ? definition.hints[key] : null;
    if (typeof label !== 'string' || !label.trim() || !/[\u3400-\u9fff]/u.test(label)) {
      throw new PddCliError({ code: 'E_INTERNAL', message: `报表提示未登记或文案无效：${key}`, exitCode: ExitCodes.GENERAL });
    }
    return label;
  });
}

export function createReport(ctx, definition, { window = null, hints = [] } = {}) {
  reportHints(definition, hints);
  const hint = (key) => { reportHints(definition, [key]); hints.push(key); };
  const optional = async (key, collect, fallback = null) => {
    reportHints(definition, [key]);
    try {
      throwIfAborted(ctx.signal);
      const result = await collect();
      throwIfAborted(ctx.signal);
      return result;
    } catch (error) {
      throwIfAborted(ctx.signal);
      if (['E_TIMEOUT', 'E_INTERNAL'].includes(error?.code)
        || error?.name === 'AbortError' || !(error instanceof PddCliError)) throw error;
      hint(key);
      // 回退函数可读取失败原因并保留已采集部分；取消与程序异常始终透传。
      return typeof fallback === 'function' ? fallback(error) : fallback;
    }
  };
  return { window, hints, hint, optional };
}

export async function runReport(ctx, definition, { days = definition.days.default, window = null, hints = [] }, collect) {
  validateReportDays(definition, days);
  throwIfAborted(ctx.signal);
  const resolved = typeof window === 'function' ? await window(days) : window;
  throwIfAborted(ctx.signal);
  const report = createReport(ctx, definition, { window: resolved, hints });
  const result = await collect(report);
  throwIfAborted(ctx.signal);
  return result;
}
