import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';
import { isMockEnabled } from './mock-dispatcher.js';
import { getSharedClient, _resetSharedClient } from './rate-limiter-singleton.js';

export async function runEndpoint(page, meta, params = {}, ctx = {}) {
  if ((!page && !isMockEnabled()) || !meta) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'runEndpoint: page and meta are required',
      exitCode: ExitCodes.USAGE,
    });
  }

  const client = ctx.client ?? getSharedClient(ctx.runtimeConfig);
  const { data } = await client.execute(meta, params, {
    ...ctx,
    page,
    log: ctx.log ?? getLogger(),
  });
  return data;
}

export function _resetRateLimitState() {
  _resetSharedClient();
}
