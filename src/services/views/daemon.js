import { isoToLocalDateTime } from '../../infra/units.js';

export const DAEMON_STATUS_VIEW_FIELDS = Object.freeze([
  'headline', 'running', 'pid', 'started_at', 'heartbeat_at', 'last_patrol_at', 'console_url', 'patrol_enabled',
]);

export function toDaemonStatusView(lease, { lastPatrolAt, consoleUrl, patrolEnabled } = {}) {
  return {
    headline: [lease?.running ? 'daemon 正在运行' : 'daemon 已停止'],
    running: lease?.running === true,
    pid: lease?.pid ?? null,
    started_at: isoToLocalDateTime(lease?.acquired_at),
    heartbeat_at: isoToLocalDateTime(lease?.heartbeat_at),
    last_patrol_at: isoToLocalDateTime(lastPatrolAt),
    console_url: lease?.running ? consoleUrl ?? null : null,
    patrol_enabled: patrolEnabled === true,
  };
}

export function toDaemonStartView(status, started) {
  return { ...status, headline: [started ? 'daemon 已启动' : 'daemon 已在运行'], started };
}

export function toDaemonStopView(stopped, forced = false) {
  return {
    headline: [stopped ? 'daemon 已停止' : 'daemon 当前已停止'],
    stopped, running: false, ...(forced ? { forced: true } : {}),
  };
}

export function toDaemonRestartView(status, stopped) {
  return { ...status, headline: [stopped.stopped ? 'daemon 已重启' : 'daemon 已启动'], restarted: stopped.stopped,
    ...(stopped.forced ? { forced: true } : {}) };
}

export function toDaemonRunView(result) {
  return { headline: [result.status === 'already_running' ? 'daemon 已在运行' : 'daemon 前台运行已结束'],
    stopped_reason: result.status === 'already_running' ? result.status : result.stopped_reason };
}
