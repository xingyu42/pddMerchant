import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { it } from 'vitest';
import { createDaemonSandbox, consoleLink, parseDaemonResult } from '../helpers/daemon-cli.js';
import { consoleRequest } from '../helpers/console-http.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { getDatabasePath, openDatabase, closeDatabase } from '../../src/infra/db.js';
import { getReloginState, listPendingActions } from '../../src/infra/account-store.js';
import { CLI_LOG_DIR, DAEMON_LOG_DIR } from '../../src/infra/paths.js';

const cliPath = fileURLToPath(new URL('../../bin/pdd.js', import.meta.url));
const credential = { loginName: 'P4-private-login-7462', password: 'P4-private-password-8642' };
const otherAccounts = ['two', 'three'].map((slug, index) => ({ slug, display_name: slug, identity: String(900002 + index) }));

function ordinary(sandbox) {
  return parseDaemonResult(spawnSync(process.execPath, [cliPath, 'shops', 'current', '--json'], {
    cwd: sandbox.root, env: sandbox.env, encoding: 'utf8', timeout: 30000, windowsHide: true,
  }));
}

async function setup({ accounts = [DEFAULT_ACCOUNT], password = true, challenge = 'unknown' } = {}) {
  const sandbox = await createDaemonSandbox();
  Object.assign(sandbox.env, { PDD_TEST_PASSWORD_LOGIN: `challenge:${challenge}`, PDD_TEST_AUTH_INVALID: '1',
    PDD_TEST_PASSWORD_LOGIN_TRACE: join(sandbox.root, 'attempts.log'), PDD_DEBUG_RAW: '1', PDD_LOG_LEVEL: 'debug' });
  seedDb(sandbox.env.PDD_DB_PATH, { accounts,
    authStates: accounts.map((account) => ({ slug: account.slug, state: { cookies: [], origins: [] } })),
    passwordCredentials: password ? accounts.map((account) => ({ slug: account.slug, ...credential })) : [] });
  const first = password ? ordinary(sandbox) : null;
  const started = sandbox.cli('start');
  assert.equal(started.envelope.ok, true);
  const link = consoleLink(sandbox);
  const port = Number(sandbox.env.PDD_CONSOLE_PORT);
  const redeemed = await consoleRequest(port, '/api/redeem', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
    body: JSON.stringify({ token: new URL(link.envelope.data.url).pathname.split('/').at(-1) }) });
  assert.equal(redeemed.status, 200);
  const headers = { Cookie: redeemed.headers['set-cookie'][0].split(';')[0] };
  return { sandbox, port, headers, output: [first?.stdout ?? '', first?.stderr ?? '', started.stdout, started.stderr], first };
}

async function api(test, path, body, expected = 200) {
  const response = await consoleRequest(test.port, path, body === undefined ? { headers: test.headers }
    : { method: 'POST', headers: { ...test.headers, 'Content-Type': 'application/json', 'X-PDD-Console': '1' }, body: JSON.stringify(body) });
  test.output.push(response.body);
  assert.equal(response.status, expected, response.body);
  return JSON.parse(response.body);
}

async function start(test, slug = DEFAULT_ACCOUNT.slug, mode = 'relogin', state = 'takeover') {
  const { session_id: id } = await api(test, `/api/accounts/${slug}/${mode}`, {});
  assert.match(id, /^[\w-]{22}$/);
  for (let index = 0; index < 60; index++) {
    const session = await api(test, `/api/sessions/${id}`);
    if (session.state === state) return id;
    assert.equal(session.state, 'filling');
    await sleep(50);
  }
  assert.fail('session did not become interactive');
}

function frames(test, id) {
  let connection;
  let finish;
  const ended = new Promise((resolve) => { finish = resolve; });
  const first = new Promise((resolve, reject) => {
    connection = request({ port: test.port, hostname: '127.0.0.1', path: `/api/sessions/${id}/frames`, headers: test.headers }, (response) => {
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'text/event-stream');
      assert.equal(response.headers['cache-control'], 'no-store');
      let buffer = '';
      response.on('data', (chunk) => {
        const text = chunk.toString();
        test.output.push(text);
        buffer += text;
        if (buffer.includes('\n\n')) resolve(buffer.split('\n\n')[0]);
      });
      response.on('end', finish);
      response.on('close', finish);
    });
    connection.on('error', reject);
    connection.setTimeout(5000, () => connection.destroy(new Error('frame timeout')));
    connection.end();
  });
  return { first, ended, close: () => connection.destroy() };
}

function readState(test) {
  const previous = getDatabasePath();
  openDatabase(test.sandbox.env.PDD_DB_PATH);
  try { return { state: getReloginState(1), actions: listPendingActions(1).filter((action) => action.status === 'open') }; }
  finally { closeDatabase(); openDatabase(previous); }
}

function assertSecrets(test) {
  const logs = [CLI_LOG_DIR, DAEMON_LOG_DIR].flatMap((directory) => existsSync(directory)
    ? readdirSync(directory).filter((name) => name.endsWith('.log')).map((name) => readFileSync(join(directory, name), 'utf8')) : []);
  for (const secret of Object.values(credential)) {
    assert.equal([...test.output, ...logs].join('').includes(secret), false, 'credential leaked');
  }
}

async function dispose(test) {
  const stopped = test.sandbox.cli('stop');
  test.output.push(stopped.stdout, stopped.stderr);
  assertSecrets(test);
  test.sandbox.dispose();
}

it('recovers awaiting-human through SSE takeover, clears actions, and ordinary commands reuse the saved marker', async () => {
  const test = await setup();
  let stream;
  try {
    assert.equal(test.first.envelope.error.code, 'E_AUTH_HUMAN_REQUIRED');
    assert.equal(readState(test).state.status, 'awaiting_human');
    const id = await start(test);
    const session = await api(test, `/api/sessions/${id}`);
    assert.deepEqual(Object.keys(session), ['state', 'message', 'remaining_seconds', 'expires_at', 'qr_image']);
    assert.ok(session.remaining_seconds > 590 && session.remaining_seconds <= 600);
    stream = frames(test, id);
    const event = await stream.first;
    assert.match(event, /^event: frame\ndata: /);
    const frame = JSON.parse(event.split('\ndata: ')[1]);
    assert.deepEqual(Object.keys(frame), ['jpeg', 'width', 'height']);
    await exerciseInput(test, id);
    await api(test, `/api/sessions/${id}/fixture-complete`, { outcome: 'success' });
    await stream.ended;
    assert.equal((await api(test, `/api/sessions/${id}`)).state, 'succeeded');
    assert.equal(readState(test).state.status, 'available');
    assert.deepEqual(readState(test).actions, []);
    const before = readFileSync(test.sandbox.env.PDD_TEST_PASSWORD_LOGIN_TRACE, 'utf8');
    const result = ordinary(test.sandbox);
    test.output.push(result.stdout, result.stderr);
    assert.equal(result.status, 0);
    assert.equal(readFileSync(test.sandbox.env.PDD_TEST_PASSWORD_LOGIN_TRACE, 'utf8'), before);
    assert.equal(before.trim().split(/\r?\n/).length, 2);
  } finally { stream?.close(); await dispose(test); }
});

async function exerciseInput(test, id) {
  const released = await api(test, `/api/sessions/${id}/pointer`, {
    events: [{ t: 0, type: 'down', x: 0.5, y: 0.5 }, { t: 50, type: 'up', x: 1, y: 1 }],
  });
  assert.deepEqual(released, { ok: true, editable: false, numeric: false });
  const moved = await api(test, `/api/sessions/${id}/pointer`, { events: [{ t: 51, type: 'move', x: 1, y: 1 }] });
  assert.deepEqual(moved, { ok: true, editable: null, numeric: null });
  await api(test, `/api/sessions/${id}/text`, { text: '123456' });
  for (const key of ['Enter', 'Backspace', 'Tab']) await api(test, `/api/sessions/${id}/text`, { key });
  await api(test, `/api/sessions/${id}/pointer`, { events: [{ t: 1, type: 'down', x: 2, y: 0 }] }, 400);
  await api(test, `/api/sessions/${id}/text`, { text: 'x'.repeat(65) }, 400);
  await api(test, `/api/sessions/${id}/text`, { key: 'Escape' }, 400);
}

it('asks for the SMS code in the console without a takeover picture', async () => {
  const test = await setup({ challenge: 'sms' });
  try {
    const id = await start(test, DEFAULT_ACCOUNT.slug, 'relogin', 'sms');
    const session = await api(test, `/api/sessions/${id}`);
    assert.match(session.message, /短信验证码/);
    await api(test, `/api/sessions/${id}/frames`, undefined, 409);
    await api(test, `/api/sessions/${id}/pointer`, { events: [{ t: 0, type: 'up', x: 0, y: 0 }] }, 409);
    for (const code of ['12', '1234567890', 'abcdef']) await api(test, `/api/sessions/${id}/sms`, { code }, 400);
    assert.deepEqual(await api(test, `/api/sessions/${id}/sms`, { code: '123456' }), { ok: true, result: 'submitted' });
    await api(test, `/api/sessions/${id}/fixture-complete`, { outcome: 'success' });
    for (let index = 0; index < 60 && (await api(test, `/api/sessions/${id}`)).state !== 'succeeded'; index++) await sleep(50);
    assert.equal((await api(test, `/api/sessions/${id}`)).state, 'succeeded');
    assert.equal(readState(test).state.status, 'available');
  } finally { await dispose(test); }
});

it('blocks after two takeover timeouts, rejects both modes until unblock, and QR success resets the counter', async () => {
  const test = await setup();
  try {
    for (let count = 1; count <= 2; count++) {
      const id = await start(test);
      await api(test, `/api/sessions/${id}/fixture-complete`, { outcome: 'timeout' });
      assert.equal((await api(test, `/api/sessions/${id}`)).state, 'timed_out');
      assert.equal(readState(test).state.consecutive_takeover_timeouts, count);
    }
    assert.equal(readState(test).state.status, 'blocked');
    for (const mode of ['relogin', 'qr']) {
      const failure = await api(test, `/api/accounts/${DEFAULT_ACCOUNT.slug}/${mode}`, {}, 409);
      assert.equal(failure.error.code, 'E_AUTH_RELOGIN_BLOCKED');
    }
    await api(test, `/api/accounts/${DEFAULT_ACCOUNT.slug}/unblock`, {});
    const cancelled = await start(test);
    await api(test, `/api/sessions/${cancelled}/cancel`, {});
    assert.equal((await api(test, `/api/sessions/${cancelled}`)).state, 'cancelled');
    assert.equal(readState(test).state.consecutive_takeover_timeouts, 0);
    const timeout = await start(test);
    await api(test, `/api/sessions/${timeout}/fixture-complete`, { outcome: 'timeout' });
    const qr = await start(test, DEFAULT_ACCOUNT.slug, 'qr', 'qr');
    assert.match((await api(test, `/api/sessions/${qr}`)).qr_image, /^data:image\/png;base64,/);
    await api(test, `/api/sessions/${qr}/qr/refresh`, {});
    await api(test, `/api/sessions/${qr}/fixture-complete`, { outcome: 'success' });
    assert.equal(readState(test).state.consecutive_takeover_timeouts, 0);
    assert.equal(readState(test).state.status, 'available');
  } finally { await dispose(test); }
});

it('replaces the same account session, caps concurrent accounts at two, and daemon stop closes streams', async () => {
  const test = await setup({ accounts: [DEFAULT_ACCOUNT, ...otherAccounts] });
  let stream;
  try {
    const first = await start(test);
    const replacement = await start(test);
    assert.equal((await api(test, `/api/sessions/${first}`)).state, 'cancelled');
    const second = await start(test, 'two');
    const busy = await api(test, '/api/accounts/three/relogin', {}, 429);
    assert.equal(busy.error.code, 'E_CONSOLE_BUSY');
    await api(test, `/api/sessions/${second}/cancel`, {});
    await start(test, 'three');
    stream = frames(test, replacement);
    await stream.first;
    const stopped = test.sandbox.cli('stop');
    test.output.push(stopped.stdout, stopped.stderr);
    assert.equal(stopped.envelope.data.stopped, true);
    await stream.ended;
    assert.equal(readState(test).state.consecutive_takeover_timeouts, 0);
  } finally { stream?.close(); await dispose(test); }
});

it('allows QR with no credential and rejects password mode with HTTP 409', async () => {
  const test = await setup({ password: false });
  try {
    await api(test, `/api/accounts/${DEFAULT_ACCOUNT.slug}/relogin`, {}, 409);
    const id = await start(test, DEFAULT_ACCOUNT.slug, 'qr', 'qr');
    await api(test, `/api/sessions/${id}/fixture-complete`, { outcome: 'success' });
    assert.equal((await api(test, `/api/sessions/${id}`)).state, 'succeeded');
    assert.equal(ordinary(test.sandbox).status, 0);
  } finally { await dispose(test); }
});
