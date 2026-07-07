import { afterEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempRoots = [];

async function tempAuthPath() {
  const root = await mkdtemp(join(tmpdir(), 'pdd-auth-refresher-'));
  tempRoots.push(root);
  return join(root, 'auth-state.json');
}

async function importRefreshAuthWithLockFailure() {
  vi.resetModules();
  vi.doMock('../src/infra/auth-lock.js', () => ({
    acquireLock: async () => {
      throw new Error('lock busy');
    },
    releaseLock: async () => true,
  }));
  vi.doMock('../src/adapter/browser.js', () => ({
    withBrowser: async () => {
      throw new Error('browser must not be launched when lock acquisition fails');
    },
  }));
  return import('../src/adapter/auth-refresher.js');
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    await rm(root, { recursive: true, force: true });
  }
});

describe('auth refresher lifecycle invariants', () => {
  it('does not overwrite existing auth-state when lock acquisition fails', async () => {
    const authStatePath = await tempAuthPath();
    const originalState = JSON.stringify({
      cookies: [{ name: 'sid', value: 'keep-me', domain: '.example.test', path: '/' }],
      origins: [],
    }, null, 2);
    await writeFile(authStatePath, originalState);

    const { refreshAuth } = await importRefreshAuthWithLockFailure();
    const result = await refreshAuth({
      authStatePath,
      log: {
        warn() {},
        error() {},
        info() {},
        debug() {},
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.reason, 'lock_timeout');
    assert.equal(await readFile(authStatePath, 'utf8'), originalState);
  });
});
