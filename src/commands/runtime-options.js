import { loadRuntimeConfig } from '../infra/config.js';

export async function prepareCommandRuntime(opts) {
  const runtimeConfig = await loadRuntimeConfig({
    cliFlags: {
      timeoutMs: opts.timeoutMs,
      logLevel: opts.verbose ? 'debug' : undefined,
    },
  });

  if (opts.timeoutMs == null && runtimeConfig.timeoutMs != null) {
    opts.timeout = runtimeConfig.timeoutMs;
    opts.timeoutMs = runtimeConfig.timeoutMs;
  }
  if (opts.mall == null && runtimeConfig.defaultMall != null) {
    opts.mall = runtimeConfig.defaultMall;
  }
  if (opts.authStatePath == null && runtimeConfig.authStatePath != null) {
    opts.authStatePath = runtimeConfig.authStatePath;
  }

  return runtimeConfig;
}
