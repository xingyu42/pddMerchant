import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ENV_KEYS = [
  'PDD_ACCOUNTS_DIR',
  'PDD_ACCOUNT_REGISTRY_PATH',
  'PDD_CONSUMER_ACCOUNTS_DIR',
  'PDD_CONSUMER_ACCOUNT_REGISTRY_PATH',
  'PDD_CONSUMER_AUTH_STATE_PATH',
];

let root;
let originalEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pdd-auth-storage-'));
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.PDD_ACCOUNTS_DIR = join(root, 'merchant', 'stores');
  process.env.PDD_ACCOUNT_REGISTRY_PATH = join(root, 'merchant', 'stores', 'registry.json');
  process.env.PDD_CONSUMER_ACCOUNTS_DIR = join(root, 'consumer', 'accounts');
  process.env.PDD_CONSUMER_ACCOUNT_REGISTRY_PATH = join(root, 'consumer', 'accounts', 'registry.json');
  delete process.env.PDD_CONSUMER_AUTH_STATE_PATH;
  vi.resetModules();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

describe('business auth storage', () => {
  it('stores merchant auth under the normalized store name', async () => {
    const sourcePath = join(root, 'merchant-login.json');
    await writeFile(sourcePath, '{"cookies":[],"origins":[]}');
    const { provisionMerchantAuth } = await import('../src/services/auth-account-storage.js');
    const { accountAuthStatePath } = await import('../src/infra/paths.js');

    const result = await provisionMerchantAuth(sourcePath, {
      mallId: '123456',
      displayName: '测试 店铺',
    });

    assert.equal(result.account.slug, '测试-店铺');
    assert.equal(result.authPath, accountAuthStatePath('测试-店铺'));
    assert.deepEqual(JSON.parse(await readFile(result.authPath, 'utf8')), { cookies: [], origins: [] });
  });

  it('keeps a full phone nickname in the consumer directory and resolves it as default', async () => {
    const sourcePath = join(root, 'consumer-login.json');
    await writeFile(sourcePath, '{"cookies":[],"origins":[]}');
    const { provisionConsumerAuth } = await import('../src/services/auth-account-storage.js');
    const { resolveConsumerAccountContext } = await import('../src/infra/consumer-account-resolver.js');

    const provisioned = await provisionConsumerAuth(sourcePath, {
      uid: '90001',
      nickname: '13800138000',
    });
    const resolved = await resolveConsumerAccountContext();

    assert.equal(provisioned.account.slug, '13800138000');
    assert.equal(resolved.slug, '13800138000');
    assert.equal(resolved.source, 'default');
    assert.equal(resolved.authPath, provisioned.authPath);
  });

  it('rekeys a consumer directory when nickname changes but uid stays stable', async () => {
    const firstSource = join(root, 'consumer-first.json');
    const secondSource = join(root, 'consumer-second.json');
    await writeFile(firstSource, '{"cookies":[{"name":"first"}],"origins":[]}');
    await writeFile(secondSource, '{"cookies":[{"name":"second"}],"origins":[]}');
    const { provisionConsumerAuth } = await import('../src/services/auth-account-storage.js');

    const first = await provisionConsumerAuth(firstSource, { uid: '42', nickname: '旧昵称' });
    const second = await provisionConsumerAuth(secondSource, { uid: '42', nickname: '新昵称' });

    assert.equal(first.account.slug, '旧昵称');
    assert.equal(second.account.slug, '新昵称');
    assert.deepEqual(JSON.parse(await readFile(second.authPath, 'utf8')).cookies, [{ name: 'second' }]);
    await assert.rejects(access(first.authPath), (error) => error.code === 'ENOENT');
  });

  it('selects a registered consumer explicitly when multiple accounts exist', async () => {
    const firstSource = join(root, 'consumer-one.json');
    const secondSource = join(root, 'consumer-two.json');
    await writeFile(firstSource, '{"cookies":[],"origins":[]}');
    await writeFile(secondSource, '{"cookies":[],"origins":[]}');
    const { provisionConsumerAuth } = await import('../src/services/auth-account-storage.js');
    const { resolveConsumerAccountContext } = await import('../src/infra/consumer-account-resolver.js');

    const first = await provisionConsumerAuth(firstSource, { uid: '101', nickname: '账号甲' });
    const second = await provisionConsumerAuth(secondSource, { uid: '202', nickname: '账号乙' });
    const selected = await resolveConsumerAccountContext({ account: first.account.slug });
    const defaultAccount = await resolveConsumerAccountContext();

    assert.equal(selected.source, 'flag');
    assert.equal(selected.authPath, first.authPath);
    assert.equal(defaultAccount.authPath, second.authPath);
  });
});
