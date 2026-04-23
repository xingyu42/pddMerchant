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
  if (code === 'E_USAGE' || code === 'EINVAL') return ExitCodes.USAGE;
  if (code === 'E_BUSINESS' || code === 'E_NOT_FOUND') return ExitCodes.BUSINESS;
  if (code === 'E_PARTIAL') return ExitCodes.PARTIAL;
  return ExitCodes.GENERAL;
}

export function isSuccessResponse(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (raw.success === true) return true;
  if (raw.errorCode === 0) return true;
  if (raw.errorCode === 1000000) return true;
  if (raw.result !== undefined && raw.success !== false) return true;
  return false;
}
