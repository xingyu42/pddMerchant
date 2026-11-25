import { withCommand } from './_runner.js';
import { TIMEOUTS } from '../infra/timeouts.js';
import {
  addAccount,
  listAccounts,
  removeAccount,
  setDefaultAccount,
} from '../services/account.js';

export const add = withCommand({
  name: 'account.add',
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  defaultTimeoutMs: TIMEOUTS.LOGIN_HEADED,
  run: (ctx) => addAccount(ctx.config, {
    runtime: ctx.runtime,
    signal: ctx.signal,
    deadlineAt: ctx.deadlineAt,
    log: ctx.log,
  }),
});

export const remove = withCommand({
  name: 'account.remove',
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  run: (ctx) => removeAccount(ctx.config, { confirm: ctx.config.confirm === true }),
});

export const list = withCommand({
  name: 'account.list',
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  run: () => listAccounts(),
});

export const setDefault = withCommand({
  name: 'account.default',
  lifecycle: 'local',
  needsAccount: 'none',
  needsMall: 'none',
  run: (ctx) => setDefaultAccount(ctx.config),
});
