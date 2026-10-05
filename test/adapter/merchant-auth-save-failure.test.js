import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rename: async (from, to) => {
    if (String(to).endsWith('blocked.json')) throw Object.assign(new Error('synthetic-secret'), { code: 'EACCES' });
    return actual.rename(from, to);
  } };
});
import { saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';

it('preserves the original file and removes temporary materials when rename fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdd-auth-save-failure-'));
  const path = join(root, 'blocked.json');
  const original = JSON.stringify({ cookies: [], origins: [] });
  try {
    await writeFile(path, original);
    await assert.rejects(saveAuthStateSnapshot({ cookies: [{ name: 'PASS_ID', value: 'synthetic' }], origins: [] }, path), (error) => {
      assert.equal(error.code, 'E_AUTH_STATE_SAVE_FAILED');
      assert.ok(!JSON.stringify(error).includes('synthetic-secret'));
      return true;
    });
    assert.equal(await readFile(path, 'utf8'), original);
    assert.deepEqual(await readdir(root), ['blocked.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
