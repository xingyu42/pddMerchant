import { createSnapshotContext } from './browser.js';
import { collectCheckCookies, hasPassId, probeCheckLogin, probeMerchantShop } from './merchant-auth-probe.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { isMockEnabled, mockIsAuthValid, mockIsAuthIndeterminate, mockCurrentMall } from './mock-dispatcher.js';

const verifiedCandidates = new WeakSet();

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

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

export function assertVerifiedMerchantCandidate(candidate) {
  if (!verifiedCandidates.has(candidate)) {
    throw new PddCliError({ code: 'E_AUTH_CANDIDATE_INVALID', message: '只有本次校验通过的冻结材料可以提交', exitCode: ExitCodes.AUTH });
  }
}

export async function verifyMerchantContext(context, options = {}) {
  if (isMockEnabled()) {
    if (mockIsAuthIndeterminate()) return { verdict: 'indeterminate', reason: 'network_error' };
    if (!mockIsAuthValid()) return { verdict: 'rejected', reason: 'login_false' };
    const mall = await mockCurrentMall();
    if (options.expectedMallId != null && String(options.expectedMallId) !== String(mall.id)) return { verdict: 'failed', reason: 'identity_mismatch' };
    return { verdict: 'verified', reason: 'shop_read', checked_at: new Date().toISOString(), identity: { mallId: String(mall.id), displayName: mall.name } };
  }
  const task = { ...options, deadlineAt: options.deadlineAt ?? Date.now() + 30500 };
  const snapshot = freeze(structuredClone(await context.storageState()));
  const frozenContext = await createSnapshotContext(context.browser(), snapshot);
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
    const candidate = freeze({ state: snapshot, identity: shop.identity, checked_at: shop.checked_at, scope: 'shop_read' });
    verifiedCandidates.add(candidate);
    return { verdict: 'verified', reason: 'shop_read', checked_at: shop.checked_at, http_status: shop.http_status, identity: shop.identity, candidate };
  } finally { await frozenContext.close(); }
}
