import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnDaemonProcess } from '../../src/adapter/daemon-process.js';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

it('detaches a hidden node process with ignored stdio and forwards runtime env through DaemonProcessPort', async () => {
  const expectedEntry = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
  const runtime = await composeCommandRuntime({
    mode: 'fixture',
    runtimeConfigPolicy: 'maintenance',
    env: {
      PDD_DB_PATH: 'synthetic-db',
      PDD_TEST_ADAPTER: 'fixture',
      PDD_TEST_DAEMON_HEARTBEAT_MS: '50',
    },
  });
  try {
    const child = { pid: 42001, once: vi.fn(), unref: vi.fn() };
    spawn.mockReturnValueOnce(child);
    const spawned = runtime.ports.daemonProcess.spawnDetached();
    assert.equal(spawned.pid, 42001);
    const [executable, args, options] = spawn.mock.calls.at(-1);
    assert.equal(executable, process.execPath);
    assert.deepEqual(args, [expectedEntry, 'daemon', 'run']);
    assert.equal(options.detached, true);
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio, 'ignore');
    assert.equal(options.env.PDD_DB_PATH, 'synthetic-db');
    assert.equal(options.env.PDD_TEST_ADAPTER, 'fixture');
    assert.equal(options.env.PDD_TEST_DAEMON_HEARTBEAT_MS, '50');
    assert.equal(child.unref.mock.calls.length, 1);
    assert.equal(child.once.mock.calls[0][0], 'error');
  } finally {
    await runtime.closeAll();
  }

  vi.stubEnv('PDD_DB_PATH', 'legacy-synthetic-db');
  const legacyChild = { once: vi.fn(), unref: vi.fn() };
  spawn.mockReturnValueOnce(legacyChild);
  assert.equal(spawnDaemonProcess(), legacyChild);
  assert.equal(spawn.mock.calls.at(-1)[2].env.PDD_DB_PATH, 'legacy-synthetic-db');
});
