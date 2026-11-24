import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { verifyLiveMerchantContext } from './auth-port.js';

const defaultCandidateSeal = createCandidateSeal();

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

export function assertVerifiedMerchantCandidate(candidate, seal = defaultCandidateSeal) {
  if (!seal || typeof seal.assert !== 'function') {
    throw new PddCliError({ code: 'E_AUTH_CANDIDATE_INVALID', message: '只有本次校验通过的冻结材料可以提交', exitCode: ExitCodes.AUTH });
  }
  seal.assert(candidate);
}

export async function verifyMerchantContext(context, options = {}) {
  const seal = options.seal === undefined ? defaultCandidateSeal : options.seal;
  if (!seal || typeof seal.seal !== 'function') {
    throw new PddCliError({ code: 'E_CONFIG_INVALID', message: 'verifyMerchantContext 需要有效的 CandidateSeal 实例', exitCode: ExitCodes.GENERAL });
  }
  return verifyLiveMerchantContext(context, { ...options, seal });
}
