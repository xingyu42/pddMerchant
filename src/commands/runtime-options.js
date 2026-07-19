import { loadRuntimeConfig } from '../infra/config.js';

export async function prepareCommandRuntime(opts) {
  const runtimeConfig = await loadRuntimeConfig({
    cliFlags: {
      timeoutMs: opts.timeoutMs,
      logLevel: opts.verbose ? 'debug' : undefined,
    },
  });

  opts.timeoutMs ??= runtimeConfig.timeoutMs;
  opts.timeout ??= opts.timeoutMs;
  opts.mall ??= runtimeConfig.defaultMall;
  opts.authStatePath ??= runtimeConfig.authStatePath;

  return runtimeConfig;
}
