import { PddCliError, ExitCodes } from '../infra/errors.js';

const STRICT_PATTERN = /^[0-9]{1,15}$/;
const RELAXED_MAX_LEN = 64;

export function parseMallId(input, { strict } = {}) {
  const useStrict = strict !== false && process.env.PDD_MALL_ID_STRICT_PARSE !== '0';

  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 0) {
      return { value: null, reason: `invalid numeric mall_id: ${input}` };
    }
    input = String(input);
  }

  if (typeof input !== 'string') {
    return { value: null, reason: `mall_id must be a string or non-negative integer, got ${typeof input}` };
  }

  const trimmed = input.trim();

  if (useStrict) {
    if (input !== trimmed) {
      return { value: null, reason: 'mall_id contains leading/trailing whitespace' };
    }
    if (!STRICT_PATTERN.test(trimmed)) {
      return { value: null, reason: `mall_id must be 1-15 digits, got "${trimmed}"` };
    }
    return { value: trimmed };
  }

  if (trimmed.length === 0) {
    return { value: null, reason: 'mall_id is empty' };
  }
  if (trimmed.length > RELAXED_MAX_LEN) {
    return { value: null, reason: `mall_id exceeds ${RELAXED_MAX_LEN} characters` };
  }
  return { value: trimmed };
}

export function requireMallId(input, opts) {
  const result = parseMallId(input, opts);
  if (result.value == null) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `mall_id validation failed: ${result.reason}`,
      hint: '执行 pdd shops list 查看可用店铺 ID',
      exitCode: ExitCodes.USAGE,
    });
  }
  return result.value;
}
