import { withCommand } from './_runner.js';
import {
  listAccounts,
  removeAccount,
  setDefaultAccount,
} from '../services/account.js';

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
