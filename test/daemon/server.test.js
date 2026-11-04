import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, it, vi } from 'vitest';
import { createConsoleServer } from '../../src/daemon/server.js';
import { runDaemon } from '../../src/daemon/run.js';
import { consoleBaseUrl, publishConsoleUrl } from '../../src/services/console-runtime.js';
import { createConsoleLink, redeemConsoleToken } from '../../src/services/console-auth.js';
import { acquireDaemonLease, readDaemonLease, getDaemonMeta, readDaemonOwnerToken, daemonBrowserOwnerTag } from '../../src/infra/daemon-state.js';
import { insertAccount, putReloginState, insertPendingAction } from '../../src/infra/account-store.js';
import { run } from '../../src/infra/db.js';
import { consoleRequest } from '../helpers/console-http.js';
import { CONSOLE_ACCOUNT_VIEW_FIELDS } from '../../src/services/views/console.js';

const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.stop(); });

async function setup(config = {}, serverOptions = {}) {
  await acquireDaemonLease();
  const server = createConsoleServer(serverOptions);
  servers.push(server);
  const log = { info: vi.fn(), warn: vi.fn() };
  const runtimeConfig = { consoleHost: '127.0.0.1', consolePort: 0, consolePublicUrl: '', ...config };
  await server.start({ runtimeConfig, log, ownerTag: daemonBrowserOwnerTag(readDaemonOwnerToken()) });
  const { url } = createConsoleLink();
  const consoleToken = new URL(url).pathname.split('/').at(-1);
  const { sessionValue: consoleSession } = redeemConsoleToken(consoleToken);
  const port = server.address().port;
  const headers = { Cookie: `pdd_console=${consoleSession}` };
  return { server, port, log, headers, runtimeConfig };
}

function assertSecurity(response, html = false) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  if (html) assert.equal(response.headers['content-security-policy'], "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'");
}

it('serves public health and protects every API/static route with security headers', async () => {
  const { port, headers } = await setup();
  const health = await consoleRequest(port, '/healthz');
  assert.equal(health.status, 200);
  const data = JSON.parse(health.body);
  assert.equal(data.lease, 'valid');
  assert.equal(data.last_patrol_at, null);
  assert.match(data.heartbeat_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assertSecurity(health);
  for (const path of ['/', '/api/accounts', '/api/sessions/unknown', '/api/sessions/unknown/frames',
    '/index.html', '/vendor/preact.module.js', '/unknown']) {
    const denied = await consoleRequest(port, path);
    assert.equal(denied.status, 401);
    assertSecurity(denied, path === '/');
    if (path === '/') assert.match(denied.body, /请通过 pdd console link 获取访问链接/);
  }
  const page = await consoleRequest(port, '/', { headers });
  assert.equal(page.status, 200);
  assertSecurity(page, true);
  assert.equal((await consoleRequest(port, '/missing.js', { headers })).status, 404);
  assert.equal((await consoleRequest(port, '/api/missing', { headers })).status, 404);
});

it('keeps every interactive POST behind session and JSON guards and omits fixture control in live dispatch', async () => {
  const { port, headers } = await setup();
  const paths = ['/api/accounts/unknown/relogin', '/api/accounts/unknown/qr', '/api/sessions/unknown/pointer',
    '/api/sessions/unknown/text', '/api/sessions/unknown/sms', '/api/sessions/unknown/qr/refresh', '/api/sessions/unknown/cancel',
    '/api/sessions/unknown/fixture-complete'];
  const json = { 'Content-Type': 'application/json', 'X-PDD-Console': '1' };
  for (const path of paths) {
    assert.equal((await consoleRequest(port, path, { method: 'POST', headers: json, body: '{}' })).status, 401);
    assert.equal((await consoleRequest(port, path, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await consoleRequest(port, path, { method: 'POST', headers: { ...headers, ...json }, body: '{}' })).status, 404);
  }
  const add = '/api/accounts/add';
  assert.equal((await consoleRequest(port, add, { method: 'POST', headers: json, body: '{}' })).status, 401);
  assert.equal((await consoleRequest(port, add, { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal((await consoleRequest(port, add, { method: 'POST', headers: { ...headers, ...json }, body: '{}' })).status, 400);
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  const live = await consoleRequest(port, '/api/sessions/unknown/fixture-complete', {
    method: 'POST', headers: { ...headers, ...json }, body: '{"outcome":"success"}',
  });
  assert.equal(live.status, 404);
  assert.equal(JSON.parse(live.body).error.code, 'E_NOT_FOUND');
});

it('rejects a foreign Host and accepts loopback aliases and configured reverse proxy hosts', async () => {
  const { port } = await setup({ consolePublicUrl: 'https://console.example' });
  for (const Host of ['evil.example', '127.0.0.1:1', 'console.example:443', 'console.example.evil']) {
    const result = await consoleRequest(port, '/healthz', { headers: { Host } });
    assert.equal(result.status, 421);
    assertSecurity(result);
  }
  for (const Host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'console.example']) {
    assert.equal((await consoleRequest(port, '/healthz', { headers: { Host } })).status, 200);
  }
});

it('requires POST, the console header and JSON for password writes', async () => {
  const { port, headers } = await setup();
  const path = '/api/accounts/unknown/password';
  const cases = [{}, { 'Content-Type': 'application/json' }, { 'X-PDD-Console': '1' },
    { 'X-PDD-Console': '1', 'Content-Type': 'text/plain' },
    { 'X-PDD-Console': '0', 'Content-Type': 'application/json' }];
  for (const extra of cases) {
    const response = await consoleRequest(port, path, { method: 'POST', headers: { ...headers, ...extra }, body: '{}' });
    assert.equal(response.status, 403);
    assertSecurity(response);
  }
  assert.equal((await consoleRequest(port, path, { headers })).status, 403);
  assert.equal((await consoleRequest(port, path, { method: 'PUT', headers: { ...headers,
    'X-PDD-Console': '1', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

it('keeps parser failures fixed and includes security headers even before routing', async () => {
  const { port } = await setup();
  const raw = await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let output = '';
    socket.on('error', reject);
    socket.on('data', (chunk) => { output += chunk; });
    socket.on('end', () => resolve(output));
    socket.on('connect', () => socket.end('GET /private-query HTTP/1.1\r\nHost: localhost\r\nInvalid Header: private-header\r\n\r\n'));
  });
  assert.match(raw, /^HTTP\/1.1 400/);
  assert.match(raw, /Cache-Control: no-store/);
  assert.match(raw, /X-Content-Type-Options: nosniff/);
  assert.match(raw, /Referrer-Policy: no-referrer/);
  assert.match(raw, /X-Frame-Options: DENY/);
  assert.equal(raw.includes('private-'), false);
});

it('rejects invalid JSON and bodies over 64 KiB including chunked transfers', async () => {
  const { port, headers } = await setup();
  const json = { ...headers, 'X-PDD-Console': '1', 'Content-Type': 'application/json' };
  const path = '/api/accounts/unknown/password';
  assert.equal((await consoleRequest(port, path, { method: 'POST', headers: json, body: '{broken' })).status, 400);
  for (const extra of [{ 'Content-Length': 65537 }, { 'Transfer-Encoding': 'chunked' }]) {
    const response = await consoleRequest(port, path, { method: 'POST', headers: { ...json, ...extra }, body: ' '.repeat(65537) });
    assert.equal(response.status, 413);
    assertSecurity(response);
  }
});

function uploadUntilClosed(port, chunked) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let output = '';
    let sent = 0;
    let uploading;
    const total = 1024 * 1024;
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Oversized upload stayed open')); }, 2000);
    socket.on('data', (chunk) => { output += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      clearInterval(uploading);
      clearTimeout(timeout);
      resolve({ output, sent, total });
    });
    socket.on('connect', () => {
      const framing = chunked ? 'Transfer-Encoding: chunked' : `Content-Length: ${total}`;
      socket.write(`POST /api/redeem HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nX-PDD-Console: 1\r\n${framing}\r\nConnection: keep-alive\r\n\r\n`);
      uploading = setInterval(() => {
        if (sent >= total) return;
        const chunk = ' '.repeat(16384);
        socket.write(chunked ? `4000\r\n${chunk}\r\n` : chunk);
        sent += chunk.length;
      }, 5);
    });
  });
}

it.each([false, true])('closes oversized public redemption uploads before consuming 1 MiB (chunked=%s)', async (chunked) => {
  const { port } = await setup();
  const { output, sent, total } = await uploadUntilClosed(port, chunked);
  assert.match(output, /^HTTP\/1.1 413/);
  assert.match(output, /Connection: close\r\n/i);
  assert.match(output, /E_CONSOLE_BODY_TOO_LARGE/);
  assert.ok(sent < total, `Connection consumed the full ${sent}-byte upload`);
});

it.each(['/../package.json', '/%2e%2e/package.json', '/vendor/%2e%2e/%2e%2e/infra/db.js',
  '/%252e%252e/package.json', '/vendor/..%2fpublic/index.html', '/vendor/%5c..%5cdb.js',
  '//etc/passwd', '/C:/Windows/win.ini', 'http://evil.example/healthz', '/%00index.html'])('rejects traversal or absolute path %s', async (path) => {
  const { port, headers } = await setup();
  const response = await consoleRequest(port, path, { headers });
  assert.equal(response.status, 404);
  assertSecurity(response);
});

it('keeps GET previews reusable and consumes links only on protected JSON POST redemption', async () => {
  const { port } = await setup({ consolePublicUrl: 'https://console.example' });
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  const { url } = createConsoleLink({ accountId: account.id });
  const path = new URL(url).pathname;
  for (let count = 0; count < 2; count++) {
    const preview = await consoleRequest(port, path);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers['set-cookie'], undefined);
    assert.match(preview.body, /<script src="\/app\/redeem.js" defer><\/script>/);
    assert.match(preview.body, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(preview.body, /<link rel="stylesheet" href="\/app\/styles.css">/);
    assert.match(preview.body, /<main><p>正在进入控制台，请稍候…<\/p><\/main>/);
    assert.equal(preview.body.includes(path.split('/').at(-1)), false);
    assertSecurity(preview, true);
  }
  assert.equal((await consoleRequest(port, '/app/redeem.js')).status, 200);
  const styles = await consoleRequest(port, '/app/styles.css');
  assert.equal(styles.status, 200);
  assert.match(styles.headers['content-type'], /text\/css/);
  assertSecurity(styles);
  assert.equal((await consoleRequest(port, '/app/app.js')).status, 401);
  assert.equal((await consoleRequest(port, '/api/redeem', { method: 'POST', body: '{}' })).status, 403);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
    body: JSON.stringify({ token: path.split('/').at(-1) }) };
  const response = await consoleRequest(port, '/api/redeem', options);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).location, `/#/accounts/${account.slug}`);
  assert.match(response.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Path=\/; Secure$/);
  assertSecurity(response);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  assert.equal((await consoleRequest(port, '/api/accounts', { headers: { Cookie: cookie } })).status, 200);
  const replay = await consoleRequest(port, '/api/redeem', options);
  assert.equal(replay.status, 410);
  assert.match(replay.body, /链接已失效，请重新获取/);
  assertSecurity(replay);
  // 已登录的浏览器再次打开用过的链接：直接进入控制台，不签发新会话。
  for (const token of [path.split('/').at(-1), 'invalid']) {
    const reopened = await consoleRequest(port, '/api/redeem', { ...options, headers: { ...options.headers, Cookie: cookie },
      body: JSON.stringify({ token }) });
    assert.equal(reopened.status, 200);
    assert.deepEqual(JSON.parse(reopened.body), { location: '/' });
    assert.equal(reopened.headers['set-cookie'], undefined);
  }
  const stale = await consoleRequest(port, '/api/redeem', { ...options, headers: { ...options.headers, Cookie: 'pdd_console=stale' } });
  assert.equal(stale.status, 410);
  assert.equal((await consoleRequest(port, '/c/invalid')).status, 200);
});

it('projects metadata without decrypting auth state and exposes only labeled account fields', async () => {
  const { port, headers } = await setup();
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  insertAccount({ kind: 'consumer', identity: 'uid', displayName: 'Consumer' });
  run(`INSERT INTO auth_states(account_id, revision, state_sealed, check_verdict, last_check_verdict, updated_at)
    VALUES (?, 1, 'undecryptable', 'verified', 'indeterminate', ?)`, account.id, new Date().toISOString());
  putReloginState(account.id, { status: 'awaiting_human', reason: 'sms' });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const response = await consoleRequest(port, '/api/accounts', { headers });
  const { items: accounts } = JSON.parse(response.body);
  assert.equal(accounts.length, 1);
  assert.deepEqual(Object.keys(accounts[0]), CONSOLE_ACCOUNT_VIEW_FIELDS);
  assert.equal(accounts[0].session_status, '无法判定');
  assert.equal(accounts[0].has_password, false);
  assert.equal(accounts[0].password_relogin_status, null);
  assert.equal(accounts[0].status_kind, 'action_required');
  assert.equal(accounts[0].status, '需验证');
  assert.equal(accounts[0].status_detail, '需要完成短信验证');
  assert.deepEqual(accounts[0].pending_actions[0], { kind: '人工接管', reason: '短信验证',
    created_at: accounts[0].pending_actions[0].created_at });
  assert.match(accounts[0].pending_actions[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(response.body.includes('undecryptable'), false);
});

it('projects an internal block without a saved password as paused', async () => {
  const { port, headers } = await setup();
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  putReloginState(account.id, { status: 'blocked', reason: 'wrong_password' });
  insertPendingAction(account.id, { kind: 'human_takeover', reason: 'sms' });
  const response = await consoleRequest(port, '/api/accounts', { headers });
  assert.equal(response.status, 200);
  const { items: [view] } = JSON.parse(response.body);
  assert.deepEqual(Object.keys(view), CONSOLE_ACCOUNT_VIEW_FIELDS);
  assert.equal(view.has_password, false);
  assert.equal(view.password_relogin_status, null);
  assert.equal(view.status_kind, 'relogin_paused');
  assert.equal(view.status, '暂停');
  assert.equal(view.status_detail, '自动登录暂停：密码错误');
});

it('writes and clears passwords, unblocks accounts and logs templates without secrets', async () => {
  const { port, headers, log } = await setup();
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  const json = { ...headers, 'X-PDD-Console': '1', 'Content-Type': 'application/json; charset=utf-8' };
  const base = `/api/accounts/${account.slug}`;
  const saved = await consoleRequest(port, `${base}/password?secret=query-private`, { method: 'POST', headers: json,
    body: JSON.stringify({ login_name: 'private-login-name', password: 'private-password' }) });
  assert.deepEqual(JSON.parse(saved.body), { ok: true, has_password: true });
  putReloginState(account.id, { status: 'blocked', reason: 'wrong_password' });
  assert.equal((await consoleRequest(port, `${base}/unblock`, { method: 'POST', headers: json, body: '{}' })).status, 200);
  const listed = await consoleRequest(port, '/api/accounts', { headers });
  assert.equal(JSON.parse(listed.body).items[0].password_relogin_status, '可用');
  const cleared = await consoleRequest(port, `${base}/password/clear`, { method: 'POST', headers: json, body: '{}' });
  assert.deepEqual(JSON.parse(cleared.body), { ok: true, has_password: false });
  for (const suffix of ['password', 'password/clear', 'unblock']) {
    assert.equal((await consoleRequest(port, `/api/accounts/missing/${suffix}`, { method: 'POST', headers: json, body: '{}' })).status, 404);
  }
  const access = JSON.stringify(log.info.mock.calls);
  for (const secret of ['private-login-name', 'private-password', 'query-private', headers.Cookie]) {
    assert.equal((saved.body + listed.body + cleared.body + access).includes(secret), false);
  }
  for (const [entry] of log.info.mock.calls) assert.deepEqual(Object.keys(entry), ['method', 'route', 'status', 'duration_ms']);
  assert.ok(access.includes('/api/accounts/:slug/password'));
});

it('removes an account only after the shop name is typed back', async () => {
  const { port, headers } = await setup();
  const account = insertAccount({ identity: '900001', displayName: 'Shop' });
  const json = { ...headers, 'X-PDD-Console': '1', 'Content-Type': 'application/json; charset=utf-8' };
  const remove = (body) => consoleRequest(port, `/api/accounts/${account.slug}/remove`, { method: 'POST', headers: json,
    body: JSON.stringify(body) });
  for (const body of [{}, { confirm_name: 'Other' }, { confirm_name: 1 }]) {
    const rejected = await remove(body);
    assert.equal(rejected.status, 400);
    assert.equal(JSON.parse(rejected.body).error.message, '店铺名不一致，未删除');
  }
  assert.equal(JSON.parse((await consoleRequest(port, '/api/accounts', { headers })).body).items.length, 1);
  assert.deepEqual(JSON.parse((await remove({ confirm_name: ' Shop ' })).body), { ok: true, removed: true });
  assert.equal(JSON.parse((await consoleRequest(port, '/api/accounts', { headers })).body).items.length, 0);
  assert.equal((await remove({ confirm_name: 'Shop' })).status, 404);
});

it('reads and switches the live patrol through GET and POST on one path', async () => {
  let enabled = false;
  const patrol = { isEnabled: () => enabled, setEnabled: vi.fn(async (next) => { enabled = next; }) };
  const { port, headers } = await setup({ patrolIntervalMs: 1_800_000 }, { patrol });
  const json = { ...headers, 'X-PDD-Console': '1', 'Content-Type': 'application/json; charset=utf-8' };
  const read = await consoleRequest(port, '/api/patrol', { headers });
  assert.deepEqual(JSON.parse(read.body), { enabled: false, interval_minutes: 30, last_patrol_at: null });
  const switched = await consoleRequest(port, '/api/patrol', { method: 'POST', headers: json, body: '{"enabled":true}' });
  assert.deepEqual([switched.status, JSON.parse(switched.body).enabled], [200, true]);
  assert.deepEqual(patrol.setEnabled.mock.calls, [[true]]);
  assert.equal((await consoleRequest(port, '/api/patrol', { method: 'POST', headers: json, body: '{"enabled":1}' })).status, 400);
  assert.equal((await consoleRequest(port, '/api/patrol')).status, 401);
});

it('maps occupied ports to the typed error and releases the daemon lease', async () => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(runDaemon({ foreground: false, runtimeConfig: { logLevel: 'silent',
      consoleHost: '127.0.0.1', consolePort: occupied.address().port, consolePublicUrl: '' } }),
    (error) => error.code === 'E_CONSOLE_PORT_IN_USE' && error.detail.reason === 'address_in_use');
    assert.equal(readDaemonLease(), null);
    assert.equal(getDaemonMeta('daemon_console_url'), null);
  } finally { await new Promise((resolve) => occupied.close(resolve)); }
});

it('publishes and clears addresses, brackets IPv6 and preserves replacement owner metadata', async () => {
  const { server, runtimeConfig, port, log } = await setup({ consoleHost: '0.0.0.0' });
  assert.match(log.warn.mock.calls[0][0], /http 明文传输/);
  assert.equal((await consoleRequest(port, '/healthz', { headers: { Host: `0.0.0.0:${port}` } })).status, 200);
  assert.equal((await consoleRequest(port, '/healthz', { headers: { Host: `localhost:${port}` } })).status, 421);
  assert.equal(getDaemonMeta('daemon_console_url'), consoleBaseUrl(runtimeConfig, server.address().port));
  await server.stop();
  assert.equal(getDaemonMeta('daemon_console_url'), null);
  assert.equal(consoleBaseUrl({ consoleHost: '::1', consolePort: 47821 }), 'http://[::1]:47821');
  assert.equal(consoleBaseUrl({ consoleHost: '::1', consolePort: 47821, consolePublicUrl: 'https://console.example/' }), 'https://console.example');
  const ownerTag = daemonBrowserOwnerTag(readDaemonOwnerToken());
  run("UPDATE leases SET owner_token = 'replacement' WHERE scope = 'daemon'");
  publishConsoleUrl('https://replacement.example');
  publishConsoleUrl(null, ownerTag);
  assert.equal(getDaemonMeta('daemon_console_url'), 'https://replacement.example');
});
