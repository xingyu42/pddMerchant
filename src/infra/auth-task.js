import { PddCliError, ExitCodes } from './errors.js';

/** Reject cancelled or expired authentication tasks before side effects. */
export function assertAuthTask({ signal, deadlineAt } = {}) {
  const expired = (deadlineAt != null && Date.now() >= deadlineAt)
    || (signal?.aborted && signal.reason instanceof PddCliError && signal.reason.code === 'E_AUTH_TIMEOUT');
  if (signal?.aborted || expired) {
    throw new PddCliError({
      code: expired ? 'E_AUTH_TIMEOUT' : 'E_AUTH_CANCELLED',
      message: expired ? '认证任务超过截止时间' : '认证任务已取消',
      exitCode: ExitCodes.NETWORK,
    });
  }
}
