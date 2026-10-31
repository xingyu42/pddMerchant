import { it } from 'vitest';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { register as registerDiagnose } from '../../src/commands/registry/diagnose.js';
import { register as registerGoods } from '../../src/commands/registry/goods.js';
import { runCli } from '../helpers/isolated-cli.js';

it.each(['README.md', 'skills/pdd-cli/SKILL.md', '.trellis/spec/services/domain-service-contracts.md'])(
  'documents both traffic commands and the unverified promo caliber in %s', (path) => {
    const documentation = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    for (const phrase of ['diagnose traffic', 'goods traffic', 'non_promo']) {
      assert.ok(documentation.includes(phrase), `${path}: ${phrase}`);
    }
  });

it('README states the promo split has not been verified on a shop with live campaigns', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('尚未经有投放店铺实测'));
});

it('registers both authenticated traffic commands with a thirty-day default', () => {
  const program = new Command();
  const wired = [];
  const wire = (command, name, run) => wired.push({ command, name, run });
  registerDiagnose(program, wire);
  registerGoods(program, wire);
  for (const name of ['diagnose.traffic', 'goods.traffic']) {
    const entry = wired.find((item) => item.name === name);
    assert.ok(entry, name);
    assert.equal(typeof entry.run, 'function');
    assert.equal(entry.command.options.find((option) => option.long === '--days').defaultValue, 30);
  }
});

it.each([['diagnose', '0'], ['goods', '31']])('returns usage exit two for invalid %s traffic days', (group, days) => {
  const result = runCli([group, 'traffic', '--days', days]);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
  assert.equal(result.envelope.command, `${group}.traffic`);
});

it('returns usage exit two for a non-numeric goods id', () => {
  const result = runCli(['goods', 'traffic', '--goods-id', 'abc']);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
});
