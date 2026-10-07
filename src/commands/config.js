import { buildEnvelope, emit } from '../infra/output.js';
import {
  assertInspectionValid,
  inspectManagedConfig,
  publicConfigKeys,
  setLocalConfigValue,
  unsetLocalConfigValue,
} from '../infra/config-management.js';
import { configInspectionError } from '../infra/config.js';
import { ExitCodes } from '../infra/errors.js';
import {
  toConfigEditView, toConfigShowView, toConfigValidateView,
} from '../services/views/config.js';

function emitSuccess(command, data, opts, warnings = []) {
  const envelope = buildEnvelope({
    ok: true,
    command,
    data,
    meta: { warnings, exit_code: ExitCodes.OK },
  });
  emit(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

export async function show(opts = {}, { configOptions } = {}) {
  const inspection = assertInspectionValid(await inspectManagedConfig(configOptions));
  return emitSuccess('config.show', toConfigShowView(inspection, publicConfigKeys()), opts);
}

export async function validate(opts = {}, { configOptions } = {}) {
  const inspection = await inspectManagedConfig(configOptions);
  if (!inspection.valid) throw configInspectionError(inspection);
  return emitSuccess('config.validate', toConfigValidateView(inspection), opts);
}

export async function set(opts = {}, { configOptions } = {}) {
  const [key, value] = opts.args ?? [];
  const { warnings, ...result } = await setLocalConfigValue(key, value, configOptions);
  return emitSuccess('config.set', toConfigEditView(result), opts, warnings);
}

export async function unset(opts = {}, { configOptions } = {}) {
  const [key] = opts.args ?? [];
  const { warnings, ...result } = await unsetLocalConfigValue(key, configOptions);
  return emitSuccess('config.unset', toConfigEditView(result, { removing: true }), opts, warnings);
}
