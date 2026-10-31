import { PddCliError, ExitCodes } from '../infra/errors.js';
import { parseYuanToFen } from '../infra/units.js';

export const COST_NAMES = Object.freeze(['purchase', 'packaging', 'courier', 'insurance', 'technical_service']);
const INPUT_FIELDS = ['goods_id', 'spec', ...COST_NAMES.map((name) => `${name}_yuan`)];

function invalid(field, message) {
  return new PddCliError({ code: 'E_USAGE', message, detail: { field },
    hint: '金额单位为元，例如 8.20；成本允许为 0，最多 2 位小数', exitCode: ExitCodes.USAGE });
}

export function validateCostGoodsId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw invalid('goods_id', '商品 ID 无效');
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (!/^[1-9]\d*$/.test(text)) throw invalid('goods_id', '商品 ID 需要正整数文本');
  return text;
}

export function validateCostSpec(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > 2000) {
    throw invalid('spec', '规格文本无效');
  }
  return value;
}

export function validateCostEntry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid(null, '成本记录需要对象');
  if (Object.keys(input).some((field) => !INPUT_FIELDS.includes(field))) throw invalid('unknown', '成本记录包含未知列');
  const entry = { goods_id: validateCostGoodsId(input.goods_id), spec: validateCostSpec(input.spec) };
  for (const [index, name] of COST_NAMES.entries()) {
    const field = `${name}_yuan`;
    const value = index >= 3 && !Object.hasOwn(input, field) ? 0 : input[field];
    const amount = parseYuanToFen(value);
    if (amount === null) throw invalid(field, '成本金额需要非负元金额，最多 2 位小数');
    entry[`${name}_fen`] = amount;
  }
  return entry;
}

export function costScope(ctx) {
  if (!ctx.accountId || ctx.account?.kind !== 'merchant') {
    throw new PddCliError({ code: 'E_ACCOUNT_REQUIRED', message: '需要已登记的商家账号',
      hint: '使用 --account 选择账号，或执行 pdd login 登记账号', exitCode: ExitCodes.USAGE });
  }
  return { accountId: ctx.accountId, mallId: validateCostGoodsId(ctx.config?.mall ?? ctx.account.identity) };
}
