import { PddCliError, ExitCodes, mapErrorToExit } from '../infra/errors.js';
import { classifyRateLimit } from './classify-rate-limit.js';

export const SUCCESS_BUSINESS_CODES = new Set([0, 1000000]);
// 写接口：success 标记或成功码任一成立即成功。
export const WRITE_SUCCESS_RULE = Object.freeze({ mode: 'flag-or-code' });

function businessFields(raw) {
  return { code: raw?.error_code ?? raw?.errorCode, message: raw?.error_msg ?? raw?.errorMsg };
}

export function readBusinessError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { code, message } = businessFields(raw);
  if (code == null || SUCCESS_BUSINESS_CODES.has(code)) return null;
  return { code: String(code), message: message == null ? '' : String(message) };
}

// 默认规则保留报表端点只接受 camelCase 成功码的既有契约。
export function isSuccessfulResponse(raw, rule = {}) {
  if (typeof rule === 'function') return rule(raw);
  const mode = rule.mode ?? 'flag-and-code';
  if (mode === 'flag') return raw?.success === true;
  if (mode === 'result') return raw?.success !== false
    && (rule.allowNull ? raw?.result !== undefined : raw?.result != null);
  if (!raw || typeof raw !== 'object') return false;
  const codeField = rule.codeField ?? (mode === 'flag-and-code' ? 'errorCode' : null);
  const code = codeField ? raw[codeField] : raw.error_code ?? raw.errorCode;
  const acceptedCode = rule.codes ? rule.codes.includes(code) : SUCCESS_BUSINESS_CODES.has(code);
  return mode === 'flag-or-code' ? raw.success === true || acceptedCode
    : raw.success === true && acceptedCode;
}

export function mapWriteBusinessError(raw, { notFound = true, businessLabel = '业务错误' } = {}) {
  const { code, message = '' } = businessFields(raw);
  if (code === 54001) {
    return { code: 'E_RATE_LIMIT', message: message || '操作太过频繁', exitCode: ExitCodes.RATE_LIMIT };
  }
  if (code === 1000) {
    return { code: 'E_USAGE', message: message || '参数错误', exitCode: ExitCodes.USAGE };
  }
  const notFoundHints = ['不存在', 'not found', '找不到', '已删除'];
  if (notFound && message && notFoundHints.some((hint) => message.toLowerCase().includes(hint))) {
    return { code: 'E_NOT_FOUND', message, exitCode: ExitCodes.BUSINESS };
  }
  if (code != null && !SUCCESS_BUSINESS_CODES.has(code)) {
    return { code: 'E_BUSINESS', message: message || `${businessLabel} (${code})`, exitCode: ExitCodes.BUSINESS };
  }
  return null;
}

function mapBusinessError(spec, raw, response) {
  if (typeof spec.errorMapper === 'function') return spec.errorMapper(raw, response);
  const businessError = readBusinessError(raw);
  if (spec.errorMap === 'upstream' && businessError) {
    return { code: 'E_BUSINESS', message: businessError.message, exitCode: ExitCodes.BUSINESS };
  }
  return null;
}

function mappedExitCode(mapped, fallback) {
  return mapped?.code ? mapped.exitCode ?? mapErrorToExit(mapped) : fallback;
}

function httpFailure(spec, { status, raw, response, url, retries }) {
  if (status === 429) return new PddCliError({
    code: 'E_RATE_LIMIT', message: `${spec.name}: rate limited after ${retries} retries`,
    hint: '请求过于频繁，请稍后重试', detail: { endpoint: spec.name, url, status }, exitCode: ExitCodes.RATE_LIMIT,
  });
  if (status === 401 || status === 403) return new PddCliError({
    code: 'E_AUTH_EXPIRED', message: `${spec.name}: auth expired (HTTP ${status})`,
    hint: '登录态失效，请重新登录', detail: { url, status }, exitCode: ExitCodes.AUTH,
  });
  if (status == null || status < 400) return null;
  const mapped = mapBusinessError(spec, raw, response);
  return new PddCliError({
    code: mapped?.code || 'E_NETWORK',
    message: (mapped?.code && mapped.message) || `${spec.name}: HTTP ${status}`,
    detail: mapped?.code ? { url, status, raw } : { url, status },
    exitCode: mappedExitCode(mapped, ExitCodes.NETWORK),
  });
}

function businessFailure(spec, raw, response) {
  const businessError = readBusinessError(raw);
  const ambiguousRiskControl = businessError?.code === '40002';
  const mapped = mapBusinessError(spec, raw, response);
  const message = businessError?.message ? `${spec.name}: ${businessError.message}` : `${spec.name}: business error`;
  const hint = raw?.errorMsg || raw?.error_msg || '';
  return new PddCliError({
    code: mapped?.code || 'E_BUSINESS',
    message: mapped?.code ? mapped.message || `${spec.name}: business error` : message,
    hint: ambiguousRiskControl
      ? '平台返回高频或风控拒绝；该错误也可能由请求签名异常引起，不能单凭此码认定真实限流'
      : mapped?.code ? hint : hint || '设 PDD_DEBUG_RAW=1 查看脱敏后的原始响应',
    detail: {
      errorCode: raw?.errorCode ?? raw?.error_code,
      ...(ambiguousRiskControl ? { classification: 'high-frequency-or-risk-control' } : {}), raw,
    },
    exitCode: mappedExitCode(mapped, ExitCodes.BUSINESS),
  });
}

// successRule 可声明 flag、flag-or-code、result，特殊结构允许函数覆盖；
// errorMap: upstream 保留业务原文，errorMapper 仅处理端点例外，normalize 在判定通过后执行。
export function interpretResponse(spec, context) {
  const { raw, response } = context;
  const httpError = httpFailure(spec, context);
  if (httpError) throw httpError;
  if (raw == null) throw new PddCliError({
    code: 'E_NETWORK', message: `${spec.name}: empty or unparsable response body`,
    hint: '可能被风控拦截，尝试重新登录', exitCode: ExitCodes.NETWORK,
  });
  const classification = classifyRateLimit(raw, response);
  if (classification) throw new PddCliError({
    code: 'E_RATE_LIMIT', message: `${spec.name}: rate limit detected (${classification})`,
    hint: '请求过于频繁，请稍后重试', detail: { endpoint: spec.name, classification, raw },
    exitCode: ExitCodes.RATE_LIMIT,
  });
  // 40002 只细化已失败响应，保留端点接受 success: true 的既有规则。
  if (!isSuccessfulResponse(raw, spec.successRule)) throw businessFailure(spec, raw, response);
  return typeof spec.normalize === 'function' ? spec.normalize(raw) : { raw };
}
