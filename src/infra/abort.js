import { PddCliError, ExitCodes } from './errors.js';

export function timeoutError(message) {
  return new PddCliError({
    code: 'E_TIMEOUT',
    message: message ?? '命令超时',
    exitCode: ExitCodes.NETWORK,
  });
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw timeoutError();
}

export function remainingMs(ctx) {
  if (!ctx?.deadlineAt) return Infinity;
  return Math.max(0, ctx.deadlineAt - Date.now());
}

export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(timeoutError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(timeoutError());
    }, { once: true });
  });
}
