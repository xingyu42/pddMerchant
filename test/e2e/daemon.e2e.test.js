import assert from 'node:assert/strict';
import { it } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDaemonSandbox, foregroundDaemon, waitForDaemon } from '../helpers/daemon-cli.js';

it('starts exactly one detached daemon, reports status and stops through the database', async () => {
  const sandbox = await createDaemonSandbox();
  try {
    const first = sandbox.cli('start').envelope;
    assert.equal(first.ok, true);
    assert.equal(first.data.started, true);
    assert.equal(first.data.console_url, `http://127.0.0.1:${sandbox.env.PDD_CONSOLE_PORT}`);
    const second = sandbox.cli('start').envelope;
    assert.equal(second.data.started, false);
    assert.equal(second.data.pid, first.data.pid);
    const status = sandbox.cli('status').envelope.data;
    assert.equal(status.running, true);
    assert.equal(status.patrol_enabled, false);
    assert.equal(status.pid, first.data.pid);
    assert.match(status.started_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(sandbox.cli('stop').envelope.data.stopped, true);
    assert.equal(sandbox.cli('status').envelope.data.running, false);
    assert.equal(sandbox.cli('stop').envelope.data.stopped, false);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('expires the heartbeat lease after process.kill and permits a fresh start', async () => {
  const sandbox = await createDaemonSandbox();
  try {
    const first = sandbox.cli('start').envelope.data;
    process.kill(first.pid, 'SIGKILL');
    // A dead PID alone leaves the heartbeat lease intact.
    const immediate = sandbox.cli('status').envelope.data;
    assert.equal(immediate.running, true);
    await sleep(3300);
    assert.equal(sandbox.cli('status').envelope.data.running, false);
    const next = sandbox.cli('start').envelope.data;
    assert.equal(next.started, true);
    assert.notEqual(next.pid, first.pid);
    assert.equal(sandbox.cli('stop').envelope.data.stopped, true);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('foreground run exits with one success envelope on stop_request and duplicate run', async () => {
  const sandbox = await createDaemonSandbox();
  const foreground = foregroundDaemon(sandbox);
  try {
    await waitForDaemon(sandbox);
    const duplicate = sandbox.cli('run');
    assert.equal(duplicate.status, 0);
    assert.equal(duplicate.envelope.data.stopped_reason, 'already_running');
    sandbox.cli('stop');
    const result = await foreground.result;
    assert.equal(result.status, 0);
    assert.equal(result.envelope.data.stopped_reason, 'stop_request');
  } finally {
    sandbox.cli('stop');
    if (foreground.child.exitCode === null) foreground.child.kill();
    sandbox.dispose();
  }
});
