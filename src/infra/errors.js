import { redactRecursive } from './logger.js';
import { ENVELOPE_VERSION } from './output.js';

export const ExitCodes = Object.freeze({
  OK: 0,
  GENERAL: 1,
  USAGE: 2,
  AUTH: 3,
  RATE_LIMIT: 4,
  NETWORK: 5,
  BUSINESS: 6,
  PARTIAL: 7,
});

export class PddCliError extends Error {
  constructor({ code, message, hint, detail, exitCode }) {
    super(message);
    this.name = 'PddCliError';
    this.code = code ?? 'E_GENERAL';
    this.hint = hint ?? '';
    this.detail = detail ?? null;
    this.exitCode = exitCode ?? ExitCodes.GENERAL;
  }
}

export function mapErrorToExit(err) {
  if (err instanceof PddCliError) return err.exitCode;
  if (!err || typeof err !== 'object') return ExitCodes.GENERAL;
  const code = String(err.code || '').toUpperCase();
  if (code.includes('AUTH') || code === 'UNAUTHORIZED' || code === 'E_AUTH') return ExitCodes.AUTH;
  if (code.includes('RATE') || code === 'E_RATE_LIMIT' || code === 'TOO_MANY_REQUESTS') return ExitCodes.RATE_LIMIT;
  if (code.includes('NETWORK') || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') return ExitCodes.NETWORK;
  if (code.includes('TIMEOUT')) return ExitCodes.NETWORK;
  if (code === 'E_USAGE' || code === 'EINVAL') return ExitCodes.USAGE;
  if (code === 'E_BUSINESS' || code === 'E_NOT_FOUND') return ExitCodes.BUSINESS;
  if (code === 'E_PARTIAL') return ExitCodes.PARTIAL;
  return ExitCodes.GENERAL;
}

export function responseShapeError(endpoint, expected) {
  return new PddCliError({
    code: 'E_NETWORK',
    message: `${endpoint}: unexpected response shape`,
    hint: `平台响应缺少或包含无效 ${expected}；不能将缺失字段解释为真实业务 0`,
    detail: { endpoint, expected },
    exitCode: ExitCodes.NETWORK,
  });
}

export function accountNotFound(slug) {
  return new PddCliError({
    code: 'E_ACCOUNT_NOT_FOUND',
    message: `Account "${slug}" not found`,
    hint: 'Run "pdd account list" to see registered accounts',
    exitCode: ExitCodes.USAGE,
  });
}

export function accountRequired() {
  return new PddCliError({
    code: 'E_ACCOUNT_REQUIRED',
    message: 'Multiple accounts registered but no --account specified and no default set',
    hint: 'Use --account <slug> or run "pdd account default <slug>"',
    exitCode: ExitCodes.USAGE,
  });
}

export function accountAmbiguous(slug, matches) {
  return new PddCliError({
    code: 'E_ACCOUNT_AMBIGUOUS',
    message: `Account name "${slug}" matches multiple accounts: ${matches.join(', ')}`,
    hint: 'Use the exact slug from "pdd account list"',
    exitCode: ExitCodes.USAGE,
  });
}

export function masterKeyMissing() {
  return new PddCliError({
    code: 'E_MASTER_KEY_MISSING',
    message: '认证数据的主密钥文件缺失',
    hint: '请恢复原主密钥文件，或清空数据库后重新登录并录入密码',
    exitCode: ExitCodes.AUTH,
  });
}

export function masterKeyMismatch() {
  return new PddCliError({
    code: 'E_MASTER_KEY_MISMATCH',
    message: '主密钥与认证数据库的指纹不匹配',
    hint: '请恢复原主密钥文件，或清空数据库后重新登录并录入密码',
    exitCode: ExitCodes.AUTH,
  });
}

export function masterKeyInsecure() {
  return new PddCliError({
    code: 'E_MASTER_KEY_INSECURE',
    message: '主密钥文件权限不安全',
    hint: '请将主密钥文件权限设置为 0600 后重试',
    exitCode: ExitCodes.AUTH,
  });
}

export function secretDecryptFailed(detail) {
  return new PddCliError({
    code: 'E_SECRET_DECRYPT_FAILED',
    message: '认证数据解密失败',
    hint: '请恢复原主密钥文件；若只有个别账号无法解密，先执行 pdd account remove --slug <slug> --confirm 再重新登录',
    detail,
    exitCode: ExitCodes.AUTH,
  });
}

export function daemonNotRunning() {
  return new PddCliError({
    code: 'E_DAEMON_NOT_RUNNING', message: 'daemon 未运行',
    hint: '执行 pdd daemon start', exitCode: ExitCodes.GENERAL,
  });
}

export function daemonStartTimeout() {
  return new PddCliError({
    code: 'E_DAEMON_START_TIMEOUT', message: '等待 daemon 启动超时',
    hint: '执行 pdd daemon status 检查状态后重试', exitCode: ExitCodes.GENERAL,
  });
}

// Keep native errors, paths and arbitrary text out of daemon error details.
function daemonDetail(detail) {
  if (!detail) return null;
  const safe = {};
  if (Number.isSafeInteger(detail.pid) && detail.pid > 0) safe.pid = detail.pid;
  if (Number.isInteger(detail.port) && detail.port >= 1 && detail.port <= 65535) safe.port = detail.port;
  if (['foreign_host', 'lease_active', 'kill_failed', 'address_in_use'].includes(detail.reason)) safe.reason = detail.reason;
  return safe;
}

export function daemonStopTimeout(detail) {
  return new PddCliError({
    code: 'E_DAEMON_STOP_TIMEOUT', message: '等待 daemon 停止超时', detail: daemonDetail(detail),
    hint: '检查 daemon 所在主机的进程状态后重试', exitCode: ExitCodes.GENERAL,
  });
}

export function consolePortInUse(detail) {
  return new PddCliError({
    code: 'E_CONSOLE_PORT_IN_USE', message: '控制台端口已被占用', detail: daemonDetail(detail),
    hint: '修改 consolePort 配置或释放端口后执行 pdd daemon start', exitCode: ExitCodes.GENERAL,
  });
}

const RELOGIN_REASONS = new Set(['success', 'sms', 'slider', 'click', 'risk_confirm', 'unknown',
  'wrong_password', 'account_locked', 'form_changed', 'network_error', 'verify_failed',
  'takeover_timeout', 'manual_login', 'password_reset', 'password_cleared', 'manual_unblock']);

function reloginDetail(detail) {
  if (!detail) return null;
  const safe = {};
  if (typeof detail.account === 'string') safe.account = detail.account;
  for (const key of ['challenge', 'reason']) {
    if (RELOGIN_REASONS.has(detail[key]) || (key === 'reason' && detail[key] === null)) safe[key] = detail[key];
  }
  if (detail.relogin === 'throttled') safe.relogin = 'throttled';
  if (typeof detail.next_attempt_at === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(detail.next_attempt_at)) {
    safe.next_attempt_at = detail.next_attempt_at;
  }
  return safe;
}

export function authHumanRequired(detail) {
  return new PddCliError({
    code: 'E_AUTH_HUMAN_REQUIRED',
    message: '账号登录需要人工完成验证',
    hint: '执行 pdd console link 获取控制台链接并转给用户；不要在聊天中索要密码',
    detail: reloginDetail(detail),
    exitCode: ExitCodes.AUTH,
  });
}

export function reloginBlocked(detail) {
  return new PddCliError({
    code: 'E_AUTH_RELOGIN_BLOCKED', message: '账号自动重登已熔断',
    hint: '执行 pdd console link 重设密码或解除熔断，或执行 pdd login --qr 扫码登录',
    detail: reloginDetail(detail),
    exitCode: ExitCodes.AUTH,
  });
}

export function reloginFailed(detail) {
  return new PddCliError({
    code: 'E_AUTH_RELOGIN_FAILED', message: '自动重登未完成',
    hint: '稍后重试或执行 pdd login',
    detail: reloginDetail(detail),
    exitCode: ExitCodes.AUTH,
  });
}

export function passwordLoginFormChanged(detail) {
  return new PddCliError({
    code: 'E_PASSWORD_LOGIN_FORM_CHANGED',
    message: '登录页结构已变化，无法自动填写账密',
    detail: reloginDetail(detail),
    hint: '执行 pdd login --qr 扫码登录，并反馈此问题',
    exitCode: ExitCodes.AUTH,
  });
}

export function riskControlDetected(detail) {
  return new PddCliError({
    code: 'E_RISK_CONTROL',
    message: '拼多多风控挑战已触发',
    detail,
    hint: '停止自动化操作，等待冷却后重试或手动完成验证',
    exitCode: ExitCodes.RATE_LIMIT,
  });
}

export function softRiskControlDetected(detail) {
  return new PddCliError({
    code: 'E_RISK_CONTROL_SOFT',
    message: '检测到软风控脱敏：商品价格/SKU 不可见',
    detail,
    hint: '降低抓取频率、更换或养号消费者登录态，冷却后重试',
    exitCode: ExitCodes.RATE_LIMIT,
  });
}

// IP/会话级软封冷却短路：连续脱敏达阈值后进入持久长冷却，期间直接退避不再发请求。
export function scrapeCooldownActive(remainingMs, extra = {}) {
  const remaining = Math.max(0, Math.ceil(Number(remainingMs) || 0));
  return new PddCliError({
    code: 'E_RATE_LIMIT',
    message: `IP 软风控冷却中，约 ${Math.ceil(remaining / 1000)}s 后再尝试抓取`,
    detail: { reason: 'ip_soft_block', cooldown_triggered: true, cooldown_remaining_ms: remaining, ...extra },
    hint: 'PDD 对当前出口 IP/会话软封中，停止抓取等待自然恢复（通常数小时），勿换 IP 绕过',
    exitCode: ExitCodes.RATE_LIMIT,
  });
}

export function captchaDetected(detail) {
  return new PddCliError({
    code: 'E_CAPTCHA_DOM',
    message: '检测到验证码/滑块挑战',
    detail,
    hint: '请手动完成验证后重试',
    exitCode: ExitCodes.RATE_LIMIT,
  });
}

export function loginRedirectDetected(detail) {
  return new PddCliError({
    code: 'E_AUTH_EXPIRED',
    message: '操作过程中检测到登录重定向',
    detail,
    hint: '请重新运行 pdd login',
    exitCode: ExitCodes.AUTH,
  });
}

const SEVERITY = { 3: 6, 4: 5, 5: 4, 6: 3, 1: 2, 2: 1, 0: 0, 7: 7 };

export function batchExitCode(accountResults) {
  const entries = Object.values(accountResults);
  const failCodes = entries
    .filter((r) => !r.ok)
    .map((r) => r.exit_code ?? ExitCodes.GENERAL);

  if (failCodes.length === 0) return ExitCodes.OK;

  const anySucceeded = entries.some((r) => r.ok);
  if (anySucceeded) return ExitCodes.PARTIAL;

  failCodes.sort((a, b) => (SEVERITY[b] ?? 0) - (SEVERITY[a] ?? 0));
  return failCodes[0];
}

export function isSuccessResponse(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.success === true) return true;
  if (raw.errorCode === 0) return true;
  if (raw.errorCode === 1000000) return true;
  if (raw.result !== undefined && raw.success !== false) return true;
  return false;
}

export function errorToEnvelope(command, err, meta = {}) {
  const isPddErr = err instanceof PddCliError;
  const code = isPddErr ? err.code : (err?.code ?? 'E_GENERAL');
  const exitCode = isPddErr
    ? err.exitCode
    : mapErrorToExit(err);

  let detail = null;
  if (isPddErr && err.detail != null) {
    detail = redactRecursive(err.detail);
  }

  return {
    ok: false,
    command: command ?? '',
    data: null,
    error: {
      code: String(code).startsWith('E_') ? code : `E_${code}`,
      message: err?.message ?? '',
      hint: err?.hint ?? '',
      ...(detail != null ? { detail } : {}),
    },
    meta: {
      v: ENVELOPE_VERSION,
      exit_code: exitCode,
      latency_ms: meta.latency_ms ?? 0,
      xhr_count: meta.xhr_count ?? 0,
      warnings: [...(meta.warnings ?? [])],
      ...(meta.correlation_id ? { correlation_id: meta.correlation_id } : {}),
    },
  };
}
