import { composeCommandRuntime } from '../runtime/command-runtime.js';

export async function prepareCommandRuntime(opts = {}, {
  runtimeConfigPolicy = 'required',
  env = process.env,
  streams,
  clock,
  configOptions,
} = {}) {
  const runtime = await composeCommandRuntime({
    env,
    streams,
    clock,
    runtimeConfigPolicy,
    configOptions: configOptions ?? {
      cliFlags: {
        timeoutMs: opts.timeoutMs,
        logLevel: opts.verbose ? 'debug' : undefined,
      },
    },
  });

  if (runtime.runtimeConfig) {
    opts.timeoutMs ??= runtime.runtimeConfig.timeoutMs;
    opts.timeout ??= opts.timeoutMs;
    opts.mall ??= runtime.runtimeConfig.defaultMall;
  }

  return runtime;
}
