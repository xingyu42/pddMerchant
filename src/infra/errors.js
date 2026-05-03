import { redactRecursive } from './logger.js';

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

export function accountNotFound(slug) {
  return new PddCliError({
    code: 'E_ACCOUNT_NOT_FOUND',
    message: `Account "${slug}" not found in registry`,
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

export function accountRegistryCorrupt(detail) {
  return new PddCliError({
    code: 'E_ACCOUNT_REGISTRY_CORRUPT',
    message: 'Account registry (accounts.json) is corrupted or invalid',
    detail,
    exitCode: ExitCodes.GENERAL,
  });
}

export function credentialDecryptFailed() {
  return new PddCliError({
    code: 'E_CREDENTIAL_DECRYPT_FAILED',
    message: 'Failed to decrypt stored credentials — wrong master password or tampered ciphertext',
    hint: 'Check PDD_MASTER_PASSWORD or re-add the account with "pdd account add"',
    exitCode: ExitCodes.AUTH,
  });
}

export function authChallengeRequired(type) {
  return new PddCliError({
    code: 'E_AUTH_CHALLENGE_REQUIRED',
    message: `Login requires interactive challenge: ${type || 'captcha/SMS/slider'}`,
    hint: 'Use QR login or complete the challenge manually',
    exitCode: ExitCodes.AUTH,
  });
}

export function passwordLoginFormChanged(detail) {
  return new PddCliError({
    code: 'E_PASSWORD_LOGIN_FORM_CHANGED',
    message: 'PDD login form structure has changed — selectors no longer match',
    detail,
    hint: 'Report this issue; fallback to QR login',
    exitCode: ExitCodes.AUTH,
  });
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
      v: 1,
      exit_code: exitCode,
      latency_ms: meta.latency_ms ?? 0,
      xhr_count: meta.xhr_count ?? 0,
      warnings: [...(meta.warnings ?? [])],
      ...(meta.correlation_id ? { correlation_id: meta.correlation_id } : {}),
    },
  };
}
