// 登录态校验的模拟实现（设计 D-4）。
import { ENV_AUTH_INVALID, ENV_AUTH_INDETERMINATE, ENV_CONSUMER_AUTH_INVALID } from './core.js';
import { mockCurrentMall } from './mall.js';
import { appendFile } from 'node:fs/promises';
import { abortableSleep, budgetMs } from '../../infra/abort.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { assertAuthTask, boundMerchantMallId } from '../../infra/auth-task.js';
import { createCandidateSeal, deepFreeze } from '../../infra/candidate-seal.js';

export function mockIsAuthValid() {
  return process.env[ENV_AUTH_INVALID] !== '1';
}

export function mockIsAuthIndeterminate() {
  return process.env[ENV_AUTH_INDETERMINATE] === '1';
}

export function hasFixtureRelogin(state) {
  return state?.cookies?.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN' && cookie.value === '1') ?? false;
}

// 成功获取的模拟材料仍经 merchant-auth 的候选校验和正式提交路径。
export function createFixtureReloginContext(mallId) {
  const state = { cookies: [{ name: 'PDD_FIXTURE_RELOGIN', value: '1', domain: '.pinduoduo.com', path: '/' }], origins: [] };
  return { fixtureMallId: mallId, storageState: async () => structuredClone(state) };
}

export function mockIsConsumerAuthValid() {
  return process.env[ENV_CONSUMER_AUTH_INVALID] !== '1';
}

function assertValidSeal(seal, message) {
  if (!seal || typeof seal.seal !== 'function' || typeof seal.assert !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message,
      exitCode: ExitCodes.GENERAL,
    });
  }
  return seal;
}

function resolveToggle(option, fallbackFn) {
  if (typeof option === 'function') return option;
  if (option !== undefined) return () => Boolean(option);
  return fallbackFn;
}

export async function verifyFixtureMerchantContext(sessionOrContext, {
  expectedMallId,
  seal,
  getCurrentMall = mockCurrentMall,
  state: initialState,
  signal,
  deadlineAt,
  isInvalid = () => !mockIsAuthValid(),
  isIndeterminate = mockIsAuthIndeterminate,
  now = Date.now,
} = {}) {
  assertValidSeal(seal, 'verifyFixtureMerchantContext 需要有效的 CandidateSeal 实例');
  const checkedAt = () => new Date(now()).toISOString();

  if (initialState?.merchant_auth?.last_check?.verdict === 'rejected') {
    return { verdict: 'rejected', reason: 'known_rejected', checked_at: checkedAt(), http_status: null, authoritative: false };
  }
  const boundMallId = boundMerchantMallId(initialState);
  if (boundMallId && expectedMallId != null && String(expectedMallId) !== boundMallId) {
    return { verdict: 'failed', reason: 'identity_mismatch', checked_at: checkedAt(), http_status: null, authoritative: false };
  }
  if (signal?.aborted) {
    return { verdict: 'indeterminate', reason: 'cancelled', checked_at: checkedAt(), http_status: null, authoritative: false };
  }
  if (deadlineAt != null && now() >= deadlineAt) {
    return { verdict: 'indeterminate', reason: 'deadline', checked_at: checkedAt(), http_status: null, authoritative: false };
  }

  const context = sessionOrContext?.context ?? sessionOrContext;
  const rawState = context?.storageState
    ? await context.storageState()
    : (initialState ?? { cookies: [], origins: [] });
  const state = deepFreeze(structuredClone(rawState));

  if (isIndeterminate()) {
    return { verdict: 'indeterminate', reason: 'network_error', checked_at: checkedAt(), http_status: null, authoritative: false };
  }
  if (isInvalid() && !hasFixtureRelogin(state)) {
    return { verdict: 'rejected', reason: 'login_false', checked_at: checkedAt(), http_status: 200, authoritative: false };
  }
  const resolvedExpectedMallId = expectedMallId ?? boundMallId;
  const mall = context?.fixtureMallId != null
    ? { id: context.fixtureMallId, name: '模拟店铺' }
    : await getCurrentMall();
  const mallId = mall?.activeId ?? mall?.id;
  const mallName = mall?.activeName ?? mall?.name ?? '';
  if (resolvedExpectedMallId != null && String(resolvedExpectedMallId) !== String(mallId)) {
    return { verdict: 'failed', reason: 'identity_mismatch', checked_at: checkedAt(), http_status: 200, authoritative: false };
  }
  const time = checkedAt();
  const identity = { mallId: String(mallId), displayName: mallName };
  const candidate = seal.seal({ state, identity, checked_at: time, scope: 'shop_read' });
  return {
    verdict: 'verified',
    reason: 'shop_read',
    checked_at: time,
    http_status: 200,
    identity,
    candidate,
    authoritative: false,
  };
}

/** Create the minimal 3-method Fixture AuthPort returning non-authoritative verdicts. */
export function createFixtureAuthPort({
  seal = createCandidateSeal(),
  authInvalid,
  authIndeterminate,
  consumerAuthInvalid,
  getCurrentMall = mockCurrentMall,
  now = Date.now,
} = {}) {
  const defaultSeal = assertValidSeal(seal, 'createFixtureAuthPort 需要有效的 CandidateSeal 实例');
  const isInvalid = resolveToggle(authInvalid, () => !mockIsAuthValid());
  const isIndeterminate = resolveToggle(authIndeterminate, mockIsAuthIndeterminate);
  const isConsumerInvalid = resolveToggle(consumerAuthInvalid, () => !mockIsConsumerAuthValid());
  const checkedAt = () => new Date(now()).toISOString();

  async function checkMerchant(state, options = {}) {
    if (options.signal?.aborted) {
      return { verdict: 'indeterminate', reason: 'cancelled', http_status: null, checked_at: checkedAt(), authoritative: false };
    }
    if (options.deadlineAt != null && now() >= options.deadlineAt) {
      return { verdict: 'indeterminate', reason: 'deadline', http_status: null, checked_at: checkedAt(), authoritative: false };
    }
    if (!options.force && state?.merchant_auth?.last_check?.verdict === 'rejected') {
      return { verdict: 'rejected', reason: 'known_rejected', http_status: null, checked_at: checkedAt(), authoritative: false };
    }
    if (isIndeterminate()) {
      return { verdict: 'indeterminate', reason: 'network_error', http_status: null, checked_at: checkedAt(), authoritative: false };
    }
    if (isInvalid() && !hasFixtureRelogin(state)) {
      return { verdict: 'rejected', reason: 'login_false', http_status: 200, checked_at: checkedAt(), authoritative: false };
    }
    return { verdict: 'verified', reason: 'login_true', http_status: 200, checked_at: checkedAt(), authoritative: false };
  }

  async function verifyAndSeal(sessionOrContext, options = {}) {
    return verifyFixtureMerchantContext(sessionOrContext, {
      ...options,
      seal: options.seal === undefined ? defaultSeal : options.seal,
      getCurrentMall,
      isInvalid,
      isIndeterminate,
      now,
    });
  }

  async function checkConsumerOnline() {
    return {
      ok: !isConsumerInvalid(),
      authoritative: false,
      detail: { url: null },
    };
  }

  return Object.freeze({
    checkMerchant,
    verifyAndSeal,
    checkConsumerOnline,
  });
}

export async function mockPasswordLogin(task = {}) {
  assertAuthTask(task);
  const value = process.env.PDD_TEST_PASSWORD_LOGIN ?? 'success';
  const challenge = /^challenge:(sms|slider|click|risk_confirm|unknown)$/.exec(value)?.[1];
  const outcome = ['success', 'wrong_password', 'account_locked', 'form_changed', 'network_error'].includes(value) ? value : null;
  if (!challenge && !outcome) throw new PddCliError({
    code: 'E_USAGE',
    message: 'PDD_TEST_PASSWORD_LOGIN 配置无效',
    exitCode: ExitCodes.USAGE,
  });
  const result = challenge ? { outcome: 'challenge', challenge } : { outcome };
  try {
    const trace = process.env.PDD_TEST_PASSWORD_LOGIN_TRACE;
    if (trace) await appendFile(trace, `${challenge ? `challenge:${challenge}` : outcome}\n`, { mode: 0o600 });
    const delay = Number(process.env.PDD_TEST_PASSWORD_LOGIN_DELAY_MS ?? 0);
    if (Number.isFinite(delay) && delay > 0) await abortableSleep(budgetMs(task, delay), task.signal);
    assertAuthTask(task);
    return result;
  } catch {
    assertAuthTask(task);
    return { outcome: 'network_error' };
  }
}
