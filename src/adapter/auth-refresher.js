import { existsSync } from 'node:fs';
import { withBrowser } from './browser.js';
import { isAuthValid, saveAuthState } from './auth-state.js';
import { captureQrElement, saveQrPng } from './qr-login.js';
import { acquireLock, releaseLock } from './auth-lock.js';
import { isMockEnabled } from './mock-dispatcher.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';

function checkAborted(signal) {
  if (signal?.aborted) return true;
  return false;
}

export async function refreshAuth({ authStatePath, log, signal } = {}) {
  log = log ?? getLogger();

  if (isMockEnabled()) {
    const { mockRefreshAuth } = await import('./mock-dispatcher.js');
    return mockRefreshAuth();
  }

  if (!authStatePath || !existsSync(authStatePath)) {
    return { success: false, reason: 'auth_missing' };
  }

  if (checkAborted(signal)) {
    return { success: false, reason: 'aborted' };
  }

  let lockToken = null;
  try {
    const lock = await acquireLock(authStatePath, { timeoutMs: 15_000 });
    lockToken = lock.token;
  } catch (err) {
    log.warn({ err: err?.message }, 'auth-refresher: lock acquisition failed');
    return { success: false, reason: 'lock_timeout', error: err?.message };
  }

  try {
    return await withBrowser({
      headed: false,
      storageStatePath: authStatePath,
    }, async ({ context, page }) => {
      if (checkAborted(signal)) {
        return { success: false, reason: 'aborted' };
      }

      const valid = await isAuthValid(page, { timeoutMs: TIMEOUTS.AUTH_REFRESH });

      if (checkAborted(signal)) {
        return { success: false, reason: 'aborted' };
      }

      if (valid) {
        await saveAuthState(context, authStatePath, { skipLock: true });
        log.info('auth-refresher: cookies refreshed successfully');
        return { success: true, reason: 'refreshed' };
      }

      log.warn('auth-refresher: auth expired, attempting QR capture');
      try {
        const pngBuffer = await captureQrElement(page, { timeout: TIMEOUTS.QR_CAPTURE });
        const qrPngPath = await saveQrPng(pngBuffer);
        log.warn({ qrPngPath }, 'auth-refresher: QR saved, manual scan required');
        return { success: false, reason: 'auth_expired', qrPngPath };
      } catch (qrErr) {
        log.warn({ err: qrErr?.message }, 'auth-refresher: QR capture failed');
        return { success: false, reason: 'auth_expired', error: qrErr?.message };
      }
    });
  } catch (err) {
    if (checkAborted(signal)) {
      return { success: false, reason: 'aborted' };
    }
    log.error({ err: err?.message }, 'auth-refresher: refresh failed');
    return { success: false, reason: 'network_error', error: err?.message };
  } finally {
    if (lockToken) {
      await releaseLock(authStatePath, lockToken).catch((e) => {
        log.warn({ err: e?.message }, 'auth-refresher: lock release failed');
      });
    }
  }
}
