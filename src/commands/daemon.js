import { withCommand } from './_runner.js';
import { startDaemon, stopDaemon, restartDaemon, getDaemonStatus } from '../services/daemon.js';
import { toDaemonRunView } from '../services/views/daemon.js';
import { runDaemon } from '../daemon/run.js';
import { isConsoleLoopback } from '../services/console-runtime.js';

const options = { needsAuth: false, needsMall: 'none', needsBrowser: false, allowAllAccounts: false };

async function launch(ctx, operation) {
  const data = await operation(ctx);
  if (!isConsoleLoopback(ctx.runtimeConfig.consoleHost)) ctx.warnings.push({ code: 'console_plaintext_http' });
  return data;
}

export const start = withCommand({ ...options, name: 'daemon.start',
  run: (ctx) => launch(ctx, startDaemon) });
export const restart = withCommand({ ...options, name: 'daemon.restart',
  run: (ctx) => launch(ctx, restartDaemon) });
export const stop = withCommand({ ...options, name: 'daemon.stop',
  run: (ctx) => stopDaemon(ctx) });
export const status = withCommand({ ...options, name: 'daemon.status',
  run: (ctx) => getDaemonStatus(ctx.runtimeConfig) });
export const run = withCommand({ ...options, name: 'daemon.run',
  async run(ctx) { return toDaemonRunView(await runDaemon(ctx)); } });
