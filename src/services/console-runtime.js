import { getDaemonMeta, setDaemonMeta, clearDaemonMeta, readDaemonLease,
  readDaemonOwnerToken, withDaemonLeaseOwner, daemonBrowserOwnerTag } from '../infra/daemon-state.js';
import { isoToLocalDateTime } from '../infra/units.js';
import { PddCliError, ExitCodes, consolePortInUse, daemonNotRunning } from '../infra/errors.js';

export function isConsoleLoopback(host) {
  return host?.toLowerCase() === 'localhost' || host === '::1' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export function consoleBaseUrl(runtimeConfig, port = runtimeConfig.consolePort) {
  if (runtimeConfig.consolePublicUrl) return runtimeConfig.consolePublicUrl.replace(/\/$/, '');
  const host = runtimeConfig.consoleHost;
  return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
}

export function publishConsoleUrl(url, ownerTag) {
  const owner = readDaemonOwnerToken();
  if (ownerTag && (!owner || daemonBrowserOwnerTag(owner) !== ownerTag)) return;
  return withDaemonLeaseOwner(owner, () => {
    if (url == null) clearDaemonMeta('daemon_console_url');
    else setDaemonMeta('daemon_console_url', url);
  });
}

export function consoleHealth() {
  const lease = readDaemonLease();
  if (!lease?.running) throw daemonNotRunning();
  return { ok: true, lease: 'valid', heartbeat_at: isoToLocalDateTime(lease.heartbeat_at),
    last_patrol_at: isoToLocalDateTime(getDaemonMeta('daemon_last_patrol_at')) };
}

export function consoleRequestError(status, code, message) {
  const error = new PddCliError({ code, message, exitCode: ExitCodes.GENERAL });
  error.httpStatus = status;
  return error;
}

export function consoleListenError(error, port) {
  if (error?.code === 'EADDRINUSE') return consolePortInUse({ port, reason: 'address_in_use' });
  return consoleRequestError(500, 'E_NETWORK', '控制台监听失败，请检查监听地址与权限');
}

export function consoleApiError(error) {
  if (error?.httpStatus) return { status: error.httpStatus, body: { error: { code: error.code, message: error.message } } };
  const errors = {
    E_CONSOLE_LINK_GONE: [410, '链接已失效，请重新获取'], E_CONSOLE_LINK_EXPIRED: [410, '链接已失效，请重新获取'],
    E_ACCOUNT_NOT_FOUND: [404, '商家账号不存在'], E_USAGE: [400, '请求参数无效，请检查输入内容'],
    E_DAEMON_NOT_RUNNING: [503, 'daemon 未运行'], E_AUTH_STATE_IO: [500, '控制台存储暂不可用'],
    E_AUTH_ACCOUNT_SAVE_FAILED: [500, '账号存储暂不可用'],
  };
  const [status, message] = Object.hasOwn(errors, error?.code) ? errors[error.code] : [500, '控制台请求处理失败'];
  return { status, body: { error: { code: Object.hasOwn(errors, error?.code) ? error.code : 'E_GENERAL', message } } };
}
