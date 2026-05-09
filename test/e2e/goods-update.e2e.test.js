import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runPdd, assertOkEnvelope, assertFailEnvelope } from './_helpers.js';

// --- Task 6.3: dry-run returns planned change without mutation ---
test('e2e: goods update status dry-run returns plan', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'status',
    '--goods-id', '1001', '--status', 'onsale', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.status');
  assert.equal(envelope.data.dry_run, true);
  assert.equal(envelope.data.goods_id, 1001);
  assert.equal(envelope.data.field, 'status');
  assert.equal(envelope.data.value, 'onsale');
  assert.equal(envelope.meta.xhr_count, 0);
});

test('e2e: goods update price dry-run returns plan', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'price',
    '--goods-id', '1001', '--price', '2999', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.price');
  assert.equal(envelope.data.dry_run, true);
  assert.equal(envelope.data.value, 2999);
});

test('e2e: goods update stock dry-run returns plan', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'stock',
    '--goods-id', '1001', '--quantity', '50', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.stock');
  assert.equal(envelope.data.dry_run, true);
  assert.equal(envelope.data.value, 50);
});

test('e2e: goods update title dry-run returns plan', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'title',
    '--goods-id', '1001', '--title', '新标题测试', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.title');
  assert.equal(envelope.data.dry_run, true);
  assert.equal(envelope.data.value, '新标题测试');
});

// --- Task 6.4: --confirm mode returns actual write result ---
test('e2e: goods update status --confirm returns write result', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'status',
    '--goods-id', '1001', '--status', 'onsale', '--confirm', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.status');
  assert.equal(envelope.data.dry_run, false);
  assert.ok(envelope.data.result);
  assert.equal(envelope.meta.xhr_count, 1);
  assert.equal(envelope.meta.confirm, true);
});

test('e2e: goods update price --confirm returns write result', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'price',
    '--goods-id', '1001', '--price', '2999', '--confirm', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.price');
  assert.equal(envelope.data.dry_run, false);
  assert.equal(envelope.meta.confirm, true);
});

// --- Task 6.5: --all-accounts rejected with E_USAGE ---
test('e2e: goods update status --all-accounts rejected', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'status',
    '--goods-id', '1001', '--status', 'onsale', '--all-accounts', '--json',
  ]);
  assert.equal(status, 2);
  assertFailEnvelope(envelope, 'goods.update.status', 'E_USAGE');
});

// --- Task 6.8: invalid goods_id rejected ---
test('e2e: goods update status with invalid goods_id rejected', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'status',
    '--goods-id', '0', '--status', 'onsale', '--json',
  ]);
  assert.equal(status, 2);
  assertFailEnvelope(envelope, 'goods.update.status', 'E_USAGE');
});

// --- Task 6.9: invalid value rejected ---
test('e2e: goods update price with negative price rejected', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'price',
    '--goods-id', '1001', '--price', '-100', '--json',
  ]);
  assert.equal(status, 2);
  assertFailEnvelope(envelope, 'goods.update.price', 'E_USAGE');
});

test('e2e: goods update title with empty title rejected', () => {
  const { status, envelope } = runPdd([
    'goods', 'update', 'title',
    '--goods-id', '1001', '--title', '   ', '--json',
  ]);
  assert.equal(status, 2);
  assertFailEnvelope(envelope, 'goods.update.title', 'E_USAGE');
});

// --- Task 6.6: batch partial failure returns exit code 7 ---
test('e2e: goods update batch dry-run returns plans', () => {
  const changes = JSON.stringify([
    { goods_id: 1001, field: 'price', value: 2999 },
    { goods_id: 1002, field: 'stock', value: 50 },
  ]);
  const { status, envelope } = runPdd([
    'goods', 'update', 'batch',
    '--changes', changes, '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.batch');
  assert.equal(envelope.data.dry_run, true);
  assert.equal(envelope.data.count, 2);
  assert.ok(Array.isArray(envelope.data.planned));
});

// --- Task 6.7: batch all-success returns exit code 0 ---
test('e2e: goods update batch --confirm all-success returns exit 0', () => {
  const changes = JSON.stringify([
    { goods_id: 1001, field: 'status', value: 'onsale' },
  ]);
  const { status, envelope } = runPdd([
    'goods', 'update', 'batch',
    '--changes', changes, '--confirm', '--json',
  ]);
  assert.equal(status, 0);
  assertOkEnvelope(envelope, 'goods.update.batch');
  assert.equal(envelope.data.dry_run, false);
  assert.equal(envelope.data.succeeded, 1);
  assert.equal(envelope.data.failed, 0);
});

// --- Task 6.11: help shows all subcommands ---
test('e2e: pdd goods update --help shows all subcommands', () => {
  const { status, stdout, stderr } = runPdd(['goods', 'update', '--help']);
  const output = stdout + stderr;
  assert.ok(output.includes('status'), 'help missing: status');
  assert.ok(output.includes('price'), 'help missing: price');
  assert.ok(output.includes('stock'), 'help missing: stock');
  assert.ok(output.includes('title'), 'help missing: title');
  assert.ok(output.includes('batch'), 'help missing: batch');
});
