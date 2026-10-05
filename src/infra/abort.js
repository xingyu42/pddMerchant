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

// 单步超时预算：不超过 capMs，也不越过 ctx.deadlineAt；至少 1ms 以便下游计时器正常触发。
export function budgetMs(ctx, capMs = Infinity) {
  return Math.max(1, Math.min(capMs, remainingMs(ctx)));
}

export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(timeoutError());
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(timeoutError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
