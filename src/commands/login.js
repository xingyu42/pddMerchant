import { withCommand } from './_runner.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { loginConsumer, loginMerchant } from '../services/auth.js';

export const run = withCommand({
  command: (opts) => (opts.consumer ? 'login.consumer' : 'login'),
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  defaultTimeoutMs: (opts) => (opts.qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED),
  run: (ctx) => (ctx.config.consumer
    ? loginConsumer(ctx.config, {
        runtime: ctx.runtime,
        signal: ctx.signal,
        deadlineAt: ctx.deadlineAt,
        log: ctx.log,
      })
    : loginMerchant(ctx.config, {
        runtime: ctx.runtime,
        signal: ctx.signal,
        deadlineAt: ctx.deadlineAt,
        log: ctx.log,
      })),
});
