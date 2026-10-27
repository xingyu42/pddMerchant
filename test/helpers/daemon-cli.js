import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createCliSandbox } from './isolated-cli.js';
import { assertEnvelopeShape } from './envelope-assertions.js';
import { freeConsolePort } from './console-http.js';

const cliPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
const preload = new URL('./offline-preload.js', import.meta.url).href;

export function parseDaemonResult(result) {
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 1, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assertEnvelopeShape(envelope, { exitCode: result.status });
  return { ...result, envelope };
}

export async function createDaemonSandbox() {
  const sandbox = createCliSandbox();
  Object.assign(sandbox.env, { PDD_TEST_DAEMON_LEASE_TTL_MS: '3000', PDD_TEST_DAEMON_HEARTBEAT_MS: '100',
    PDD_CONSOLE_PORT: String(await freeConsolePort()), NODE_OPTIONS: `--import=${preload}` });
  const cli = (action) => parseDaemonResult(spawnSync(process.execPath, [cliPath, 'daemon', action, '--json'], {
    cwd: sandbox.root, env: sandbox.env, encoding: 'utf8', timeout: 25000, windowsHide: true,
  }));
  return { ...sandbox, cli };
}

export function consoleLink(sandbox, args = []) {
  return parseDaemonResult(spawnSync(process.execPath, [cliPath, 'console', 'link', ...args, '--json'], {
    cwd: sandbox.root, env: sandbox.env, encoding: 'utf8', timeout: 15000, windowsHide: true,
  }));
}

export function foregroundDaemon(sandbox) {
  const child = spawn(process.execPath, [cliPath, 'daemon', 'run', '--json'], {
    cwd: sandbox.root, env: sandbox.env, windowsHide: true,
  });
  const result = new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      try { resolve(parseDaemonResult({ stdout, stderr, status, signal })); }
      catch (error) { reject(error); }
    });
  });
  return { child, result };
}

export async function waitForDaemon(sandbox) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (sandbox.cli('status').envelope.data.console_url) return;
    await sleep(100);
  }
  assert.fail('foreground daemon did not acquire its lease');
}

export async function runDaemonContract(action) {
  const sandbox = await createDaemonSandbox();
  let foreground;
  try {
    if (action !== 'run') return sandbox.cli(action);
    foreground = foregroundDaemon(sandbox);
    await waitForDaemon(sandbox);
    sandbox.cli('stop');
    return await foreground.result;
  } finally {
    sandbox.cli('stop');
    if (foreground && foreground.child.exitCode === null) foreground.child.kill();
    sandbox.dispose();
  }
}

export async function runConsoleLinkContract() {
  const sandbox = await createDaemonSandbox();
  try {
    sandbox.cli('start');
    return consoleLink(sandbox);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
}
