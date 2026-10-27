import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, closeBrowser } from '../../src/adapter/browser.js';
import { attemptPasswordLogin, inspectPasswordLoginPage } from '../../src/adapter/password-login.js';
import { verifyMerchantContext } from '../../src/adapter/merchant-auth.js';
import { assertAuthTask } from '../../src/adapter/merchant-auth-storage.js';
import { PDD_HOME } from '../../src/adapter/auth-state.js';
import { abortableSleep, budgetMs } from '../../src/infra/abort.js';
import { TIMEOUTS } from '../../src/infra/timeouts.js';
import { PROJECT_ROOT } from '../../src/infra/paths.js';

function parseAttempts(args) {
  if (args.length === 0) return 1;
  if (args.length === 2 && args[0] === '--attempts' && /^[1-3]$/.test(args[1])) return Number(args[1]);
  throw new Error('Usage: node scripts/experiments/password-login-probe.mjs [--attempts 1..3]');
}

async function readHidden(label, signal) {
  const muted = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  const onInterrupt = () => process.emit('SIGINT');
  reader.on('SIGINT', onInterrupt);
  process.stderr.write(label);
  try {
    const value = await reader.question('', { signal });
    if (!value || value.length > 128) throw new Error('Invalid input');
    return value;
  } finally {
    reader.removeListener('SIGINT', onInterrupt);
    reader.close();
    muted.end();
    process.stderr.write('\n');
  }
}

function safeContainers(containers, credential) {
  const secrets = [credential.loginName, credential.password].flatMap((value) => [value, encodeURIComponent(value), ...value.split(/[^A-Za-z0-9_-]+/)]);
  const safe = (token) => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(token)
    && !/\d{4}/.test(token) && !secrets.some((value) => value && token.toLowerCase().includes(value.toLowerCase()));
  return (containers ?? []).map((container) => ({
    id: container.id.filter(safe), class: container.class.filter(safe),
  })).filter((container) => container.id.length || container.class.length);
}

async function observe(page, credential, task) {
  try {
    const observation = await inspectPasswordLoginPage(page, task);
    return {
      challenge: observation.challenge ?? null,
      sms_sent_without_click: observation.sms_sent ?? null,
      containers: safeContainers(observation.containers, credential),
    };
  } catch {
    assertAuthTask(task);
    return { challenge: null, sms_sent_without_click: null, containers: [] };
  }
}

async function observeHome(page, credential, task) {
  await page.goto(PDD_HOME, { waitUntil: 'domcontentloaded', timeout: budgetMs(task, 10000) });
  const until = Math.min(task.deadlineAt, Date.now() + 5000);
  while (Date.now() < until) {
    const observation = await observe(page, credential, task);
    if (observation.challenge) return { required: true, ...observation };
    await abortableSleep(budgetMs({ deadlineAt: until }, 200), task.signal);
    assertAuthTask(task);
  }
  return { required: false, challenge: null };
}

async function measure(durations, stage, action) {
  const started = Date.now();
  try { return await action(); }
  finally { durations[stage] = Date.now() - started; }
}

async function probeAttempt(credential, signal) {
  const started = Date.now();
  const task = { signal, deadlineAt: started + TIMEOUTS.LOGIN_PASSWORD + 45000 };
  const durations = {};
  const report = { outcome: 'experiment_error', challenge: null, verification: null, observation: null, secondary_verification: null, durations_ms: durations };
  let browser;
  const close = () => { void closeBrowser(browser).catch(() => {}); };
  const timer = setTimeout(close, budgetMs(task));
  signal?.addEventListener('abort', close, { once: true });
  try {
    assertAuthTask(task);
    const session = await measure(durations, 'launch', () => launchBrowser({ headed: false, storageState: { cookies: [], origins: [] } }));
    browser = session.browser;
    assertAuthTask(task);
    const result = await measure(durations, 'login', () => attemptPasswordLogin(session.page, credential, { signal, deadlineAt: Date.now() + TIMEOUTS.LOGIN_PASSWORD }));
    report.outcome = result.outcome;
    report.challenge = result.challenge ?? null;
    report.observation = await observe(session.page, credential, task);
    if (report.outcome === 'success' && report.observation.challenge) {
      report.outcome = 'challenge';
      report.challenge = report.observation.challenge;
    }
    if (report.outcome !== 'success') return report;
    const verified = await measure(durations, 'verification', () => verifyMerchantContext(session.context, { signal, deadlineAt: Math.min(task.deadlineAt, Date.now() + 30500) }));
    report.verification = { verdict: ['verified', 'rejected', 'indeterminate', 'failed'].includes(verified.verdict) ? verified.verdict : 'indeterminate' };
    report.secondary_verification = await measure(durations, 'home_observation', () => observeHome(session.page, credential, task));
    return report;
  } catch (error) {
    report.outcome = signal?.aborted ? 'cancelled' : error?.code === 'E_AUTH_TIMEOUT' || Date.now() >= task.deadlineAt ? 'timeout' : 'experiment_error';
    return report;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', close);
    await closeBrowser(browser).catch(() => {});
    durations.total = Date.now() - started;
  }
}

async function runExperiment(credential, { attempts = 1, signal } = {}) {
  parseAttempts(['--attempts', String(attempts)]);
  const report = { started_at: new Date().toISOString(), attempts_requested: attempts, attempts: [], stopped: 'completed', challenge_frequency: {} };
  for (let index = 0; index < attempts; index++) {
    if (index > 0) {
      try { await abortableSleep(60000, signal); }
      catch { report.stopped = 'cancelled'; break; }
    }
    const attempt = await probeAttempt(credential, signal);
    report.attempts.push(attempt);
    const challenges = [attempt.challenge, attempt.observation?.challenge, attempt.secondary_verification?.challenge];
    const challenge = challenges.includes('slider') ? 'slider' : challenges.find(Boolean);
    if (challenge) report.challenge_frequency[challenge] = (report.challenge_frequency[challenge] ?? 0) + 1;
    if (['wrong_password', 'account_locked'].includes(attempt.outcome)) {
      report.stopped = attempt.outcome;
      break;
    }
    if (challenge === 'slider') { report.stopped = 'slider'; break; }
    if (signal?.aborted) { report.stopped = 'cancelled'; break; }
  }
  return report;
}

async function main(args = process.argv.slice(2)) {
  let credential;
  const controller = new AbortController();
  const onInterrupt = () => controller.abort();
  try {
    const attempts = parseAttempts(args);
    if (!process.stdin.isTTY) throw new Error('TTY required');
    process.on('SIGINT', onInterrupt);
    credential = { loginName: await readHidden('Login name (hidden): ', controller.signal), password: '' };
    credential.password = await readHidden('Password (hidden): ', controller.signal);
    const report = await runExperiment(credential, { attempts, signal: controller.signal });
    const directory = join(PROJECT_ROOT, 'log');
    await mkdir(directory, { recursive: true });
    const filename = `password-login-experiment-${Date.now()}.json`;
    await writeFile(join(directory, filename), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    process.stderr.write(`Report written: log/${filename}\n`);
  } catch {
    process.stderr.write('Experiment stopped. Use an interactive terminal and --attempts 1..3; input, browser or report operation failed.\n');
    process.exitCode = 1;
  } finally {
    if (credential) { credential.loginName = ''; credential.password = ''; }
    process.removeListener('SIGINT', onInterrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
