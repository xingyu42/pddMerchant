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

test('pdd action --help lists plan subcommand', () => {
  const result = runPdd(['action', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /\bplan\b/);
});

test('pdd action plan --help shows --limit and --break-even options', () => {
  const result = runPdd(['action', 'plan', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /--limit/);
  assert.match(out, /--break-even/);
  assert.match(out, /--compare/);
  assert.match(out, /--no-promo/);
  assert.match(out, /--no-segment/);
});

test('pdd action bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['action', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});
