import { it } from 'vitest';
import assert from 'node:assert/strict';
import { InvalidArgumentError } from 'commander';
import { integerArg } from '../../src/commands/option-parsers.js';
import { runCli } from '../helpers/isolated-cli.js';

it('parses integers at or above the minimum', () => {
  assert.equal(integerArg(1)('20'), 20);
  assert.equal(integerArg(1)(' 3 '), 3);
  assert.equal(integerArg(0)('0'), 0);
  assert.equal(integerArg(0)('1700000000'), 1700000000);
});

it.each([['abc', 1], ['', 1], ['1.5', 1], ['1e3', 1], ['0x10', 1], ['0', 1], ['-1', 0], ['99999999999999999', 0]])(
  'rejects %s with minimum %s', (value, min) => {
    assert.throws(() => integerArg(min)(value), InvalidArgumentError);
  });

it.each([
  ['orders', 'list', '--since', 'abc'],
  ['orders', 'list', '--size', '0'],
  ['orders', 'stats', '--size', '1.5'],
  ['goods', 'list', '--size', '-1'],
  ['goods', 'stock', '--threshold', 'x'],
  ['goods', 'segment', '--max-pages', '0'],
  ['promo', 'roi', '--page', '0'],
  ['promo', 'roi', '--by', 'foo'],
])('rejects %s %s %s %s as usage error before running', (...args) => {
  const result = runCli(args);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
  assert.equal(result.envelope.meta.xhr_count ?? 0, 0);
});
