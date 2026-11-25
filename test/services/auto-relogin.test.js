import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';
import { insertAccount, getReloginState, listPendingActions } from '../../src/infra/account-store.js';
import { get } from '../../src/infra/db.js';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';
import { armDeadline } from '../../src/infra/abort.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { withMerchantAuthUpdate, commitMerchantCandidate } from '../../src/adapter/merchant-auth-storage.js';
import { setAccountPassword } from '../../src/services/relogin-policy.js';
import { recover } from '../../src/services/auto-relogin.js';
import { createInMemoryAuthPort, createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

const credential = { loginName: 'synthetic-auto-login', password: 'synthetic-auto-password' };
const deviceCookie = { name: 'device_id', value: 'trusted-device', domain: '.pinduoduo.com', path: '/' };
const stalePassCookie = { name: 'PASS_ID', value: 'expired-pass', domain: '.pinduoduo.com', path: '/' };
const newPassCookie = { name: 'PASS_ID', value: 'fresh-pass', domain: '.pinduoduo.com', path: '/' };

function makeTrackedBrowser() {
  const base = createInMemoryBrowserRuntime();
  const createdContexts = [];
  const openedSessions = [];
  const closedSessions = [];
  const closedContexts = [];
  const closedPages = [];

  function wrapContext(ctx) {
    const origNewPage = ctx.newPage.bind(ctx);
    const origClose = ctx.close.bind(ctx);
    const wrapped = {
      ...ctx,
      async newPage() {
        const page = await origNewPage();
        const origPageClose = page.close.bind(page);
        return {
          ...page,
          context: () => wrapped,
          async close() {
            closedPages.push(page);
            return origPageClose();
          },
        };
      },
      async close() {
        closedContexts.push(wrapped);
        return origClose();
      },
    };
    createdContexts.push(wrapped);
    return wrapped;
  }

  return {
    ...base,
    createdContexts,
    openedSessions,
    closedSessions,
    closedContexts,
    closedPages,
    async openSession(options = {}) {
      const real = await base.openSession(options);
      const wrappedContext = wrapContext(real.context);
      const origCreateSnapshot = real.createSnapshotContext.bind(real);
      const origClose = real.close.bind(real);
      const wrappedSession = {
        ...real,
        context: wrappedContext,
        page: {
          ...real.page,
          context: () => wrappedContext,
          async close() {
            closedPages.push(real.page);
            return real.page.close();
          },
        },
        async createSnapshotContext(state) {
          return wrapContext(await origCreateSnapshot(state));
        },
        async close() {
          closedSessions.push(wrappedSession);
          return origClose();
        },
      };
      openedSessions.push(wrappedSession);
      return wrappedSession;
    },
  };
}

let account;
beforeEach(() => {
  account = insertAccount({ identity: '900001', displayName: 'Auto Shop' });
  saveAuthStateSnapshot({
    cookies: [stalePassCookie, deviceCookie],
    origins: [{ origin: 'https://mms.pinduoduo.com', localStorage: [{ name: 'dev', value: '1' }] }],
  }, account.id);
  setAccountPassword(account.id, credential);
});

describe('auto-relogin recover', () => {
  it('pauses outer budget, reserves 20s of 90s child budget, strips PASS_ID, closes loginPage before verifyAndSeal, commits atomically, and renews lease', async () => {
    const seal = createCandidateSeal();
    const browserPort = makeTrackedBrowser();
    const events = [];
    let nowMs = Date.parse('2026-11-24T10:00:00.000Z');
    const clock = { now: () => nowMs, sleep: async () => {} };

    const baseAuth = createInMemoryAuthPort({
      seal,
      authoritative: true,
      requirePassId: true,
      merchantIdentity: { mallId: '900001', displayName: 'Auto Shop' },
      now: clock.now,
    });
    const authPort = {
      ...baseAuth,
      async verifyAndSeal(target, options) {
        events.push({ step: 'verifyAndSeal', closedPages: browserPort.closedPages.length, expectedMallId: options.expectedMallId });
        return baseAuth.verifyAndSeal(target, options);
      },
    };
    const commitCalls = [];
    const commit = (candidate, draft) => {
      commitCalls.push({ candidate, draftSeal: draft.seal });
      return commitMerchantCandidate(candidate, draft);
    };

    const deadline = armDeadline({ timeoutMs: 500 }, null, nowMs, clock);
    const runtime = {
      deadline,
      signal: deadline.signal,
      get deadlineAt() { return deadline.deadlineAt; },
      runtimeConfig: { passwordReloginMinIntervalMs: 1_800_000 },
      clock,
    };

    try {
      await withMerchantAuthUpdate(account.id, async (tx) => {
        const beforeLease = get('SELECT expires_at FROM leases WHERE scope = ? AND key = ?', 'account', String(account.id));
        const session = await browserPort.openSession({ storageState: tx.state });
        nowMs += 200; // 200ms elapsed on outer budget (300ms remaining)

        const replacement = await recover({
          tx,
          runtime,
          session,
          authPort,
          browserPort,
          seal,
          commit,
          clock,
          retainContext: true,
          passwordLogin: async (page, cred, task) => {
            events.push({
              step: 'passwordLogin',
              deadlinePaused: deadline.deadlineAt === null,
              loginBudgetMs: task.deadlineAt - nowMs,
              credMatch: cred.loginName === credential.loginName && cred.password === credential.password,
            });
            assert.equal(task.deadlineAt, nowMs + TIMEOUTS.LOGIN_PASSWORD - TIMEOUTS.LOGIN_PASSWORD_RESERVE);
            await page.context().addCookies([newPassCookie]);
            nowMs += 5000; // Exceeds outer 500ms budget, inside 90s relogin budget
            return { outcome: 'success' };
          },
        });

        assert.ok(replacement?.context);
        assert.ok(replacement?.page);
        assert.equal(deadline.deadlineAt, nowMs + 300);
        assert.equal(tx.signal, runtime.signal);
        assert.equal(tx.deadlineAt, runtime.deadlineAt);
        assert.equal(browserPort.launches.length, 1);
        assert.deepEqual(events[0], {
          step: 'passwordLogin',
          deadlinePaused: true,
          loginBudgetMs: TIMEOUTS.LOGIN_PASSWORD - TIMEOUTS.LOGIN_PASSWORD_RESERVE,
          credMatch: true,
        });
        assert.deepEqual(events[1], {
          step: 'verifyAndSeal',
          closedPages: 1,
          expectedMallId: '900001',
        });
        assert.equal(commitCalls.length, 1);
        assert.equal(seal.has(commitCalls[0].candidate), true);
        assert.equal(tx.revision, 2);
        const saved = loadAuthState(account.id);
        assert.equal(saved.revision, 2);
        assert.equal(saved.state.cookies.some((c) => c.value === 'fresh-pass'), true);
        assert.equal(saved.state.cookies.some((c) => c.value === 'expired-pass'), false);
        assert.equal(saved.state.cookies.some((c) => c.value === 'trusted-device'), true);
        assert.equal(getReloginState(account.id).reason, 'success');
        const afterLease = get('SELECT expires_at FROM leases WHERE scope = ? AND key = ?', 'account', String(account.id));
        assert.ok(Date.parse(afterLease.expires_at) > Date.parse(beforeLease.expires_at));
        assert.equal(browserPort.closedContexts.length, 0);
        await session.close();
      }, { signal: runtime.signal, deadlineAt: runtime.deadlineAt, clock, seal });
    } finally {
      deadline.dispose();
    }
  });

  it('closes temporary browser context when retainContext is false', async () => {
    const seal = createCandidateSeal();
    const browserPort = makeTrackedBrowser();
    const clock = { now: () => Date.parse('2026-11-24T10:00:00.000Z'), sleep: async () => {} };
    const authPort = createInMemoryAuthPort({ seal, authoritative: false, requirePassId: false, now: clock.now });

    await withMerchantAuthUpdate(account.id, async (tx) => {
      const result = await recover({
        tx,
        runtime: { clock, runtimeConfig: { passwordReloginMinIntervalMs: 1_800_000 } },
        authPort,
        browserPort,
        seal,
        commit: commitMerchantCandidate,
        clock,
        retainContext: false,
        passwordLogin: async (page) => {
          await page.context().addCookies([newPassCookie]);
          return { outcome: 'success' };
        },
      });
      assert.equal(result, undefined);
      assert.equal(browserPort.openedSessions.length, 1);
      assert.equal(browserPort.closedSessions.length, 1);
      assert.equal(loadAuthState(account.id).revision, 2);
    }, { clock, seal });
  });

  it('rejects foreign CandidateSeal without committing and closes temporary context', async () => {
    const sealA = createCandidateSeal();
    const sealB = createCandidateSeal();
    const browserPort = makeTrackedBrowser();
    const clock = { now: () => Date.parse('2026-11-24T10:00:00.000Z'), sleep: async () => {} };
    const baseAuth = createInMemoryAuthPort({ seal: sealA, authoritative: true, now: clock.now });
    const authPort = {
      ...baseAuth,
      verifyAndSeal: (target, options) => baseAuth.verifyAndSeal(target, { ...options, seal: sealA }),
    };

    await withMerchantAuthUpdate(account.id, async (tx) => {
      const session = await browserPort.openSession({ storageState: tx.state });
      await assert.rejects(recover({
        tx,
        runtime: { clock },
        session,
        authPort,
        browserPort,
        seal: sealB,
        commit: commitMerchantCandidate,
        clock,
        passwordLogin: async () => ({ outcome: 'success' }),
      }), { code: 'E_AUTH_CANDIDATE_INVALID' });
      assert.equal(browserPort.closedContexts.length, 1);
      assert.equal(loadAuthState(account.id).revision, 1);
      await session.close();
    }, { clock, seal: sealB });
  });

  it('throws E_ACCOUNT_IDENTITY_MISMATCH and writes verify_failed when verified shop differs', async () => {
    const seal = createCandidateSeal();
    const browserPort = makeTrackedBrowser();
    const clock = { now: () => Date.parse('2026-11-24T10:00:00.000Z'), sleep: async () => {} };
    const authPort = createInMemoryAuthPort({
      seal,
      authoritative: true,
      merchantIdentity: { mallId: '900002', displayName: 'Wrong Shop' },
      now: clock.now,
    });

    await withMerchantAuthUpdate(account.id, async (tx) => {
      await assert.rejects(recover({
        tx,
        runtime: { clock },
        authPort,
        browserPort,
        seal,
        commit: commitMerchantCandidate,
        clock,
        retainContext: false,
        passwordLogin: async () => ({ outcome: 'success' }),
      }), { code: 'E_ACCOUNT_IDENTITY_MISMATCH' });
      assert.equal(browserPort.closedSessions.length, 1);
      assert.equal(getReloginState(account.id).reason, 'verify_failed');
      assert.equal(loadAuthState(account.id).revision, 1);
    }, { clock, seal });
  });

  it('closes temporary context and records challenge action on challenge outcome', async () => {
    const seal = createCandidateSeal();
    const browserPort = makeTrackedBrowser();
    const authPort = createInMemoryAuthPort({ seal, authoritative: true });
    const clock = { now: () => Date.parse('2026-11-24T10:00:00.000Z'), sleep: async () => {} };

    await withMerchantAuthUpdate(account.id, async (tx) => {
      const session = await browserPort.openSession({ storageState: tx.state });
      await assert.rejects(recover({
        tx,
        runtime: { clock },
        session,
        authPort,
        browserPort,
        seal,
        commit: commitMerchantCandidate,
        clock,
        passwordLogin: async () => ({ outcome: 'challenge', challenge: 'sms' }),
      }), { code: 'E_AUTH_HUMAN_REQUIRED' });
      assert.equal(browserPort.closedContexts.length, 1);
      assert.equal(getReloginState(account.id).status, 'awaiting_human');
      assert.equal(listPendingActions(account.id).filter((a) => a.status === 'open').length, 1);
      await session.close();
    }, { clock, seal });
  });

  it('aborts with E_AUTH_TIMEOUT after 90s child budget and resumes outer deadline', async () => {
    vi.useFakeTimers();
    try {
      const seal = createCandidateSeal();
      const browserPort = makeTrackedBrowser();
      const authPort = createInMemoryAuthPort({ seal, authoritative: true });
      const clock = { now: () => Date.now(), sleep: async () => {} };
      const deadline = armDeadline({ timeoutMs: 1000 }, null, Date.now(), clock);
      const runtime = { deadline, signal: deadline.signal, get deadlineAt() { return deadline.deadlineAt; }, clock };

      await withMerchantAuthUpdate(account.id, async (tx) => {
        const pending = recover({
          tx,
          runtime,
          authPort,
          browserPort,
          seal,
          commit: commitMerchantCandidate,
          clock,
          retainContext: false,
          passwordLogin: async (_page, _cred, task) => new Promise((_resolve, reject) => {
            task.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
        });
        const assertion = assert.rejects(pending, { code: 'E_AUTH_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(TIMEOUTS.LOGIN_PASSWORD);
        await assertion;
        assert.ok(deadline.deadlineAt > Date.now());
        assert.equal(browserPort.closedSessions.length, 1);
      }, { signal: runtime.signal, deadlineAt: runtime.deadlineAt, clock, seal });
      deadline.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
