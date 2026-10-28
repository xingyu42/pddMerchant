import { PddCliError, ExitCodes } from './errors.js';

function anySignal(signals) {
  const filtered = signals.filter(Boolean);
  const noop = () => {};
  if (filtered.length === 0) return { signal: null, dispose: noop };
  if (filtered.length === 1) return { signal: filtered[0], dispose: noop };
  if (typeof AbortSignal.any === 'function') return { signal: AbortSignal.any(filtered), dispose: noop };
  const controller = new AbortController();
  const listeners = [];
  const dispose = () => {
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
  };
  for (const source of filtered) {
    if (source.aborted) { controller.abort(source.reason); dispose(); break; }
    const listener = () => { controller.abort(source.reason); dispose(); };
    listeners.push([source, listener]);
    source.addEventListener('abort', listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

export function armDeadline(opts, parentSignal, startedAt) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : null;
  const abortController = timeoutMs ? new AbortController() : null;
  let deadlineTimer = null;
  let deadlineAt = timeoutMs ? startedAt + timeoutMs : null;
  let remaining = null;
  const arm = () => { deadlineTimer = setTimeout(() => abortController.abort(), Math.max(0, deadlineAt - Date.now())); };
  if (timeoutMs) arm();
  const { signal, dispose } = anySignal([parentSignal, abortController?.signal]);
  return {
    signal,
    get deadlineAt() { return deadlineAt; },
    pause() {
      if (!timeoutMs || remaining !== null) return;
      throwIfAborted(signal);
      remaining = Math.max(0, deadlineAt - Date.now());
      if (remaining === 0) throw timeoutError();
      clearTimeout(deadlineTimer);
      deadlineAt = null;
    },
    resume() {
      if (!timeoutMs || remaining === null) return;
      deadlineAt = Date.now() + remaining;
      remaining = null;
      arm();
    },
    dispose() { clearTimeout(deadlineTimer); dispose(); },
  };
}

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
