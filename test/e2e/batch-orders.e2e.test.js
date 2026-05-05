import { test, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPdd, assertOkEnvelope, PROJECT_ROOT, FIXTURE_DIR } from './_helpers.js';

const DATA_DIR = join(PROJECT_ROOT, 'data');
const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json');
const MULTI_FIXTURE = join(PROJECT_ROOT, 'test', 'fixtures', 'multi-account', 'accounts.json');

let originalAccounts = null;

function writeMultiAccountRegistry() {
  const multi = JSON.parse(readFileSync(MULTI_FIXTURE, 'utf8'));
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(multi, null, 2), 'utf8');
}

function restoreAccountRegistry() {
  if (originalAccounts !== null) {
    writeFileSync(ACCOUNTS_FILE, originalAccounts, 'utf8');
  }
}

beforeAll(() => {
  if (existsSync(ACCOUNTS_FILE)) {
    originalAccounts = readFileSync(ACCOUNTS_FILE, 'utf8');
  }
});

afterAll(() => {
  restoreAccountRegistry();
});

test('e2e: --all-accounts batch runs across all enabled accounts', () => {
  writeMultiAccountRegistry();
  try {
    const { status, envelope, stderr } = runPdd(['orders', 'list', '--json', '--all-accounts', '--size', '3']);
    assert.ok(envelope, `envelope must parse; stderr: ${stderr}`);
    assert.strictEqual(envelope.meta.batch, true);
    assert.ok(envelope.data.accounts, 'must have accounts map');
    assert.ok(envelope.data.summary, 'must have summary');
    assert.strictEqual(envelope.data.summary.total_accounts, 2, 'disabled account excluded');
    assert.ok('shop-a' in envelope.data.accounts, 'shop-a present');
    assert.ok('shop-b' in envelope.data.accounts, 'shop-b present');
    assert.ok(!('shop-c' in envelope.data.accounts), 'disabled shop-c excluded');
    for (const slug of ['shop-a', 'shop-b']) {
      const acct = envelope.data.accounts[slug];
      assert.strictEqual(typeof acct.ok, 'boolean', `${slug} must have ok field`);
    }
  } finally {
    restoreAccountRegistry();
  }
});

test('e2e: --all-accounts + --account is mutual exclusion error', () => {
  writeMultiAccountRegistry();
  try {
    const { status, envelope } = runPdd(['orders', 'list', '--json', '--all-accounts', '--account', 'shop-a']);
    assert.ok(envelope);
    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.error.code, 'E_USAGE');
    assert.strictEqual(status, 2);
  } finally {
    restoreAccountRegistry();
  }
});

test('e2e: --all-accounts with no registered accounts returns E_USAGE', () => {
  const emptyReg = {
    version: 1,
    defaultAccount: null,
    updatedAt: '2026-05-05T00:00:00.000Z',
    accounts: {},
  };
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(emptyReg, null, 2), 'utf8');
  try {
    const { status, envelope } = runPdd(['orders', 'list', '--json', '--all-accounts']);
    assert.ok(envelope);
    assert.strictEqual(envelope.ok, false);
    assert.strictEqual(envelope.error.code, 'E_USAGE');
  } finally {
    restoreAccountRegistry();
  }
});

test('e2e: --all-accounts with all disabled accounts returns ok with empty summary', () => {
  const allDisabled = {
    version: 1,
    defaultAccount: null,
    updatedAt: '2026-05-05T00:00:00.000Z',
    accounts: {
      'dis-a': {
        slug: 'dis-a', displayName: '停用A', mallId: '111',
        credential: null, createdAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z', disabled: true,
      },
    },
  };
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(allDisabled, null, 2), 'utf8');
  try {
    const { status, envelope } = runPdd(['orders', 'list', '--json', '--all-accounts']);
    assert.ok(envelope);
    assert.strictEqual(envelope.ok, true);
    assert.strictEqual(envelope.meta.batch, true);
    assert.strictEqual(envelope.data.summary.total_accounts, 0);
    assert.strictEqual(envelope.data.summary.succeeded, 0);
    assert.strictEqual(status, 0);
  } finally {
    restoreAccountRegistry();
  }
});

test('e2e: --all-accounts on needsAuth=false command is silently ignored', () => {
  writeMultiAccountRegistry();
  try {
    const { status, envelope, stderr } = runPdd(['doctor', '--json', '--all-accounts']);
    assert.ok(envelope, `must parse; stderr: ${stderr}`);
    assert.strictEqual(envelope.meta.batch, undefined, 'non-auth command should not batch');
  } finally {
    restoreAccountRegistry();
  }
});

test('e2e: --all-accounts + --mall produces warning', () => {
  writeMultiAccountRegistry();
  try {
    const { envelope } = runPdd(['orders', 'list', '--json', '--all-accounts', '--mall', '999']);
    assert.ok(envelope);
    if (envelope.meta.batch) {
      assert.ok(
        (envelope.meta.warnings ?? []).includes('unused_flag_mall_in_batch'),
        'should warn about unused --mall in batch'
      );
    }
  } finally {
    restoreAccountRegistry();
  }
});
