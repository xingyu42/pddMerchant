import { PddCliError, ExitCodes } from './errors.js';

/** Reject cancelled or expired authentication tasks before side effects. */
export function assertAuthTask({ signal, deadlineAt, clock } = {}) {
  const now = clock?.now ? clock.now() : Date.now();
  const expired = (deadlineAt != null && now >= deadlineAt)
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

/** Throw the canonical merchant authentication error when a verification result is not verified. */
export function assertMerchantVerified(result, { detail } = {}) {
  if (result?.verdict === 'verified') return;
  const expired = result?.verdict === 'rejected';
  const mismatch = result?.reason === 'identity_mismatch';
  const business = result?.verdict === 'failed' && !mismatch;
  throw new PddCliError({
    code: mismatch ? 'E_ACCOUNT_IDENTITY_MISMATCH' : business ? 'E_AUTH_BUSINESS_VERIFY_FAILED' : expired ? 'E_AUTH_EXPIRED' : 'E_AUTH_CHECK_INDETERMINATE',
    message: mismatch ? '登录店铺与当前账号绑定不一致' : business ? '登录有效，但店铺信息读取被拒绝' : expired ? '登录态已失效' : '无法确认登录及店铺读取状态',
    hint: business ? '确认账号有店铺信息查看权限后重试，不要把权限不足当作登录失效' : expired || mismatch ? '使用正确店铺重新执行 pdd login' : '检查网络后重试；此结果不代表登录已失效',
    detail: detail ?? { reason: result?.reason ?? 'unknown', verdict: result?.verdict ?? 'indeterminate', http_status: result?.http_status ?? null },
    exitCode: expired || mismatch ? ExitCodes.AUTH : business ? ExitCodes.BUSINESS : ExitCodes.NETWORK,
  });
}
