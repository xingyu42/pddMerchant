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

test('pdd promo --help lists only roi subcommand (search/scene removed in promotion-merge)', () => {
  const result = runPdd(['promo', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /\broi\b/);
  assert.doesNotMatch(out, /\bsearch\b/);
  assert.doesNotMatch(out, /\bscene\b/);
  assert.doesNotMatch(out, /\bddk\b/);
});

test('pdd promo search is rejected as unknown subcommand (removed in promotion-merge)', () => {
  const result = runPdd(['promo', 'search']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd promo scene is rejected as unknown subcommand (removed in promotion-merge)', () => {
  const result = runPdd(['promo', 'scene']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd promo ddk is rejected as unknown subcommand (V0.2 removed)', () => {
  const result = runPdd(['promo', 'ddk']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd promo bogus-sub exits 2 (USAGE)', () => {
  const result = runPdd(['promo', 'bogus-sub']);
  assert.equal(result.status, 2, `stderr: ${result.stderr}`);
});

test('pdd promo roi --help shows --by and --break-even options', () => {
  const result = runPdd(['promo', 'roi', '--help']);
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const out = result.stdout ?? '';
  assert.match(out, /--by/);
  assert.match(out, /--break-even/);
  assert.match(out, /--include-inactive/);
});
