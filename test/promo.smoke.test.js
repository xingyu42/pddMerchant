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

test('pdd promo --help lists search/scene subcommands', () => {
  const result = runPdd(['promo', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\bsearch\b/);
  assert.match(out, /\bscene\b/);
  assert.doesNotMatch(out, /\bddk\b/);
});

test('pdd promo search --help shows --since option', () => {
  const result = runPdd(['promo', 'search', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /Usage:\s+pdd promo search/);
  assert.match(out, /--since/);
});

test('pdd promo scene --help shows --since option', () => {
  const result = runPdd(['promo', 'scene', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout ?? '', /--since/);
});

test('pdd promo ddk is rejected as unknown subcommand (V0.2 removed)', () => {
  const result = runPdd(['promo', 'ddk']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd promo bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['promo', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});
