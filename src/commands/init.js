import { withCommand } from './_runner.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import { loginMerchant } from '../services/auth.js';

export const run = withCommand({
  name: 'init',
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  defaultTimeoutMs: (opts) => (opts.qr ? TIMEOUTS.LOGIN_QR : TIMEOUTS.LOGIN_HEADED),
  run: (ctx) => loginMerchant(ctx.config, {
    runtime: ctx.runtime,
    signal: ctx.signal,
    deadlineAt: ctx.deadlineAt,
    log: ctx.log,
  }),
});
