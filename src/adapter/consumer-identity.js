import { PddCliError, ExitCodes } from '../infra/errors.js';

export const CONSUMER_IDENTITY_PATH = '/proxy/api/api/apollo/v3/user/me';

function identityError(reason) {
  return new PddCliError({
    code: 'E_CONSUMER_IDENTITY_UNAVAILABLE',
    message: '登录成功，但无法识别消费者账号',
    hint: '重新登录；如果问题持续，消费者身份接口可能已经变化',
    detail: { reason },
    exitCode: ExitCodes.AUTH,
  });
}

export function normalizeConsumerIdentity(payload) {
  if (!payload || typeof payload !== 'object') throw identityError('invalid_payload');
  const uid = payload.uid;
  const nickname = typeof payload.nickname === 'string' ? payload.nickname.trim() : '';
  const normalizedUid = typeof uid === 'number' && Number.isSafeInteger(uid)
    ? String(uid)
    : (typeof uid === 'string' && uid.trim() ? uid.trim() : '');
  if (!normalizedUid) throw identityError('uid_missing');
  if (!nickname) throw identityError('nickname_missing');
  return { uid: normalizedUid, nickname };
}

export function createConsumerIdentityObserver(page) {
  let identity = null;
  let failure = null;
  const waiters = new Set();

  function settle() {
    for (const waiter of waiters) {
      if (identity) waiter.resolve(identity);
      else if (failure) waiter.reject(failure);
    }
    if (identity || failure) waiters.clear();
  }

  async function onResponse(response) {
    let pathname;
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      return;
    }
    if (pathname !== CONSUMER_IDENTITY_PATH || response.status() !== 200) return;
    try {
      identity = normalizeConsumerIdentity(await response.json());
    } catch (err) {
      failure = err instanceof PddCliError ? err : identityError('response_parse_failed');
    }
    settle();
  }

  page.on('response', onResponse);
  return {
    wait({ timeoutMs = 15_000 } = {}) {
      if (identity) return Promise.resolve(identity);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        waiters.add(waiter);
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(identityError('timeout'));
        }, timeoutMs);
        waiter.resolve = (value) => { clearTimeout(timer); resolve(value); };
        waiter.reject = (error) => { clearTimeout(timer); reject(error); };
      });
    },
    dispose() {
      page.off('response', onResponse);
      for (const waiter of waiters) waiter.reject(identityError('observer_disposed'));
      waiters.clear();
    },
  };
}
