// 数字参数解析：在 commander 解析阶段拒绝非整数和越界值（invalidArgument → E_USAGE），不启动浏览器
import { InvalidArgumentError } from 'commander';
import { acceptsReportDays } from '../services/operating-report.js';

export function withReportDays(command, definition) {
  const commandName = `${command.parent.name()}.${command.name()}`;
  command.exitOverride((error) => {
    // 参数校验提前后仍保留原报表的 envelope.command。
    if (error.code === 'commander.invalidArgument') error.commandName = commandName;
    throw error;
  });
  return command.option('--days <n>', definition.days.description,
    reportDaysArg(definition), definition.days.default);
}

// 只接受十进制整数写法；小数、科学计数和十六进制返回 null。
function parseIntegerText(value) {
  const text = String(value).trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

export function reportDaysArg(definition) {
  return (value) => {
    const parsed = parseIntegerText(value);
    if (parsed === null || !acceptsReportDays(definition, parsed)) {
      throw new InvalidArgumentError(definition.days.message);
    }
    return parsed;
  };
}

// 可重复的商品 ID 选项：每次出现可用逗号分隔多个 ID，累积去重；非正整数在解析阶段拒绝。
export function goodsIdListArg(value, previous = []) {
  const ids = String(value).split(',').map((id) => id.trim());
  if (ids.some((id) => !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
    throw new InvalidArgumentError('需为正整数商品 ID，可重复传入或用逗号分隔');
  }
  return [...new Set([...previous, ...ids])];
}

export function integerArg(min = 1, max = Number.MAX_SAFE_INTEGER) {
  const message = max === Number.MAX_SAFE_INTEGER ? `需为不小于 ${min} 的整数` : `需为 ${min}–${max} 的整数`;
  return (value) => {
    const parsed = parseIntegerText(value);
    if (parsed === null || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
      throw new InvalidArgumentError(message);
    }
    return parsed;
  };
}
