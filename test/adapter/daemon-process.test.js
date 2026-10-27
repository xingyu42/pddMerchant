import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnDaemonProcess } from '../../src/adapter/daemon-process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

it('detaches a hidden node process with ignored stdio and passes the full environment', () => {
  vi.stubEnv('PDD_DB_PATH', 'synthetic-db');
  vi.stubEnv('PDD_TEST_DAEMON_HEARTBEAT_MS', '50');
  const child = { once: vi.fn(), unref: vi.fn() };
  spawn.mockReturnValueOnce(child);
  assert.equal(spawnDaemonProcess(), child);
  const [executable, args, options] = spawn.mock.calls.at(-1);
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, [fileURLToPath(new URL('../../bin/pdd.js', import.meta.url)), 'daemon', 'run']);
  assert.equal(options.detached, true);
  assert.equal(options.windowsHide, true);
  assert.equal(options.stdio, 'ignore');
  assert.equal(options.env.PDD_DB_PATH, 'synthetic-db');
  assert.equal(options.env.PDD_TEST_ADAPTER, 'fixture');
  assert.equal(options.env.PDD_TEST_DAEMON_HEARTBEAT_MS, '50');
  assert.equal(child.unref.mock.calls.length, 1);
  assert.equal(child.once.mock.calls[0][0], 'error');
});
