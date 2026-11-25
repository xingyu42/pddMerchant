import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import { createCandidateSeal } from '../../src/infra/candidate-seal.js';

async function setupInteractiveLogin({ snapshotCookies = [] } = {}) {
  vi.resetModules();
  const contexts = [];
  const makePage = (context) => ({
    context: () => context,
    goto: async () => {},
    waitForTimeout: async () => {},
    close: async () => {},
  });

  const browser = {
    version: vi.fn(async () => '136.0.1'),
    close: vi.fn(async () => {}),
    contexts: () => contexts,
    newContext: vi.fn(async (options = {}) => {
      const isSnapshot = contexts.length > 0;
      const contextCookies = isSnapshot ? snapshotCookies : (options.storageState?.cookies ?? []);
      const context = {
        browser: () => browser,
        newPage: vi.fn(async () => makePage(context)),
        addInitScript: vi.fn(async () => {}),
        cookies: vi.fn(async () => contextCookies),
        storageState: vi.fn(async () => ({ cookies: contextCookies, origins: [] })),
        close: vi.fn(async () => {}),
      };
      contexts.push(context);
      return context;
    }),
  };

  vi.doMock('patchright', () => ({ chromium: { launch: vi.fn(async () => browser) } }));
  const interactive = await import('../../src/adapter/interactive-login.js');
  return { browser, contexts, ...interactive };
}

describe('interactive-login legacy stored-session verification without browserPort', () => {
  it('passes createSnapshotContext into checkStoredSession and defaultCheckStoredSession so verifyLiveMerchantContext does not throw E_CONFIG_INVALID', async () => {
    const { loginMerchantInteractive } = await setupInteractiveLogin({ snapshotCookies: [] });
    const seal = createCandidateSeal();
    const storedState = { cookies: [{ name: 'PASS_ID', value: 'stored-pass' }], origins: [] };
    const seenTasks = [];

    try {
      await assert.rejects(
        loginMerchantInteractive({
          transaction: { state: storedState },
          headed: true,
          timeoutMs: 20,
          seal,
          checkStoredSession: async (checkTarget, checkTask) => {
            seenTasks.push({ checkTarget, checkTask });
            const { verifyStoredMerchant } = await import('../../src/adapter/merchant-auth-storage.js');
            const result = await verifyStoredMerchant(checkTarget, storedState, checkTask);
            return { result };
          },
        }),
        (err) => err?.code === 'E_AUTH_TIMEOUT',
      );

      assert.equal(seenTasks.length, 1);
      assert.equal(typeof seenTasks[0].checkTask.createSnapshotContext, 'function');

      const { loginMerchantInteractive: loginDefaultPath, contexts } = await setupInteractiveLogin({ snapshotCookies: [] });
      await assert.rejects(
        loginDefaultPath({
          transaction: { state: storedState },
          headed: true,
          timeoutMs: 20,
          seal,
        }),
        (err) => err?.code === 'E_AUTH_TIMEOUT',
      );
      assert.ok(contexts.length >= 2);
    } finally {
      vi.doUnmock('patchright');
    }
  });
});
