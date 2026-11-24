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

function emitSuccess(command, data, opts, warnings = [], runtime = null) {
  const envelope = buildEnvelope({
    ok: true,
    command,
    data,
    meta: { warnings, exit_code: ExitCodes.OK },
  }, {
    debugRaw: Boolean(runtime?.env?.debugRaw),
    onRawDebug: runtime?.outputSink ? (entry) => runtime.outputSink.writeDebugRaw(entry) : undefined,
  });
  const emitResult = runtime?.outputSink?.emit ?? emit;
  emitResult(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

export async function show(opts = {}, { configOptions, runtime } = {}) {
  const inspection = assertInspectionValid(await inspectManagedConfig(configOptions));
  return emitSuccess('config.show', toConfigShowView(inspection, publicConfigKeys()), opts, [], runtime);
}

export async function validate(opts = {}, { configOptions, runtime } = {}) {
  const inspection = await inspectManagedConfig(configOptions);
  if (!inspection.valid) throw configInspectionError(inspection);
  return emitSuccess('config.validate', toConfigValidateView(inspection), opts, [], runtime);
}

export async function set(opts = {}, { configOptions, runtime } = {}) {
  const [key, value] = opts.args ?? [];
  const { warnings, ...result } = await setLocalConfigValue(key, value, configOptions);
  return emitSuccess('config.set', toConfigEditView(result), opts, warnings, runtime);
}

export async function unset(opts = {}, { configOptions, runtime } = {}) {
  const [key] = opts.args ?? [];
  const { warnings, ...result } = await unsetLocalConfigValue(key, configOptions);
  return emitSuccess('config.unset', toConfigEditView(result, { removing: true }), opts, warnings, runtime);
}
