import { test } from 'vitest';
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

test('pdd orders --help lists list/detail/stats subcommands', () => {
  const result = runPdd(['orders', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\blist\b/);
  assert.match(out, /\bdetail\b/);
  assert.match(out, /\bstats\b/);
});

test('pdd orders list --help shows --page/--size options', () => {
  const result = runPdd(['orders', 'list', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /Usage:\s+pdd orders list/);
  assert.match(out, /--page/);
  assert.match(out, /--size/);
});

test('pdd orders detail --help declares required --sn', () => {
  const result = runPdd(['orders', 'detail', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /--sn/);
});

test('pdd orders detail (missing --sn) exits 2 (USAGE)', () => {
  const result = runPdd(['orders', 'detail']);
  assert.equal(
    result.status,
    2,
    `required-option violation must map to USAGE=2, got ${result.status}\nstderr: ${result.stderr}`
  );
});

test('pdd orders stats --help shows --size', () => {
  const result = runPdd(['orders', 'stats', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /--size/);
});

test('pdd orders bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['orders', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});
