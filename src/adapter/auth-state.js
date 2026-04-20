import { chmod, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { getLogger } from '../infra/logger.js';

const PDD_HOME = 'https://mms.pinduoduo.com';

export async function saveAuthState(context, path) {
  await mkdir(dirname(path), { recursive: true });
  await context.storageState({ path });
  try {
    await chmod(path, 0o600);
  } catch (err) {
    getLogger().warn({ err: err?.message, path }, 'chmod 600 failed (likely Windows), continuing');
  }
  return path;
}

export async function loadAuthState(path) {
  if (!existsSync(path)) {
    return { path, exists: false, state: null };
  }
  const raw = await readFile(path, 'utf8');
  const state = JSON.parse(raw);
  return { path, exists: true, state };
}

export async function isAuthValid(page, { timeoutMs = 15000 } = {}) {
  try {
    const resp = await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});
    const finalUrl = page.url();
    if (finalUrl.includes('/login')) return false;
    if (resp && !resp.ok() && resp.status() >= 400) return false;
    return true;
  } catch (err) {
    getLogger().debug({ err: err?.message }, 'isAuthValid navigation failed');
    return false;
  }
}

export { PDD_HOME };
