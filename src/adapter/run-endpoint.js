import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';

export async function runEndpoint(page, meta, params = {}, ctx = {}) {
  if (!meta) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'runEndpoint: meta is required',
      exitCode: ExitCodes.USAGE,
    });
  }

  const client = ctx?.client;
  const hasCall = typeof client?.call === 'function';
  const hasExecute = typeof client?.execute === 'function';
  if (!hasCall && !hasExecute) {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'runEndpoint: ctx.client (EndpointPort) is required',
      hint: '请通过命令运行时或 ctx.client 注入 EndpointPort 实例',
      detail: { source: 'runtime', reason: 'client_missing', endpoint: meta?.name ?? null },
      exitCode: ExitCodes.GENERAL,
    });
  }

  const forwardedCtx = {
    ...ctx,
    page,
    log: ctx.log ?? getLogger(),
  };
  if (hasCall) {
    return client.call(meta, params, forwardedCtx);
  }
  const { data } = await client.execute(meta, params, forwardedCtx);
  return data;
}
