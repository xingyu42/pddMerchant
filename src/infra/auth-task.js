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

/** Validate and extract bound merchant mall_id metadata from a stored auth state object. */
export function boundMerchantMallId(state) {
  const metadata = state?.merchant_auth;
  if (!metadata) return null;
  if (metadata.version !== 1 || (metadata.mall_id != null && !/^[1-9][0-9]{0,14}$/.test(String(metadata.mall_id)))) {
    throw new PddCliError({ code: 'E_AUTH_STATE_CORRUPT', message: '商家登录态绑定元数据格式无效', exitCode: ExitCodes.AUTH });
  }
  return metadata.mall_id == null ? null : String(metadata.mall_id);
}
