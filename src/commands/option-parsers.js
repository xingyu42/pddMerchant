// 数字参数解析：在 commander 解析阶段拒绝非整数和越界值（invalidArgument → E_USAGE），不启动浏览器
import { InvalidArgumentError } from 'commander';

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
