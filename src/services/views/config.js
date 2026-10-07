// 运行配置维护视图（输出契约 v2）：config show / validate / set / unset。
// fields 以公开配置字段名（camelCase，如 rateLimitQps）为键，属自由键映射；其内部键与其余键均为 snake_case。
import { labelOf } from '../../infra/units.js';
import { CONFIG_SOURCE_LABEL } from './labels.js';

export const CONFIG_FIELD_VIEW_FIELDS = Object.freeze([
  'effective_value', 'source', 'has_local_override', 'local_override', 'overridden',
]);

function sourceLabel(source) {
  return labelOf(CONFIG_SOURCE_LABEL, source);
}

export function toLayerSummaryView(inspection) {
  return Object.fromEntries(
    Object.entries(inspection.layers).map(([name, layer]) => [name, { valid: layer.valid }]),
  );
}

function toIssueView(issue) {
  return { ...issue, ...(issue.layer ? { layer: sourceLabel(issue.layer) } : {}) };
}

export function toConfigShowView(inspection, keys) {
  const local = inspection.localOverrides ?? {};
  const fields = {};
  for (const key of keys) {
    const hasLocalOverride = Object.hasOwn(local, key);
    const source = inspection.sources[key] ?? null;
    fields[key] = {
      effective_value: inspection.runtimeConfig[key] ?? null,
      source: sourceLabel(source),
      has_local_override: hasLocalOverride,
      local_override: hasLocalOverride ? local[key] : null,
      overridden: hasLocalOverride && source !== 'local',
    };
  }
  const overrides = keys.filter((key) => Object.hasOwn(local, key)).length;
  return {
    headline: [`配置有效：共 ${keys.length} 个公开字段，本地覆盖 ${overrides} 个`],
    path: 'config/config.json',
    fields,
    layers: toLayerSummaryView(inspection),
  };
}

export function toConfigValidateView(inspection) {
  return {
    headline: ['配置校验通过：基线、本地、环境变量与命令行各层均有效'],
    valid: true,
    path: 'config/config.json',
    layers: toLayerSummaryView(inspection),
  };
}

function editHeadline(result, { removing }) {
  const { key } = result;
  let first;
  if (removing) first = result.removed ? `已删除本地覆盖 ${key}` : `${key} 没有本地覆盖，未改动`;
  else first = result.changed ? `已设置本地覆盖 ${key} = ${JSON.stringify(result.localValue)}` : `${key} 的本地覆盖未变化`;
  const headline = [first];
  if (result.overridden) headline.push(`当前生效来源为${sourceLabel(result.effectiveSource)}，本地值未生效`);
  if (!result.runtimeValid) headline.push('修改后整体运行配置无效，详见 issues');
  return headline;
}

// setLocalConfigValue / unsetLocalConfigValue 的结果（不含 warnings）→ v2
export function toConfigEditView(result, { removing = false } = {}) {
  return {
    headline: editHeadline(result, { removing }),
    path: result.path,
    key: result.key,
    changed: result.changed,
    local_value: result.localValue ?? null,
    effective_source: sourceLabel(result.effectiveSource),
    overridden: result.overridden,
    runtime_valid: result.runtimeValid,
    issues: (result.issues ?? []).map(toIssueView),
    restart_required: result.restartRequired,
    ...(removing ? { removed: result.removed } : { had_local_override: result.hadLocalOverride }),
  };
}
