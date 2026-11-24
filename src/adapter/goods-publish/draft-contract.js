import { PddCliError, ExitCodes } from '../../infra/errors.js';

export function checkDiscountRateValue(discountRate) {
  if (typeof discountRate !== 'number' && typeof discountRate !== 'string') return null;
  if (typeof discountRate === 'string' && discountRate.trim() === '') return null;
  const rate = Number(discountRate);
  const payloadValue = Math.round(rate * 100);
  if (!Number.isFinite(rate)
    || rate < 0.5
    || rate > 0.99
    || Math.abs((rate * 100) - payloadValue) >= 1e-9) {
    return null;
  }
  return {
    rate: payloadValue / 100,
    displayValue: (payloadValue / 10).toFixed(1),
    payloadValue,
  };
}

export function validateFullCountDiscountRate(discountRate) {
  const parsed = checkDiscountRateValue(discountRate);
  if (parsed) return parsed;
  throw new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: '满件折扣运行配置无效',
    hint: '将 fullCountDiscountRate 配置为 0.50-0.99，步长 0.01',
    detail: { field: 'fullCountDiscountRate', value_type: typeof discountRate },
    exitCode: ExitCodes.GENERAL,
  });
}

export function fullCountDiscountPayloadValue(discountRate) {
  return validateFullCountDiscountRate(discountRate).payloadValue;
}

export function normalizeSkuSpecValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^\d+(?:\.\d+)?(?:cm|厘米)$/.test(normalized)
    ? normalized.replace(/(?:cm|厘米)$/, '')
    : normalized;
}

export function costTemplateBodyError(message) {
  return new PddCliError({
    code: 'E_BUSINESS',
    message,
    hint: '确认草稿保存请求仍为 JSON 格式，并包含可注入的编辑 payload',
    exitCode: ExitCodes.BUSINESS,
  });
}
