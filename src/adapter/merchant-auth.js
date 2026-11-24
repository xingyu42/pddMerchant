import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createCandidateSeal } from '../infra/candidate-seal.js';
import { assertMerchantVerified } from '../infra/auth-task.js';
import { verifyLiveMerchantContext } from './auth-port.js';

const defaultCandidateSeal = createCandidateSeal();

export { assertMerchantVerified };

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
