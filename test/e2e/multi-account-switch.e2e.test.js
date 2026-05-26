import { test, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPdd, assertOkEnvelope, assertFailEnvelope, PROJECT_ROOT } from './_helpers.js';

const MULTI_FIXTURE = join(PROJECT_ROOT, 'test', 'fixtures', 'multi-account', 'accounts.json');

let tmpDir;
let accountEnv;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pdd-switch-e2e-'));
  const accountsDir = join(tmpDir, 'accounts');
  const accountsFile = join(tmpDir, 'accounts.json');
  await mkdir(accountsDir, { recursive: true });
  await copyFile(MULTI_FIXTURE, accountsFile);
  accountEnv = {
    PDD_ACCOUNT_REGISTRY_PATH: accountsFile,
    PDD_ACCOUNTS_DIR: accountsDir,
  };
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

test('e2e: --account flag passes through to command context', () => {
  const { status, envelope } = runPdd(['shops', 'current', '--json', '--account', 'shop-a'], accountEnv);
  assert.equal(status, 0, `exit=${status}`);
  assertOkEnvelope(envelope, 'shops.current');
  assert.equal(envelope.meta.account, 'shop-a');
  assert.equal(envelope.meta.account_source, 'flag');
});

test('e2e: --account with unknown slug returns account error', () => {
  const { status, envelope } = runPdd(['shops', 'current', '--json', '--account', 'nonexistent'], accountEnv);
  assert.equal(status, 2, `exit=${status}`);
  assertFailEnvelope(envelope, 'shops.current', 'E_ACCOUNT_NOT_FOUND');
});
