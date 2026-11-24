import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it, vi } from 'vitest';
import { createLiveDaemonProcessPort } from '../../src/adapter/daemon-process.js';
import { createFixtureDaemonProcessPort } from '../../src/adapter/fixtures/daemon.js';
import { createInMemoryDaemonProcessPort } from '../helpers/in-memory-ports.js';
import { PddCliError } from '../../src/infra/errors.js';

const expectedEntryPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));

function createFakeProcessHost(baseEnv = { PDD_DB_PATH: '/tmp/synthetic.db' }) {
  const spawns = [];
  const alive = new Set();
  const failKillPids = new Set();
  const epermPids = new Set();
  let nextPid = 41000;

  const spawn = vi.fn((execPath, args, options) => {
    const pid = ++nextPid;
    alive.add(pid);
    const child = {
      pid,
      once: vi.fn(),
      unref: vi.fn(),
    };
    spawns.push({ execPath, args, options, child });
    return child;
  });

  const kill = vi.fn((pid, signal) => {
    if (signal === 0) {
      if (epermPids.has(pid)) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
      if (!alive.has(pid)) throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
      return true;
    }
    if (failKillPids.has(pid)) {
      throw new Error('sensitive host path failure');
    }
    if (!alive.has(pid)) {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    }
    alive.delete(pid);
    return true;
  });

  return { spawn, kill, spawns, alive, failKillPids, epermPids, baseEnv };
}

const ADAPTER_FACTORIES = [
  {
    name: 'live',
    create: (opts = {}) => {
      const host = createFakeProcessHost(opts.baseEnv);
      if (opts.failKillPid) host.failKillPids.add(opts.failKillPid);
      if (opts.epermPid) host.epermPids.add(opts.epermPid);
      const port = createLiveDaemonProcessPort({
        spawn: host.spawn,
        kill: host.kill,
        env: host.baseEnv,
        selfPid: opts.selfPid ?? 99999,
      });
      return { port, host };
    },
  },
  {
    name: 'fixture',
    create: (opts = {}) => {
      const host = createFakeProcessHost({ PDD_TEST_ADAPTER: 'fixture', ...(opts.baseEnv ?? {}) });
      if (opts.failKillPid) host.failKillPids.add(opts.failKillPid);
      if (opts.epermPid) host.epermPids.add(opts.epermPid);
      const port = createFixtureDaemonProcessPort({
        spawn: host.spawn,
        kill: host.kill,
        env: host.baseEnv,
        selfPid: opts.selfPid ?? 99999,
      });
      return { port, host };
    },
  },
  {
    name: 'in-memory',
    create: (opts = {}) => {
      const failKillPids = new Set(opts.failKillPid ? [opts.failKillPid] : []);
      const port = createInMemoryDaemonProcessPort({
        selfPid: opts.selfPid ?? 99999,
        failKillPids,
        initialPids: opts.epermPid ? [opts.epermPid] : [],
      });
      return { port, host: null };
    },
  },
];

describe.each(ADAPTER_FACTORIES)('DaemonProcessPort shared contract ($name)', ({ name, create }) => {
  it('spawnDetached starts a process and reports its pid and running state', () => {
    const { port, host } = create();
    const spawned = port.spawnDetached({ env: { PDD_TEST_DAEMON_HEARTBEAT_MS: '50' } });
    assert.equal(Number.isSafeInteger(spawned.pid) && spawned.pid > 0, true);
    assert.equal(port.isRunning(spawned.pid), true);

    if (host) {
      assert.equal(host.spawns.length, 1);
      const call = host.spawns[0];
      assert.equal(call.execPath, process.execPath);
      assert.deepEqual(call.args, [expectedEntryPath, 'daemon', 'run']);
      assert.equal(call.options.detached, true);
      assert.equal(call.options.windowsHide, true);
      assert.equal(call.options.stdio, 'ignore');
      assert.equal(call.options.env.PDD_TEST_DAEMON_HEARTBEAT_MS, '50');
      assert.equal(call.child.unref.mock.calls.length, 1);
      assert.equal(call.child.once.mock.calls[0][0], 'error');
      if (name === 'fixture') {
        assert.equal(call.options.env.PDD_TEST_ADAPTER, 'fixture');
      }
    }
  });

  it('stopByPid terminates running processes, tolerates ESRCH, and reports isRunning=false afterwards', () => {
    const { port } = create();
    const { pid } = port.spawnDetached();
    assert.equal(port.isRunning(pid), true);

    const stopped = port.stopByPid(pid);
    assert.deepEqual(stopped, { stopped: true, alreadyExited: false });
    assert.equal(port.isRunning(pid), false);

    const alreadyGone = port.stopByPid(pid);
    assert.deepEqual(alreadyGone, { stopped: true, alreadyExited: true });
  });

  it('guards invalid pids, selfPid and sanitizes kill failures into E_DAEMON_STOP_TIMEOUT', () => {
    const { port } = create({ selfPid: 55555, failKillPid: 41001 });
    for (const invalidPid of [0, -1, 1.5, '41001', null, undefined, 55555]) {
      assert.equal(port.isRunning(invalidPid === 55555 ? -1 : invalidPid), false);
      assert.throws(
        () => port.stopByPid(invalidPid),
        (error) => error instanceof PddCliError
          && error.code === 'E_DAEMON_STOP_TIMEOUT'
          && error.detail?.reason === 'kill_failed',
      );
    }

    const spawned = port.spawnDetached();
    if (spawned.pid !== 41001 && name === 'in-memory') {
      // ensure in-memory also fails when failKillPid matches spawned pid
      const mem = create({ failKillPid: 10001 });
      const first = mem.port.spawnDetached();
      assert.throws(
        () => mem.port.stopByPid(first.pid),
        (error) => error.code === 'E_DAEMON_STOP_TIMEOUT'
          && error.detail?.pid === first.pid
          && error.detail?.reason === 'kill_failed',
      );
      return;
    }

    assert.throws(
      () => port.stopByPid(41001),
      (error) => {
        assert.equal(error.code, 'E_DAEMON_STOP_TIMEOUT');
        assert.deepEqual(error.detail, { pid: 41001, reason: 'kill_failed' });
        assert.equal(JSON.stringify(error).includes('sensitive host path failure'), false);
        return true;
      },
    );
  });

  it('treats EPERM on signal-0 liveness probe as running', () => {
    const { port } = create({ epermPid: 60001 });
    assert.equal(port.isRunning(60001), true);
  });
});
