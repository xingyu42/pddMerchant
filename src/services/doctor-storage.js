import { lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getDatabasePath } from '../infra/db.js';

async function statEntry(path) {
  try { return await lstat(path); }
  catch { return null; }
}

async function hasLegacyAccountData(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    if (entries.some((entry) => entry.name === 'registry.json' && entry.isFile())) return true;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const state = await statEntry(join(path, entry.name, 'auth-state.json'));
      if (state?.isFile()) return true;
    }
  } catch { /* 旧数据检查失败视为未发现。 */ }
  return false;
}

export async function hasLegacyStorage() {
  const base = dirname(getDatabasePath());
  if (!(await statEntry(base))?.isDirectory()) return false;
  for (const [kind, directory] of [['merchant', 'stores'], ['consumer', 'accounts']]) {
    const parent = join(base, kind);
    if (!(await statEntry(parent))?.isDirectory()) continue;
    const path = join(parent, directory);
    if (!(await statEntry(path))?.isDirectory()) continue;
    if (await hasLegacyAccountData(path)) return true;
  }
  return false;
}
