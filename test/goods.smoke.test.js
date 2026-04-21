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

test('pdd goods --help lists list/stock subcommands', () => {
  const result = runPdd(['goods', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\blist\b/);
  assert.match(out, /\bstock\b/);
});

test('pdd goods list --help shows --status option', () => {
  const result = runPdd(['goods', 'list', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /Usage:\s+pdd goods list/);
  assert.match(out, /--status/);
});

test('pdd goods stock --help shows --threshold option', () => {
  const result = runPdd(['goods', 'stock', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /--threshold/);
});

test('pdd goods bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['goods', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});
