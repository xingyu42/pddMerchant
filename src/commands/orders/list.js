import { withCommand } from '../_runner.js';
import { getOrderListView, ORDER_LIST_CLI_SCOPES, ORDER_LIST_DEFAULT_SCOPE } from '../../services/orders.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';

function resolveStatusScope(status) {
  const scope = status ?? ORDER_LIST_DEFAULT_SCOPE;
  if (!ORDER_LIST_CLI_SCOPES.includes(scope)) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `pdd orders list --status 不支持的取值：${scope}`,
      hint: `可选：${ORDER_LIST_CLI_SCOPES.join('|')}，例如 --status pending_ship`,
      exitCode: ExitCodes.USAGE,
    });
  }
  return scope;
}

export const run = withCommand({
  name: 'orders.list',
  needsAuth: true,
  needsMall: 'switch',
  async run(ctx) {
    const { page: pageNumber = 1, size = 20, since, until, status } = ctx.config;
    const scope = resolveStatusScope(status);
    return getOrderListView(ctx.page, { page: pageNumber, size, since, until, scope }, ctx);
  },
});

export default run;
