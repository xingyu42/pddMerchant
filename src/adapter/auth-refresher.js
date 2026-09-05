import { existsSync } from 'node:fs';
import { withBrowser } from './browser.js';
import { saveAuthState } from './auth-state.js';
import { observeMerchantLogin, isMerchantLoginUrl } from './auth-observer.js';
import { captureQrElement, saveQrPng } from './qr-login.js';
import { acquireLock, releaseLock } from '../infra/auth-lock.js';
import { isMockEnabled } from './mock-dispatcher.js';
import { getLogger } from '../infra/logger.js';
import { TIMEOUTS } from '../infra/timeouts.js';

export async function refreshAuth({ authStatePath, log, signal } = {}) {
  log = log ?? getLogger();

  if (isMockEnabled()) {
    const { mockRefreshAuth } = await import('./mock-dispatcher.js');
    return mockRefreshAuth();
  }

  if (!authStatePath || !existsSync(authStatePath)) {
    return { success: false, reason: 'auth_missing' };
  }

  if (signal?.aborted) {
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
      if (signal?.aborted) {
        return { success: false, reason: 'aborted' };
      }

      const observer = observeMerchantLogin(page, { signal, timeoutMs: TIMEOUTS.AUTH_REFRESH });
      let outcome;
      try {
        await page.goto('https://mms.pinduoduo.com/home', {
          waitUntil: 'domcontentloaded', timeout: TIMEOUTS.AUTH_REFRESH,
        });
        outcome = isMerchantLoginUrl(page.url())
          ? { success: false, reason: 'auth_expired' }
          : await observer.result;
      } catch {
        outcome = { success: false, reason: isMerchantLoginUrl(page.url()) ? 'auth_expired' : 'auth_check_inconclusive' };
      } finally {
        observer.dispose();
      }

      if (signal?.aborted) {
        return { success: false, reason: 'aborted' };
      }

      if (outcome.success) {
        await saveAuthState(context, authStatePath, { skipLock: true });
        log.info('auth-refresher: login valid, state saved');
        return outcome;
      }

      if (outcome.reason !== 'auth_expired') return outcome;

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
    if (signal?.aborted) {
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
