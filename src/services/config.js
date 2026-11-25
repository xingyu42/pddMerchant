// 运行配置维护领域服务：封装受管配置读取、校验与原子编辑，抛出 PddCliError。
import {
  assertInspectionValid,
  inspectManagedConfig,
  publicConfigKeys,
  setLocalConfigValue,
  unsetLocalConfigValue,
} from '../infra/config-management.js';
import { configInspectionError } from '../infra/config.js';
import {
  toConfigEditView,
  toConfigShowView,
  toConfigValidateView,
} from './views/config.js';

export async function showConfig(configOptions) {
  const options = configOptions ?? {};
  const inspection = assertInspectionValid(await inspectManagedConfig(options));
  return toConfigShowView(inspection, publicConfigKeys());
}

export async function validateConfig(configOptions) {
  const options = configOptions ?? {};
  const inspection = await inspectManagedConfig(options);
  if (!inspection.valid) throw configInspectionError(inspection);
  return toConfigValidateView(inspection);
}

export async function setConfigValue(key, value, configOptions) {
  const options = configOptions ?? {};
  const { warnings, ...result } = await setLocalConfigValue(key, value, options);
  return { data: toConfigEditView(result), warnings };
}

export async function unsetConfigValue(key, configOptions) {
  const options = configOptions ?? {};
  const { warnings, ...result } = await unsetLocalConfigValue(key, options);
  return { data: toConfigEditView(result, { removing: true }), warnings };
}
