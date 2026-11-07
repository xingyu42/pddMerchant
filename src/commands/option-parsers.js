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

export function reportDaysArg(definition) {
  return (value) => {
    const text = String(value).trim();
    const parsed = Number(text);
    if (!/^-?\d+$/.test(text) || !acceptsReportDays(definition, parsed)) {
      throw new InvalidArgumentError(definition.days.message);
    }
    return parsed;
  };
}

export function integerArg(min = 1) {
  return (value) => {
    const text = String(value).trim();
    const parsed = Number(text);
    if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(parsed) || parsed < min) {
      throw new InvalidArgumentError(`需为不小于 ${min} 的整数`);
    }
    return parsed;
  };
}
