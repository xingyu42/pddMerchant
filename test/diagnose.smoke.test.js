import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'pdd.js');

function runPdd(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('pdd diagnose --help lists shop/orders/inventory/promo/funnel', () => {
  const result = runPdd(['diagnose', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\bshop\b/);
  assert.match(out, /\borders\b/);
  assert.match(out, /\binventory\b/);
  assert.match(out, /\bpromo\b/);
  assert.match(out, /\bfunnel\b/);
});

for (const sub of ['shop', 'orders', 'inventory', 'promo', 'funnel']) {
  test(`pdd diagnose ${sub} --help exits 0`, () => {
    const result = runPdd(['diagnose', sub, '--help']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout ?? '', new RegExp(`Usage:\\s+pdd diagnose ${sub}`));
  });
}

test('pdd diagnose bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['diagnose', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd diagnose shop --help shows --compare and --days options', () => {
  const result = runPdd(['diagnose', 'shop', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /--compare/);
  assert.match(out, /--days/);
});
