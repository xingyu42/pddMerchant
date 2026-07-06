import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';

// INV-011: Collector disposal on requiredTrigger failure
// Contract: If requiredTrigger is true and the trigger function throws,
// the collector is disposed before the error propagates. This prevents
// collector leaks and E_COLLECTOR_COLLISION in subsequent calls.
test('collector disposal on requiredTrigger failure', async () => {
  let collectorDisposed = false;
  const listeners = { response: [], request: [] };

  const page = {
    on(evt, fn) {
      if (listeners[evt]) listeners[evt].push(fn);
    },
    off(evt, fn) {
      if (evt === 'response') collectorDisposed = true;
      if (!listeners[evt]) return;
      const i = listeners[evt].indexOf(fn);
      if (i >= 0) listeners[evt].splice(i, 1);
    },
    url: () => 'http://fake',
    goto: async (url) => {
      queueMicrotask(() => {
        const response = {
          url: () => url,
          status: () => 200,
          text: async () => '{"success":true}',
          json: async () => ({ success: true }),
        };
        for (const l of listeners.response.slice()) l(response);
      });
    },
    waitForSelector: async () => {},
  };

  const meta = {
    name: 'test.triggerFail',
    urlPattern: /fake/,
    nav: { url: 'http://host/fake' },
    trigger: async () => { throw new Error('boom'); },
    requiredTrigger: true,
    isSuccess: () => true,
  };

  const client = new PlaywrightEndpointClient();

  await assert.rejects(
    () => client.execute(meta, {}, { page }),
    (err) => err.code === 'E_GENERAL' && err.message.includes('required trigger failed'),
  );

  assert.ok(collectorDisposed, 'collector should be disposed before throwing');
});
