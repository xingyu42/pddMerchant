import { setLocalConfigValue } from '../infra/config-management.js';
import { getDaemonMeta } from '../infra/daemon-state.js';
import { consoleRequestError } from './console-runtime.js';
import { toConsolePatrolView } from './views/console.js';

// 控制台开关写入本地配置（与 pdd config set patrolEnabled 同一来源），重启后保持。
export async function savePatrolEnabled(enabled, configOptions) {
  const result = await setLocalConfigValue('patrolEnabled', String(enabled), configOptions);
  if (result.overridden) {
    throw consoleRequestError(409, 'E_CONFIG_OVERRIDDEN', '巡航开关已由环境变量或启动参数固定，控制台无法修改');
  }
}

function requirePatrol(patrol) {
  if (!patrol) throw consoleRequestError(503, 'E_PATROL_UNAVAILABLE', '巡航未随控制台启动');
  return patrol;
}

export function getConsolePatrol(patrol, runtimeConfig) {
  return toConsolePatrolView({ enabled: requirePatrol(patrol).isEnabled(),
    intervalMs: runtimeConfig.patrolIntervalMs, lastPatrolAt: getDaemonMeta('daemon_last_patrol_at') });
}

export async function setConsolePatrol(patrol, body, runtimeConfig) {
  requirePatrol(patrol);
  if (typeof body?.enabled !== 'boolean') throw consoleRequestError(400, 'E_USAGE', '巡航开关参数无效');
  await patrol.setEnabled(body.enabled);
  return getConsolePatrol(patrol, runtimeConfig);
}
