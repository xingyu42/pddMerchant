import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createConsumerContext,
  DEFAULT_VIEWPORT,
} from '../../src/adapter/browser.js';

describe('createConsumerContext proxy option', () => {
  it('uses the desktop browser profile by default', async () => {
    let contextOptions = null;
    let initScriptCalls = 0;
    const context = {
      addInitScript: async () => { initScriptCalls += 1; },
      newPage: async () => ({ close: async () => {} }),
      close: async () => {},
    };
    const browser = {
      newContext: async (options) => { contextOptions = options; return context; },
    };

    const consumer = await createConsumerContext(browser);

    assert.deepEqual(contextOptions.viewport, DEFAULT_VIEWPORT);
    assert.equal(contextOptions.userAgent, undefined);
    assert.equal(initScriptCalls, 0);
    await consumer.close();
  });

  it('passes an optional proxy only to the new consumer context', async () => {
    let contextOptions = null;
    const page = { close: async () => {} };
    const context = {
      addInitScript: async () => {},
      newPage: async () => page,
      close: async () => {},
    };
    const browser = {
      newContext: async (options) => { contextOptions = options; return context; },
    };
    const proxy = { server: 'http://127.0.0.1:8080' };

    const consumer = await createConsumerContext(browser, { proxy });

    assert.deepEqual(contextOptions.proxy, proxy);
    await consumer.close();
  });

  it('closes a partially-created context when initialization fails', async () => {
    let closed = 0;
    const context = {
      newPage: async () => { throw new Error('page init failed'); },
      close: async () => { closed += 1; },
    };
    const browser = { newContext: async () => context };

    await assert.rejects(() => createConsumerContext(browser), /page init failed/);
    assert.equal(closed, 1);
  });
});
