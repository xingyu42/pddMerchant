import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';

// INV-009: Route cleanup after navigation failure (fetch mode)
// Contract: If navigation fails in fetch mode after page.route() is called,
// the route handler is still unrouted via page.unroute() in the finally block.
test('route cleanup after navigation failure (fetch mode)', async () => {
  let routeRegistered = false;
  let routeUnregistered = false;

  const page = {
    on: () => {},
    off: () => {},
    url: () => 'http://fake',
    route: async () => { routeRegistered = true; },
    unroute: async () => { routeUnregistered = true; },
    goto: async () => { throw new Error('navigation failed'); },
    waitForSelector: async () => {},
  };

  const meta = {
    name: 'test.routeCleanup',
    urlPattern: /test/,
    apiUrl: '/api/test',
    buildPayload: () => ({}),
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };

  const client = new PlaywrightEndpointClient();

  await assert.rejects(
    () => client.execute(meta, {}, { page }),
    (err) => err.code === 'E_NETWORK',
  );

  assert.ok(routeRegistered, 'route should be registered before nav');
  assert.ok(routeUnregistered, 'route should be unregistered in finally block');
});

// INV-010: Route cleanup after collector timeout (fetch mode)
// Contract: If the collector times out waiting for XHR responses in fetch mode,
// the route handler is still unrouted.
test('route cleanup after collector timeout (fetch mode)', async () => {
  let routeUnregistered = false;

  const page = {
    on: () => {},
    off: () => {},
    url: () => 'http://fake',
    route: async () => {},
    unroute: async () => { routeUnregistered = true; },
    goto: async () => {},
    waitForSelector: async () => {},
  };

  const meta = {
    name: 'test.collectorTimeout',
    urlPattern: /no-match/,
    apiUrl: '/api/test',
    buildPayload: () => ({}),
    collectorTimeout: 100,
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };

  const client = new PlaywrightEndpointClient();

  await assert.rejects(
    () => client.execute(meta, {}, { page }),
    (err) => err.code === 'E_NETWORK',
  );

  assert.ok(routeUnregistered, 'route should be unregistered even on timeout');
});
