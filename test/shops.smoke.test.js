import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = join(__dirname, '..', 'bin', 'pdd.js');

function runPdd(args, env = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1', ...env },
  });
}

test('pdd shops --help exits 0 and lists list+current subcommands', () => {
  const result = runPdd(['shops', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\blist\b/, 'shops --help must mention "list" subcommand');
  assert.match(out, /\bcurrent\b/, 'shops --help must mention "current" subcommand');
});

test('pdd shops list --help exits 0 and shows command name', () => {
  const result = runPdd(['shops', 'list', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /Usage:\s+pdd shops list/);
});

test('pdd shops current --help exits 0 and shows command name', () => {
  const result = runPdd(['shops', 'current', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /Usage:\s+pdd shops current/);
});

test('pdd shops bogus-sub exits 2 (USAGE) for unknown subcommand', () => {
  const result = runPdd(['shops', 'bogus-sub']);
  assert.equal(
    result.status,
    2,
    `expected exit=2 for unknown subcommand, got ${result.status}\nstderr: ${result.stderr}`
  );
});

test('pdd --help mentions shops domain group', () => {
  const result = runPdd(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout ?? '', /shops/);
});
