import { abortableSleep } from './abort.js';
import { PddCliError, ExitCodes } from './errors.js';

/** Create the default system clock backed by Date.now and abortableSleep. */
export function createSystemClock() {
  return Object.freeze({
    now: () => Date.now(),
    sleep: (ms, signal) => abortableSleep(ms, signal),
  });
}

/** Validate and freeze a caller-provided clock seam, filling omitted methods with system defaults. */
export function resolveClock(clock) {
  if (clock == null) return createSystemClock();
  if (typeof clock !== 'object' || Array.isArray(clock)) {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'clock override must be an object with now() and/or sleep(ms, signal)',
      detail: { source: 'runtime', reason: 'invalid_clock' },
      exitCode: ExitCodes.GENERAL,
    });
  }
  if (clock.now !== undefined && typeof clock.now !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'clock.now must be a function',
      detail: { source: 'runtime', reason: 'invalid_clock', field: 'now' },
      exitCode: ExitCodes.GENERAL,
    });
  }
  if (clock.sleep !== undefined && typeof clock.sleep !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'clock.sleep must be a function',
      detail: { source: 'runtime', reason: 'invalid_clock', field: 'sleep' },
      exitCode: ExitCodes.GENERAL,
    });
  }
  return Object.freeze({
    now: clock.now ? clock.now.bind(clock) : (() => Date.now()),
    sleep: clock.sleep ? clock.sleep.bind(clock) : abortableSleep,
  });
}
