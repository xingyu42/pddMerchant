import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, vi } from 'vitest';

const originalEnv = { ...process.env };
const root = mkdtempSync(join(tmpdir(), 'pdd-unit-'));
for (const key of Object.keys(process.env)) {
  if (key.startsWith('PDD_')) delete process.env[key];
}
Object.assign(process.env, {
  PDD_TEST_ADAPTER: 'fixture',
  PDD_TEST_FIXTURE_DIR: join(root, 'fixtures'),
  PDD_AUTH_STATE_PATH: join(root, 'merchant-auth.json'),
  PDD_CONSUMER_AUTH_STATE_PATH: join(root, 'consumer-auth.json'),
  PDD_ACCOUNTS_DIR: join(root, 'merchant'),
  PDD_ACCOUNT_REGISTRY_PATH: join(root, 'merchant-registry.json'),
  PDD_CONSUMER_ACCOUNTS_DIR: join(root, 'consumer'),
  PDD_CONSUMER_ACCOUNT_REGISTRY_PATH: join(root, 'consumer-registry.json'),
  NO_COLOR: '1',
});

vi.mock('patchright', () => {
  const blocked = () => { throw new Error('Real browsers are disabled in offline tests'); };
  return { chromium: { launch: blocked, launchPersistentContext: blocked, connectOverCDP: blocked } };
});

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('Network fetch is disabled in offline tests'); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('PDD_') || key === 'NO_COLOR') delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (key.startsWith('PDD_') || key === 'NO_COLOR') process.env[key] = value;
  }
});
