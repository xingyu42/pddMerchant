import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import { registerCloseAllHook, runCloseAllHooks } from '../../src/infra/runtime-cleanup.js';

describe('runtime closeAll cleanup hooks', () => {
  it('runs registered hooks concurrently, isolates failures and unregisters cleanly', async () => {
    const order = [];
    const unregisterA = registerCloseAllHook(async ({ timeoutMs }) => {
      order.push(['a', timeoutMs]);
    });
    const unregisterB = registerCloseAllHook(async () => {
      order.push(['b']);
      throw new Error('hook failure');
    });

    try {
      await runCloseAllHooks({ timeoutMs: 3200 });
      assert.deepEqual(order, [['a', 3200], ['b']]);

      unregisterB();
      order.length = 0;
      await runCloseAllHooks({ timeoutMs: 1500 });
      assert.deepEqual(order, [['a', 1500]]);
    } finally {
      unregisterA();
      unregisterB();
    }
  });

  it('bounds cleanup waits by timeoutMs without leaking timers', async () => {
    vi.useFakeTimers();
    const unregister = registerCloseAllHook(() => new Promise(() => {}));
    try {
      const pending = runCloseAllHooks({ timeoutMs: 250 });
      await vi.advanceTimersByTimeAsync(250);
      await pending;
      assert.equal(vi.getTimerCount(), 0);
    } finally {
      unregister();
    }
  });

  it('wires bin/pdd.js top-level cleanup through runtime-cleanup without importing adapter/browser.js', () => {
    const cliSource = readFileSync(new URL('../../bin/pdd.js', import.meta.url), 'utf8');
    assert.equal(cliSource.includes("adapter/browser.js"), false);
    assert.equal(cliSource.includes("infra/runtime-cleanup.js"), true);
    assert.match(cliSource, /runCloseAllHooks/);
  });
});
