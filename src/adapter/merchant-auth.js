import { collectCheckCookies, hasPassId, probeCheckLogin, probeMerchantShop } from './merchant-auth-probe.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createCandidateSeal, deepFreeze } from '../infra/candidate-seal.js';
import { isMockEnabled, mockCurrentMall } from './mock-dispatcher.js';
import { verifyFixtureMerchantContext } from './fixtures/auth.js';

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
  if (isMockEnabled()) {
    return verifyFixtureMerchantContext(context, {
      expectedMallId: options.expectedMallId,
      seal,
      getCurrentMall: mockCurrentMall,
    });
  }
  if (typeof options.createSnapshotContext !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'verifyMerchantContext 需要 createSnapshotContext',
      exitCode: ExitCodes.GENERAL,
    });
  }
  const task = { ...options, deadlineAt: options.deadlineAt ?? Date.now() + 30500 };
  const snapshot = deepFreeze(structuredClone(await context.storageState()));
  const frozenContext = await options.createSnapshotContext(context.browser(), snapshot);
  try {
    const cookies = await collectCheckCookies(frozenContext);
    if (!hasPassId(cookies)) {
      return { verdict: 'rejected', reason: 'auth_missing', checked_at: new Date().toISOString(), http_status: null };
    }
    const check = await probeCheckLogin(cookies, task);
    if (check.verdict !== 'verified') return check;
    const shop = await probeMerchantShop(frozenContext, cookies, task);
    if (shop.verdict !== 'verified') return shop;
    if (options.expectedMallId != null && String(options.expectedMallId) !== shop.identity.mallId) {
      return { verdict: 'failed', reason: 'identity_mismatch', checked_at: shop.checked_at, http_status: shop.http_status };
    }
    const candidate = seal.seal({ state: snapshot, identity: shop.identity, checked_at: shop.checked_at, scope: 'shop_read' });
    return { verdict: 'verified', reason: 'shop_read', checked_at: shop.checked_at, http_status: shop.http_status, identity: shop.identity, candidate };
  } finally { await frozenContext.close(); }
}
