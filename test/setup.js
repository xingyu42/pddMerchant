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
  PDD_DB_PATH: join(root, 'pdd.db'),
  NO_COLOR: '1',
});

vi.mock('patchright', () => {
  const blocked = () => { throw new Error('Real browsers are disabled in offline tests'); };
  return { chromium: { launch: blocked, launchPersistentContext: blocked, connectOverCDP: blocked } };
});

let sequence = 0;
let closeDatabase;
beforeEach(async () => {
  const database = await import('../src/infra/db.js');
  closeDatabase = database.closeDatabase;
  database.openDatabase(join(root, String(++sequence), 'pdd.db'));
  vi.stubGlobal('fetch', () => { throw new Error('Network fetch is disabled in offline tests'); });
});

afterEach(() => {
  closeDatabase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

afterAll(() => {
  closeDatabase();
  rmSync(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('PDD_') || key === 'NO_COLOR') delete process.env[key];
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (key.startsWith('PDD_') || key === 'NO_COLOR') process.env[key] = value;
  }
});
