const hooks = new Set();

/** Register a process-exit/signal closeAll hook and return an idempotent unregister callback. */
export function registerCloseAllHook(hook) {
  if (typeof hook !== 'function') return () => {};
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

async function runSingleHook(hook, options) {
  try {
    await hook(options);
  } catch {
    // Signal and fatal handlers must continue running remaining cleanup hooks.
  }
}

/** Run all registered closeAll hooks concurrently within an optional timeout budget. */
export async function runCloseAllHooks({ timeoutMs = 5000 } = {}) {
  if (hooks.size === 0) return;
  const snapshot = [...hooks];
  const pending = Promise.allSettled(snapshot.map((hook) => runSingleHook(hook, { timeoutMs })));
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    await pending;
    return;
  }
  let timer = null;
  try {
    await Promise.race([
      pending,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
