import { withCommand } from './_runner.js';
import { startDaemon, stopDaemon, getDaemonStatus } from '../services/daemon.js';
import { toDaemonRunView } from '../services/views/daemon.js';
import { runDaemon } from '../daemon/run.js';

const options = { needsAuth: false, needsMall: 'none', needsBrowser: false, allowAllAccounts: false };

export const start = withCommand({ ...options, name: 'daemon.start',
  run: (ctx) => startDaemon(ctx) });
export const stop = withCommand({ ...options, name: 'daemon.stop',
  run: (ctx) => stopDaemon(ctx) });
export const status = withCommand({ ...options, name: 'daemon.status',
  run: (ctx) => getDaemonStatus(ctx.runtimeConfig) });
export const run = withCommand({ ...options, name: 'daemon.run',
  async run(ctx) { return toDaemonRunView(await runDaemon(ctx)); } });
