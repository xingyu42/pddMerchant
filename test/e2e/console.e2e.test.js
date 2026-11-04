import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { createDaemonSandbox, consoleLink } from '../helpers/daemon-cli.js';
import { consoleRequest } from '../helpers/console-http.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { CLI_LOG_DIR, DAEMON_LOG_DIR } from '../../src/infra/paths.js';

function assertNoSecrets(output, secrets) {
  for (const secret of secrets) assert.equal(output.includes(secret), false, 'secret appeared outside credential encryption');
}

function logContents(directory) {
  if (!existsSync(directory)) return '';
  return readdirSync(directory).filter((name) => name.endsWith('.log'))
    .map((name) => readFileSync(join(directory, name), 'utf8')).join('');
}

async function authorize(sandbox, args = []) {
  const link = consoleLink(sandbox, args);
  assert.equal(link.envelope.ok, true);
  const path = new URL(link.envelope.data.url).pathname;
  const port = Number(sandbox.env.PDD_CONSOLE_PORT);
  for (let count = 0; count < 2; count++) assert.equal((await consoleRequest(port, path)).status, 200);
  const redeemed = await consoleRequest(port, '/api/redeem', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
    body: JSON.stringify({ token: path.split('/').at(-1) }) });
  assert.equal(redeemed.status, 200);
  return { port, link, path, redeemed, cookie: redeemed.headers['set-cookie'][0].split(';')[0] };
}

it('console link requires an explicitly started daemon and rejects unknown account slugs', async () => {
  const sandbox = await createDaemonSandbox();
  try {
    const stopped = consoleLink(sandbox);
    assert.equal(stopped.envelope.error.code, 'E_DAEMON_NOT_RUNNING');
    assert.equal(stopped.status, 1);
    assert.match(stopped.envelope.error.hint, /pdd daemon start/);
    sandbox.cli('start');
    assert.equal(consoleLink(sandbox, ['--account', 'unknown']).envelope.error.code, 'E_ACCOUNT_NOT_FOUND');
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('fixture daemon links, authenticates, writes encrypted credentials without disclosure, rejects replay and stops', async () => {
  const sandbox = await createDaemonSandbox();
  sandbox.env.PDD_LOG_LEVEL = 'debug';
  sandbox.env.PDD_DEBUG_RAW = '1';
  const secrets = ['P3-private-password-7vQz', 'P3-private-login-8kNh'];
  seedDb(sandbox.env.PDD_DB_PATH, { accounts: [DEFAULT_ACCOUNT] });
  try {
    const started = sandbox.cli('start');
    assert.equal(started.envelope.ok, true);
    const { port, link, path, redeemed, cookie } = await authorize(sandbox, ['--account', DEFAULT_ACCOUNT.slug]);
    assert.equal(JSON.parse(redeemed.body).location, `/#/accounts/${DEFAULT_ACCOUNT.slug}`);
    const headers = { Cookie: cookie };
    const initial = await consoleRequest(port, '/api/accounts', { headers });
    assert.equal(initial.status, 200);
    assert.equal(JSON.parse(initial.body).items[0].has_password, false);
    assert.equal(JSON.parse(initial.body).items[0].session_status, null);
    assert.equal(JSON.parse(initial.body).items[0].status_kind, 'unknown');
    assert.equal(JSON.parse(initial.body).items[0].status, '未知');
    assert.equal(JSON.parse(initial.body).items[0].status_detail, '暂无核验记录');
    const saved = await consoleRequest(port, `/api/accounts/${DEFAULT_ACCOUNT.slug}/password`, { method: 'POST',
      headers: { ...headers, 'X-PDD-Console': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ login_name: secrets[1], password: secrets[0] }) });
    assert.deepEqual(JSON.parse(saved.body), { ok: true, has_password: true });
    const updated = await consoleRequest(port, '/api/accounts', { headers });
    assert.equal(JSON.parse(updated.body).items[0].has_password, true);
    const replay = await consoleRequest(port, '/api/redeem', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
      body: JSON.stringify({ token: path.split('/').at(-1) }) });
    assert.equal(replay.status, 410);
    assert.match(replay.body, /链接已失效，请重新获取/);
    assert.equal((await consoleRequest(port, '/api/accounts', { headers: { Cookie: 'pdd_console=unknown' } })).status, 401);
    const stopped = sandbox.cli('stop');
    assert.equal(stopped.envelope.data.stopped, true);
    assert.equal(sandbox.cli('status').envelope.data.console_url, null);
    assertNoSecrets(started.stdout + started.stderr + link.stdout + link.stderr + stopped.stdout + stopped.stderr
      + initial.body + saved.body + updated.body + replay.body, secrets);
    const logs = logContents(CLI_LOG_DIR) + logContents(DAEMON_LOG_DIR);
    assertNoSecrets(logs, secrets);
    assertNoSecrets(logs, [new URL(link.envelope.data.url).pathname.split('/').at(-1), cookie.split('=')[1]]);
    for (const name of readdirSync(sandbox.root).filter((name) => name.startsWith('pdd.db'))) {
      assertNoSecrets(readFileSync(join(sandbox.root, name)), secrets);
    }
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('an unbound link lands on the root and grants a normal console session', async () => {
  const sandbox = await createDaemonSandbox();
  try {
    sandbox.cli('start');
    const { port, redeemed, cookie } = await authorize(sandbox);
    assert.equal(JSON.parse(redeemed.body).location, '/');
    const page = await consoleRequest(port, '/', { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});
