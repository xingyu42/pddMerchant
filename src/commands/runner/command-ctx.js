// 命令上下文组装与行动告警附加（由 live / fixture / without-browser 三路径共享）。
import { getAccountActionWarnings } from '../../services/password-relogin.js';
import { daemonIsRunning as defaultDaemonIsRunning } from '../../services/daemon.js';

export function buildCommandCtx(runtime, { client, page, mallCtx, ...extra }) {
  return {
    client,
    page,
    mallCtx,
    mallId: mallCtx?.activeId ?? null,
    accountId: runtime.accountCtx?.accountId ?? null,
    account: runtime.accountCtx?.account ?? null,
    accountSlug: runtime.accountCtx?.slug ?? null,
    config: runtime.opts,
    runtimeConfig: runtime.runtimeConfig ?? null,
    log: runtime.log,
    correlation_id: runtime.correlationId,
    warnings: runtime.warnings,
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    clock: runtime.clock ?? null,
    runtime,
    ...extra,
  };
}

export function appendActionWarnings(spec, runtime) {
  if (spec.needsAuth && runtime.accountCtx?.accountId != null) {
    const actions = getAccountActionWarnings(runtime.accountCtx.accountId, runtime.accountCtx.slug);
    runtime.warnings.push(...actions);
    const checkDaemon = typeof runtime.daemonIsRunning === 'function'
      ? runtime.daemonIsRunning
      : defaultDaemonIsRunning;
    if (actions.length && !checkDaemon() && !runtime.warnings.some((warning) => warning?.code === 'daemon_not_running')) {
      runtime.warnings.push({ code: 'daemon_not_running' });
    }
  }
}
