import { createDaemonRuntime } from '../services/daemon-runtime.js';
import { createPatrol } from '../services/patrol.js';
import { createConsoleServer } from './server.js';

function watchStop(signal, stop) {
  const signals = ['SIGINT', 'SIGTERM', process.platform === 'win32' ? 'SIGBREAK' : 'SIGHUP'];
  const onSignal = () => stop('signal');
  for (const name of signals) process.on(name, onSignal);
  signal?.addEventListener('abort', onSignal, { once: true });
  if (signal?.aborted) onSignal();
  return () => {
    for (const name of signals) process.removeListener(name, onSignal);
    signal?.removeEventListener('abort', onSignal);
  };
}

async function startComponents(components, started, context, runtime) {
  await runtime.cleanupBrowsers();
  for (const component of components) {
    if (context.signal.aborted) break;
    started.push(component);
    await component.start(context);
  }
}

async function cleanup(started, runtime, token) {
  for (const component of [...started].reverse()) {
    try { await component.stop(); }
    catch { runtime.log.warn('daemon 组件停止失败'); }
  }
  try { await runtime.closeBrowsers(); }
  finally { runtime.release(token); }
}

function heartbeat(runtime, token, stop) {
  try {
    runtime.heartbeat(token);
    if (runtime.stopRequested()) stop('stop_request');
    runtime.purge();
  } catch (error) {
    runtime.log.warn({ code: error?.code ?? 'E_GENERAL' }, 'daemon 心跳失败');
    stop(error?.code === 'E_AUTH_LOCK_LOST' ? 'lease_lost' : 'heartbeat_error');
  }
}

async function runOwned(runtime, lease, { signal, components, exit, runtimeConfig }) {
  const controller = new AbortController();
  const started = [];
  let reason;
  let hardTimer;
  let finish;
  let hardFinish;
  const stopped = new Promise((resolve) => { finish = resolve; });
  const hardStop = new Promise((resolve) => { hardFinish = resolve; });
  const stop = (nextReason) => {
    if (reason) return;
    reason = nextReason;
    hardTimer = setTimeout(() => { exit(1); hardFinish(); }, 5000);
    controller.abort();
    finish();
  };
  const unwatch = watchStop(signal, stop);
  const timer = setInterval(() => heartbeat(runtime, lease.token, stop), runtime.timings.heartbeatMs);
  const context = { signal: controller.signal, ownerTag: lease.token.slice(0, 32), log: runtime.log, runtimeConfig };
  try {
    await Promise.race([startComponents(components, started, context, runtime), stopped]);
    runtime.log.info('daemon 已启动');
    await stopped;
  } finally {
    stop(reason ?? 'startup_error');
    clearInterval(timer);
    unwatch();
    try { await Promise.race([cleanup(started, runtime, lease.token), hardStop]); }
    finally { clearTimeout(hardTimer); }
  }
  return { stopped_reason: reason };
}

export async function runDaemon({ signal, components = [createConsoleServer(), createPatrol()], exit = (code) => process.exit(code),
  foreground = true, runtimeConfig } = {}) {
  const runtime = createDaemonRuntime({ foreground, runtimeConfig });
  try {
    const lease = await runtime.acquire();
    if (!lease) return { status: 'already_running' };
    try { runtime.clearStop(); }
    catch (error) { runtime.release(lease.token); throw error; }
    return await runOwned(runtime, lease, { signal, components, exit, runtimeConfig });
  } finally { runtime.closeLog(); }
}
