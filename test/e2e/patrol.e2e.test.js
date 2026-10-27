import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { it } from 'vitest';
import { createDaemonSandbox } from '../helpers/daemon-cli.js';
import { consoleRequest } from '../helpers/console-http.js';
import { seedDb, DEFAULT_ACCOUNT } from '../helpers/seed-db.js';
import { getDatabasePath, openDatabase, closeDatabase } from '../../src/infra/db.js';
import { getDaemonMeta } from '../../src/infra/daemon-state.js';
import { getReloginState, listPendingActions } from '../../src/infra/account-store.js';
import { loadAuthState } from '../../src/adapter/auth-state.js';

async function sandboxForPatrol({ enabled = true, outcome = 'success' } = {}) {
  const sandbox = await createDaemonSandbox();
  Object.assign(sandbox.env, { PDD_PATROL_ENABLED: String(enabled), PDD_TEST_PATROL_INTERVAL_MS: '100',
    PDD_TEST_AUTH_INVALID: '1', PDD_TEST_PASSWORD_LOGIN: outcome,
    PDD_TEST_PASSWORD_LOGIN_TRACE: join(sandbox.root, 'password-attempts.log') });
  seedDb(sandbox.env.PDD_DB_PATH, {
    accounts: [DEFAULT_ACCOUNT], authStates: [{ slug: DEFAULT_ACCOUNT.slug, state: { cookies: [], origins: [] } }],
    passwordCredentials: [{ slug: DEFAULT_ACCOUNT.slug, loginName: 'synthetic-patrol-login', password: 'synthetic-patrol-password' }],
  });
  return sandbox;
}

function snapshot(sandbox) {
  const previous = getDatabasePath();
  openDatabase(sandbox.env.PDD_DB_PATH);
  try {
    return { last: getDaemonMeta('daemon_last_patrol_at'), state: getReloginState(1), auth: loadAuthState(1),
      actions: listPendingActions(1).filter((action) => action.status === 'open') };
  } finally { closeDatabase(); openDatabase(previous); }
}

function attempts(sandbox) {
  const path = sandbox.env.PDD_TEST_PASSWORD_LOGIN_TRACE;
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
}

async function waitForPatrol(sandbox, after = null) {
  for (let index = 0; index < 100; index++) {
    const data = snapshot(sandbox);
    if (data.last && data.last !== after) return data;
    await sleep(50);
  }
  assert.fail('patrol did not complete a round');
}

it('fixture daemon recovers invalid auth once, persists it, and exposes the patrol timestamp in status and healthz', async () => {
  const sandbox = await sandboxForPatrol();
  try {
    assert.equal(sandbox.cli('start').envelope.ok, true);
    const first = await waitForPatrol(sandbox);
    await waitForPatrol(sandbox, first.last);
    assert.deepEqual(attempts(sandbox), ['success']);
    const data = snapshot(sandbox);
    assert.equal(data.state.reason, 'success');
    assert.equal(data.auth.revision, 2);
    assert.ok(data.auth.state.cookies.some((cookie) => cookie.name === 'PDD_FIXTURE_RELOGIN'));
    const status = sandbox.cli('status').envelope.data;
    assert.equal(status.patrol_enabled, true);
    assert.match(status.last_patrol_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const response = await consoleRequest(Number(sandbox.env.PDD_CONSOLE_PORT), '/healthz');
    assert.equal(response.status, 200);
    const health = JSON.parse(response.body);
    assert.equal(health.ok, true);
    assert.match(health.last_patrol_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('fixture patrol challenge creates an awaiting_human action and makes no second attempt next round', async () => {
  const sandbox = await sandboxForPatrol({ outcome: 'challenge:sms' });
  try {
    assert.equal(sandbox.cli('start').envelope.ok, true);
    const first = await waitForPatrol(sandbox);
    const next = await waitForPatrol(sandbox, first.last);
    assert.deepEqual(attempts(sandbox), ['challenge:sms']);
    assert.equal(next.state.status, 'awaiting_human');
    assert.equal(next.state.reason, 'sms');
    assert.deepEqual(next.actions.map(({ kind, reason }) => ({ kind, reason })), [{ kind: 'human_takeover', reason: 'sms' }]);
    assert.equal(next.auth.revision, 1);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});

it('default-disabled fixture daemon performs no patrol rounds even with a short fixture interval', async () => {
  const sandbox = await sandboxForPatrol({ enabled: false });
  delete sandbox.env.PDD_PATROL_ENABLED;
  try {
    assert.equal(sandbox.cli('start').envelope.ok, true);
    await sleep(450);
    const status = sandbox.cli('status').envelope.data;
    assert.equal(status.patrol_enabled, false);
    assert.equal(status.last_patrol_at, null);
    assert.deepEqual(attempts(sandbox), []);
    assert.equal(snapshot(sandbox).auth.revision, 1);
  } finally { sandbox.cli('stop'); sandbox.dispose(); }
});
