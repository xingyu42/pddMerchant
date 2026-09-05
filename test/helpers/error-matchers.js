import { PddCliError } from '../../src/infra/errors.js';

export const isUsageError = (error) => error instanceof PddCliError && error.code === 'E_USAGE' && error.exitCode === 2;
export const isNetworkError = (error) => error instanceof PddCliError && error.code === 'E_NETWORK' && error.exitCode === 5;
export const isAuthError = (error) => error instanceof PddCliError && error.code === 'E_AUTH_EXPIRED' && error.exitCode === 3;
export const isRateLimitError = (error) => error instanceof PddCliError && error.code === 'E_RATE_LIMIT' && error.exitCode === 4;
export const isBusinessError = (error) => error instanceof PddCliError && error.code === 'E_BUSINESS' && error.exitCode === 6;
