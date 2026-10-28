import { withCommand } from './_runner.js';
import { consoleLinkForAccount } from '../services/console-accounts.js';

export const link = withCommand({ name: 'console.link', needsAuth: false, needsBrowser: false,
  needsMall: 'none', allowAllAccounts: false, run: (ctx) => consoleLinkForAccount(ctx.config.account) });
