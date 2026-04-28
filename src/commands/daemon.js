import { spawn, execSync } from 'node:child_process';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { emit, buildEnvelope } from '../infra/output.js';
import { PROJECT_ROOT } from '../infra/paths.js';
import { DAEMON_STATE_PATH } from '../infra/paths.js';
import { ExitCodes } from '../infra/errors.js';
import { isPidAlive } from '../infra/process-util.js';

const DAEMON_BIN = join(PROJECT_ROOT, 'bin', 'pdd-daemon.js');

async function readState() {
  if (!existsSync(DAEMON_STATE_PATH)) return null;
  try {
    return JSON.parse(await readFile(DAEMON_STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function cleanStaleState() {
  try { await unlink(DAEMON_STATE_PATH); } catch { /* ignore */ }
}

export async function start(opts = {}) {
  const command = 'daemon.start';
  const startedAt = Date.now();

  const state = await readState();
  if (state && typeof state.pid === 'number' && isPidAlive(state.pid)) {
    const envelope = buildEnvelope({
      ok: true,
      command,
      data: { pid: state.pid, already_running: true, stateFile: DAEMON_STATE_PATH },
      meta: { latency_ms: Date.now() - startedAt },
    });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  if (state) await cleanStaleState();

  await mkdir(dirname(DAEMON_STATE_PATH), { recursive: true });

  const child = spawn(process.execPath, [DAEMON_BIN], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const childPid = child.pid;

  let confirmed = false;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const s = await readState();
    if (s && s.status === 'running' && s.pid === childPid) {
      confirmed = true;
      break;
    }
  }

  if (!confirmed) {
    const envelope = buildEnvelope({
      ok: false,
      command,
      error: { code: 'E_DAEMON_START_FAILED', message: 'Daemon did not confirm startup within 5s' },
      meta: { latency_ms: Date.now() - startedAt, exit_code: ExitCodes.GENERAL },
    });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  const envelope = buildEnvelope({
    ok: true,
    command,
    data: { pid: childPid, stateFile: DAEMON_STATE_PATH },
    meta: { latency_ms: Date.now() - startedAt },
  });
  emit(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

export async function stop(opts = {}) {
  const command = 'daemon.stop';
  const startedAt = Date.now();

  const state = await readState();
  if (!state || typeof state.pid !== 'number') {
    const envelope = buildEnvelope({
      ok: true,
      command,
      data: { stopped: false, message: 'daemon not running' },
      meta: { latency_ms: Date.now() - startedAt },
    });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  const pid = state.pid;

  if (!state.token) {
    await cleanStaleState();
    const envelope = buildEnvelope({
      ok: true,
      command,
      data: { stopped: false, message: 'daemon state missing token, cleaned' },
      meta: { latency_ms: Date.now() - startedAt },
    });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  const alive = isPidAlive(pid);

  if (alive) {
    try {
      if (platform() === 'win32') {
        try {
          execSync(`taskkill /PID ${pid} /T`, { timeout: 5000 });
        } catch { /* ignore */ }
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (!isPidAlive(pid)) break;
        }
        if (isPidAlive(pid)) {
          execSync(`taskkill /PID ${pid} /T /F`, { timeout: 5000 });
        }
      } else {
        process.kill(pid, 'SIGTERM');
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (!isPidAlive(pid)) break;
        }
        if (isPidAlive(pid)) process.kill(pid, 'SIGKILL');
      }
    } catch { /* best effort */ }
  }

  const freshState = await readState();
  if (freshState && freshState.token === state.token) {
    await cleanStaleState();
  }

  const envelope = buildEnvelope({
    ok: true,
    command,
    data: { pid, stopped: true },
    meta: { latency_ms: Date.now() - startedAt },
  });
  emit(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}

export async function status(opts = {}) {
  const command = 'daemon.status';
  const startedAt = Date.now();

  const state = await readState();
  if (!state || typeof state.pid !== 'number') {
    const envelope = buildEnvelope({
      ok: true,
      command,
      data: { running: false },
      meta: { latency_ms: Date.now() - startedAt },
    });
    emit(envelope, { json: opts.json, noColor: opts.noColor });
    return envelope;
  }

  const running = isPidAlive(state.pid);
  if (!running) {
    await cleanStaleState();
  }

  const envelope = buildEnvelope({
    ok: true,
    command,
    data: {
      running,
      pid: state.pid,
      startedAt: state.startedAt,
      lastRefreshAt: state.lastRefreshAt,
      lastResult: state.lastResult,
      nextRunAt: state.nextRunAt,
      qrPngPath: state.qrPngPath,
      refreshCount: state.refreshCount,
      failureCount: state.failureCount,
    },
    meta: { latency_ms: Date.now() - startedAt },
  });
  emit(envelope, { json: opts.json, noColor: opts.noColor });
  return envelope;
}
