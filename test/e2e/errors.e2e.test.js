// E2E · error-path coverage
// 覆盖：登录失效（AUTH=3）/ fixture 缺失（GENERAL=1）
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runPdd, assertFailEnvelope, PROJECT_ROOT } from './_helpers.js';

test('e2e: auth expired via PDD_TEST_AUTH_INVALID=1 → exit 3 E_AUTH_EXPIRED', () => {
  const { status, envelope } = runPdd(['shops', 'list', '--json'], {
    PDD_TEST_AUTH_INVALID: '1',
  });
  assert.equal(status, 3, `AUTH exit code expected, got ${status}`);
  assertFailEnvelope(envelope, 'shops.list', 'E_AUTH_EXPIRED');
});

test('e2e: missing fixture dir → exit 1 E_FIXTURE_MISSING', () => {
  const { status, envelope } = runPdd(['orders', 'list', '--json'], {
    PDD_TEST_FIXTURE_DIR: join(PROJECT_ROOT, 'test', 'fixtures-does-not-exist'),
  });
  assert.equal(status, 1);
  assertFailEnvelope(envelope, 'orders.list', 'E_FIXTURE_MISSING');
});

test('e2e: mock adapter disabled by default → command fails at launchBrowser (no hang)', () => {
  // 不带 PDD_TEST_ADAPTER 时走真实 Playwright 路径。这里传超短 timeout，期望非 0 退出。
  const { status } = runPdd(['shops', 'list', '--json', '--timeout', '1'], {
    PDD_TEST_ADAPTER: '',
  });
  assert.notEqual(status, 0, '关闭 mock 后必然失败（无 auth-state 或无法启动 chromium）');
});
