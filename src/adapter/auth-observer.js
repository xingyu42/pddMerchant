const MERCHANT_ORIGIN = 'https://mms.pinduoduo.com';

export function isMerchantLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === MERCHANT_ORIGIN && /^\/login(?:[/.]|$)/.test(url.pathname);
  } catch { return false; }
}

export function observeMerchantLogin(page, { signal, timeoutMs } = {}) {
  let settled = false;
  let resolveResult;
  let timer;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    page.off('response', onResponse);
    page.off('framenavigated', onNavigation);
    signal?.removeEventListener('abort', onAbort);
    resolveResult({ success: reason === 'auth_valid', reason });
  };
  const onAbort = () => finish('aborted');
  const onNavigation = (frame) => {
    if (frame === page.mainFrame() && isMerchantLoginUrl(frame.url())) finish('auth_expired');
  };
  const onResponse = async (response) => {
    let matched = false;
    try {
      const url = new URL(response.url());
      if (url.origin !== MERCHANT_ORIGIN || url.pathname !== '/janus/api/checkLogin'
        || response.request().method() !== 'POST') return;
      matched = true;
      if (response.status() < 200 || response.status() >= 300) {
        finish('auth_check_inconclusive');
        return;
      }
      const body = await response.json();
      const login = body?.result?.login;
      finish(typeof login === 'boolean'
        ? (login ? 'auth_valid' : 'auth_expired')
        : 'auth_check_inconclusive');
    } catch {
      if (matched) finish('auth_check_inconclusive');
    }
  };
  page.on('response', onResponse);
  page.on('framenavigated', onNavigation);
  timer = setTimeout(() => finish('auth_check_inconclusive'), timeoutMs ?? 30_000);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return { result, dispose: () => finish('auth_check_inconclusive') };
}
