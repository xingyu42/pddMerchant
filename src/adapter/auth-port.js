import {
  collectCheckCookies,
  hasPassId,
  probeCheckLogin,
  probeMerchantShop,
  selectCheckCookiesFromState,
} from './merchant-auth-probe.js';
import { createCandidateSeal, deepFreeze } from '../infra/candidate-seal.js';
import { boundMerchantMallId } from '../infra/auth-task.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { getLogger } from '../infra/logger.js';

const CONSUMER_HOME = 'https://mobile.yangkeduo.com';

function assertSealInstance(seal, message) {
  if (!seal || typeof seal.seal !== 'function' || typeof seal.assert !== 'function') {
    throw new PddCliError({ code: 'E_CONFIG_INVALID', message, exitCode: ExitCodes.GENERAL });
  }
  return seal;
}

function resolveSnapshotFactory(target, context, options) {
  if (typeof target?.createSnapshotContext === 'function') {
    return (snapshot) => target.createSnapshotContext(snapshot);
  }
  if (typeof options.createSnapshotContext === 'function') {
    return (snapshot) => options.createSnapshotContext(context?.browser?.(), snapshot);
  }
  throw new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: 'verifyMerchantContext 需要 createSnapshotContext',
    exitCode: ExitCodes.GENERAL,
  });
}

function precheckStoredState(state, expectedMallId, authoritative, nowIso) {
  if (state?.merchant_auth?.last_check?.verdict === 'rejected') {
    return {
      shortCircuit: {
        verdict: 'rejected',
        reason: 'known_rejected',
        checked_at: nowIso(),
        http_status: null,
        authoritative,
      },
      boundMallId: null,
    };
  }
  const boundMallId = boundMerchantMallId(state);
  if (boundMallId && expectedMallId != null && String(expectedMallId) !== boundMallId) {
    return {
      shortCircuit: {
        verdict: 'failed',
        reason: 'identity_mismatch',
        checked_at: nowIso(),
        http_status: null,
        authoritative,
      },
      boundMallId,
    };
  }
  return { shortCircuit: null, boundMallId };
}

export async function verifyLiveMerchantContext(target, options = {}, deps = {}) {
  const seal = assertSealInstance(options.seal, 'verifyMerchantContext 需要有效的 CandidateSeal 实例');
  const now = deps.now ?? Date.now;
  const nowIso = () => new Date(now()).toISOString();
  const collectCookies = deps.collectCookies ?? collectCheckCookies;
  const probeLogin = deps.probeLogin ?? probeCheckLogin;
  const probeShop = deps.probeShop ?? probeMerchantShop;

  const precheck = precheckStoredState(options.state, options.expectedMallId, true, nowIso);
  if (precheck.shortCircuit) return precheck.shortCircuit;

  const context = target?.context ?? target;
  if (!context || typeof context.storageState !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: 'verifyMerchantContext 需要有效的浏览器会话上下文',
      exitCode: ExitCodes.GENERAL,
    });
  }
  const createSnapshot = resolveSnapshotFactory(target, context, options);
  const expectedMallId = options.expectedMallId ?? precheck.boundMallId;
  const task = { ...options, deadlineAt: options.deadlineAt ?? now() + 30500 };

  const snapshot = deepFreeze(structuredClone(await context.storageState()));
  const frozenContext = await createSnapshot(snapshot);
  try {
    const cookies = await collectCookies(frozenContext);
    if (!hasPassId(cookies)) {
      return { verdict: 'rejected', reason: 'auth_missing', checked_at: nowIso(), http_status: null, authoritative: true };
    }
    const check = await probeLogin(cookies, task);
    if (check.verdict !== 'verified') return { ...check, authoritative: true };
    const shop = await probeShop(frozenContext, cookies, task);
    if (shop.verdict !== 'verified') return { ...shop, authoritative: true };
    if (expectedMallId != null && String(expectedMallId) !== shop.identity.mallId) {
      return {
        verdict: 'failed',
        reason: 'identity_mismatch',
        checked_at: shop.checked_at,
        http_status: shop.http_status,
        authoritative: true,
      };
    }
    const candidate = seal.seal({ state: snapshot, identity: shop.identity, checked_at: shop.checked_at, scope: 'shop_read' });
    return {
      verdict: 'verified',
      reason: 'shop_read',
      checked_at: shop.checked_at,
      http_status: shop.http_status,
      identity: shop.identity,
      candidate,
      authoritative: true,
    };
  } finally {
    await frozenContext.close();
  }
}

export async function checkLiveConsumerOnline(target, {
  timeoutMs = 15000,
  consumerHomeUrl = CONSUMER_HOME,
  log,
} = {}) {
  const page = target?.page ?? target;
  try {
    await page.goto(consumerHomeUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const url = typeof page.url === 'function' ? page.url() : null;
    return {
      ok: typeof url === 'string' && !url.includes('/login'),
      authoritative: true,
      detail: { url: url ?? null },
    };
  } catch (err) {
    (log ?? getLogger()).debug({ err: err?.message }, 'isConsumerAuthValid navigation failed');
    return {
      ok: false,
      authoritative: true,
      detail: { url: null },
    };
  }
}

/** Create the minimal 3-method Live AuthPort backed by protocol probes and instance-scoped CandidateSeal. */
export function createLiveAuthPort({
  seal = createCandidateSeal(),
  probeLogin = probeCheckLogin,
  probeShop = probeMerchantShop,
  collectCookies = collectCheckCookies,
  selectCookies = selectCheckCookiesFromState,
  consumerHomeUrl = CONSUMER_HOME,
  now = Date.now,
  log,
} = {}) {
  const defaultSeal = assertSealInstance(seal, 'createLiveAuthPort 需要有效的 CandidateSeal 实例');
  const nowIso = () => new Date(now()).toISOString();

  async function checkMerchant(state, options = {}) {
    if (options.signal?.aborted) {
      return { verdict: 'indeterminate', reason: 'cancelled', http_status: null, checked_at: nowIso(), authoritative: true };
    }
    if (options.deadlineAt != null && now() >= options.deadlineAt) {
      return { verdict: 'indeterminate', reason: 'deadline', http_status: null, checked_at: nowIso(), authoritative: true };
    }
    if (!options.force && state?.merchant_auth?.last_check?.verdict === 'rejected') {
      return { verdict: 'rejected', reason: 'known_rejected', http_status: null, checked_at: nowIso(), authoritative: true };
    }
    const cookies = selectCookies(state, { now: now() });
    const result = await probeLogin(cookies, options);
    return { ...result, authoritative: true };
  }

  async function verifyAndSeal(sessionOrContext, options = {}) {
    return verifyLiveMerchantContext(
      sessionOrContext,
      { ...options, seal: options.seal === undefined ? defaultSeal : options.seal },
      { now, collectCookies, probeLogin, probeShop },
    );
  }

  async function checkConsumerOnline(target, options = {}) {
    return checkLiveConsumerOnline(target, { ...options, consumerHomeUrl, log });
  }

  return Object.freeze({
    checkMerchant,
    verifyAndSeal,
    checkConsumerOnline,
  });
}
