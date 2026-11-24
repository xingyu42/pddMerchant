import { assertMerchantVerified } from '../adapter/merchant-auth.js';
import { verifyStoredMerchant, recordMerchantCheck } from '../adapter/merchant-auth-storage.js';
import { assertAuthTask } from '../infra/auth-task.js';
import { probeCheckLogin, selectCheckCookiesFromState } from '../adapter/merchant-auth-probe.js';
import { recover } from './auto-relogin.js';

// 核验已保存材料并记录非 verified 结果；login 把明确失效交回人工授权，command/patrol 进入重登。
// 只读核验（doctor、成功后的复核）直接调用 adapter，不经过本模块。
export async function checkMerchantSession(context, {
  tx,
  task = {},
  mode = 'command',
  runtime = task,
  browser,
  session,
  recoverFn = recover,
} = {}) {
  const verifyContext = task.verifyContext ?? runtime?.ports?.auth?.verifyAndSeal;
  const effectiveTask = verifyContext && !task.verifyContext ? { ...task, verifyContext } : task;
  const result = await verifyStoredMerchant(context, tx.state, effectiveTask);
  if (mode === 'patrol') assertAuthTask(task);
  if (result.verdict !== 'verified') recordMerchantCheck(result, tx);
  if (result.verdict === 'rejected') {
    if (mode === 'login') return { result };
    const replacement = await recoverFn({
      tx,
      runtime,
      authResult: result,
      session,
      browser,
      retainContext: mode !== 'patrol',
    });
    return { result, replacement, mallId: tx.state?.merchant_auth?.mall_id };
  }
  assertMerchantVerified(result);
  return { result, mallId: result.identity.mallId };
}

// 巡检第一阶段只探测存活；返回 false 后才允许调用方创建浏览器。
export async function probeMerchantSession(tx, task) {
  assertAuthTask(task);
  if (tx.state?.merchant_auth?.last_check?.verdict === 'rejected') return false;
  let result;
  try {
    const checkMerchant = task?.authPort?.checkMerchant ?? task?.ports?.auth?.checkMerchant;
    if (typeof checkMerchant === 'function') {
      result = await checkMerchant(tx.state, { signal: task.signal, deadlineAt: task.deadlineAt });
    } else {
      const cookies = selectCheckCookiesFromState(tx.state);
      result = await probeCheckLogin(cookies, { signal: task.signal, deadlineAt: task.deadlineAt });
    }
  } catch (error) {
    if (error?.code === 'E_AUTH_CANDIDATE_INVALID') return false;
    throw error;
  }
  assertAuthTask(task);
  if (result.verdict === 'verified') return true;
  recordMerchantCheck(result, tx);
  if (result.verdict === 'rejected') return false;
  assertMerchantVerified(result);
}
