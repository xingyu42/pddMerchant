import { buildEnvelope, emit } from '../infra/output.js';
import {
  assertInspectionValid,
  inspectManagedConfig,
  publicConfigKeys,
  setLocalConfigValue,
  unsetLocalConfigValue,
} from '../infra/config-management.js';
import { configInspectionError } from '../infra/config.js';

function emitSuccess(command, data, opts, warnings = []) {
  const envelope = buildEnvelope({
    ok: true,
    command,
    data,
    meta: { warnings },
  });
  emit(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

function layerSummary(inspection) {
  return Object.fromEntries(
    Object.entries(inspection.layers).map(([name, layer]) => [name, { valid: layer.valid }]),
  );
}

export async function show(opts = {}, { configOptions } = {}) {
  const inspection = assertInspectionValid(await inspectManagedConfig(configOptions));
  const local = inspection.localOverrides ?? {};
  const fields = {};
  for (const key of publicConfigKeys()) {
    const hasLocalOverride = Object.hasOwn(local, key);
    const source = inspection.sources[key] ?? null;
    fields[key] = {
      effectiveValue: inspection.runtimeConfig[key] ?? null,
      source,
      hasLocalOverride,
      localOverride: hasLocalOverride ? local[key] : null,
      overridden: hasLocalOverride && source !== 'local',
    };
  }
  return emitSuccess('config.show', {
    path: 'config/config.json',
    fields,
    layers: layerSummary(inspection),
  }, opts);
}

export async function validate(opts = {}, { configOptions } = {}) {
  const inspection = await inspectManagedConfig(configOptions);
  if (!inspection.valid) throw configInspectionError(inspection);
  return emitSuccess('config.validate', {
    valid: true,
    path: 'config/config.json',
    layers: layerSummary(inspection),
  }, opts);
}

export async function set(opts = {}, { configOptions } = {}) {
  const [key, value] = opts.args ?? [];
  const result = await setLocalConfigValue(key, value, configOptions);
  const { warnings, ...data } = result;
  return emitSuccess('config.set', data, opts, warnings);
}

export async function unset(opts = {}, { configOptions } = {}) {
  const [key] = opts.args ?? [];
  const result = await unsetLocalConfigValue(key, configOptions);
  const { warnings, ...data } = result;
  return emitSuccess('config.unset', data, opts, warnings);
}
