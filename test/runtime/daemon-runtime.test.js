import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it, vi } from 'vitest';
import { composeDaemonRuntime } from '../../src/runtime/daemon-runtime.js';
import { DAEMON_LEASE, acquireDaemonLease, readDaemonOwnerToken, daemonBrowserOwnerTag } from '../../src/infra/daemon-state.js';
import { patrolIntervalMs } from '../../src/services/patrol.js';
import { createConsoleLink, redeemConsoleToken } from '../../src/services/console-auth.js';
import { createConsoleServer } from '../../src/daemon/server.js';
import { consoleRequest } from '../helpers/console-http.js';
import {
  createInMemoryBrowserRuntime,
  createInMemoryMallPort,
  createInMemoryAuthPort,
  createInMemoryDaemonProcessPort,
} from '../helpers/in-memory-ports.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const servers = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

describe('composeDaemonRuntime', () => {
  it('ignores PDD_TEST_* timing overrides and omits fixture-complete route in Live mode', async () => {
    const runtime = await composeDaemonRuntime({
      mode: 'live',
      foreground: false,
      runtimeConfig: { logLevel: 'silent', patrolIntervalMs: 300_000, consoleHost: '127.0.0.1', consolePort: 0, consolePublicUrl: '' },
      env: {
        PDD_TEST_DAEMON_LEASE_TTL_MS: '500',
        PDD_TEST_DAEMON_HEARTBEAT_MS: '50',
        PDD_TEST_PATROL_INTERVAL_MS: '25',
      },
    });

    try {
      assert.equal(runtime.mode, 'live');
      assert.equal(Object.hasOwn(runtime, 'rawEnv'), false);
      assert.deepEqual(Object.keys(runtime.ports).sort(), ['auth', 'browser', 'consoleLoginDriver', 'daemonProcess', 'mall']);
      assert.equal(typeof runtime.ports.consoleLoginDriver.openSession, 'function');
      assert.deepEqual(Object.keys(runtime.consoleApp).sort(), ['accounts', 'auth', 'health', 'patrol', 'sessions']);
      assert.deepEqual(runtime.consoleExtraRoutes, []);
      assert.deepEqual(runtime.timings, {
        ttlMs: DAEMON_LEASE.ttlMs,
        heartbeatMs: DAEMON_LEASE.heartbeatMs,
      });
      assert.equal(patrolIntervalMs(runtime.runtimeConfig, runtime), 300_000);
      assert.equal(runtime.routes.some((route) => route.template.includes('fixture-complete')), false);

      await acquireDaemonLease();
      const server = createConsoleServer({ runtime });
      servers.push(server);
      await server.start({
        runtimeConfig: runtime.runtimeConfig,
        log: runtime.log,
        ownerTag: daemonBrowserOwnerTag(readDaemonOwnerToken()),
        runtime,
      });
      const { url } = createConsoleLink();
      const { sessionValue } = redeemConsoleToken(new URL(url).pathname.split('/').at(-1));
      const port = server.address().port;
      const res = await consoleRequest(port, '/api/sessions/unknown/fixture-complete', {
        method: 'POST',
        headers: {
          Cookie: `pdd_console=${sessionValue}`,
          'Content-Type': 'application/json',
          'X-PDD-Console': '1',
        },
        body: '{"outcome":"success"}',
      });
      assert.equal(res.status, 404);
      assert.equal(JSON.parse(res.body).error.code, 'E_NOT_FOUND');
    } finally {
      await runtime.closeAll();
    }
  });

  it('honors positive safe int timing overrides and exposes fixture-complete route in Fixture mode', async () => {
    const valid = await composeDaemonRuntime({
      mode: 'fixture',
      foreground: false,
      runtimeConfig: { logLevel: 'silent', patrolIntervalMs: 300_000, consoleHost: '127.0.0.1', consolePort: 0, consolePublicUrl: '' },
      env: {
        PDD_TEST_DAEMON_LEASE_TTL_MS: '1200',
        PDD_TEST_DAEMON_HEARTBEAT_MS: '150',
        PDD_TEST_PATROL_INTERVAL_MS: '75',
      },
    });

    try {
      assert.equal(valid.mode, 'fixture');
      assert.deepEqual(valid.timings, { ttlMs: 1200, heartbeatMs: 150 });
      assert.equal(patrolIntervalMs(valid.runtimeConfig, valid), 75);
      assert.equal(typeof valid.ports.consoleLoginDriver.openSession, 'function');
      assert.equal(valid.consoleExtraRoutes.some((route) => route.template === '/api/sessions/:id/fixture-complete'), true);
      assert.equal(valid.routes.some((route) => route.template === '/api/sessions/:id/fixture-complete'), true);
    } finally {
      await valid.closeAll();
    }

    const invalid = await composeDaemonRuntime({
      mode: 'fixture',
      foreground: false,
      runtimeConfig: { logLevel: 'silent', patrolIntervalMs: 300_000 },
      env: {
        PDD_TEST_DAEMON_LEASE_TTL_MS: '-1',
        PDD_TEST_DAEMON_HEARTBEAT_MS: '0',
        PDD_TEST_PATROL_INTERVAL_MS: '9007199254740992',
      },
    });

    try {
      assert.deepEqual(invalid.timings, {
        ttlMs: DAEMON_LEASE.ttlMs,
        heartbeatMs: DAEMON_LEASE.heartbeatMs,
      });
      assert.equal(patrolIntervalMs(invalid.runtimeConfig, invalid), 300_000);
    } finally {
      await invalid.closeAll();
    }
  });

  it('preserves foreground log teeing with redaction, overrides, and injected clock', async () => {
    const browser = createInMemoryBrowserRuntime({ reclaimCount: 3 });
    const mall = createInMemoryMallPort();
    const auth = createInMemoryAuthPort();
    const daemonProcess = createInMemoryDaemonProcessPort();
    const customClock = { now: () => 1_700_000_000_000, sleep: async () => {} };
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const runtime = await composeDaemonRuntime({
      mode: 'live',
      foreground: true,
      runtimeConfig: { logLevel: 'info', consolePort: 47999 },
      env: {},
      clock: customClock,
      overrides: { browser, mall, auth, daemonProcess },
    });

    try {
      assert.equal(runtime.ports.browser, browser);
      assert.equal(runtime.ports.mall, mall);
      assert.equal(runtime.ports.auth, auth);
      assert.equal(runtime.ports.daemonProcess, daemonProcess);
      assert.equal(runtime.clock.now(), 1_700_000_000_000);
      assert.equal(await runtime.cleanupBrowsers(), 3);

      runtime.log.info({ consoleToken: 'secret-daemon-token' }, 'daemon foreground compose check');
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      assert.match(output, /daemon foreground compose check/);
      assert.equal(output.includes('secret-daemon-token'), false);
    } finally {
      await runtime.closeAll();
    }
  });

  it('loads Live bundle without fixture modules and Fixture bundle without Patchright', () => {
    const daemonUrl = new URL('../../src/runtime/daemon-runtime.js', import.meta.url).href;

    const checkIsolation = (mode, forbiddenPattern) => {
      const script = `
        import { registerHooks } from 'node:module';
        registerHooks({
          resolve(specifier, context, nextResolve) {
            const resolved = nextResolve(specifier, context);
            if (${forbiddenPattern}.test(resolved.url) || ${forbiddenPattern}.test(specifier)) {
              throw new Error('Forbidden module loaded in ${mode} daemon mode: ' + specifier + ' -> ' + resolved.url);
            }
            return resolved;
          },
        });
        const { composeDaemonRuntime } = await import(${JSON.stringify(daemonUrl)});
        const rt = await composeDaemonRuntime({
          mode: ${JSON.stringify(mode)},
          foreground: false,
          runtimeConfig: { logLevel: 'silent', patrolIntervalMs: 300000 },
          env: {},
        });
        await rt.closeAll();
      `;
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 15_000,
      });
      assert.equal(res.status, 0, res.stderr || res.stdout);
    };

    checkIsolation('live', '/(?:adapter\\/fixtures\\/|mock-dispatcher\\.js|console-login-fixture\\.js)/');
    checkIsolation('fixture', '/^patchright$/');
  });
});
