import { it } from 'vitest';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { register } from '../../src/commands/registry/diagnose.js';
import { runCli } from '../helpers/isolated-cli.js';

it.each(['README.md', 'skills/pdd-cli/SKILL.md', '.trellis/spec/services/domain-service-contracts.md'])(
  'documents the two report commands and their windows in %s', (path) => {
    const documentation = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    for (const phrase of ['diagnose customer-service', 'diagnose reviews', '63', '31', '180']) {
      assert.ok(documentation.includes(phrase), `${path}: ${phrase}`);
    }
  });

it('registers both authenticated report commands with a thirty-day default', () => {
  const program = new Command();
  const wired = [];
  register(program, (command, name, run) => wired.push({ command, name, run }));
  for (const name of ['diagnose.customer-service', 'diagnose.reviews']) {
    const entry = wired.find((item) => item.name === name);
    assert.ok(entry, name);
    assert.equal(typeof entry.run, 'function');
    assert.equal(entry.command.options.find((option) => option.long === '--days').defaultValue, 30);
  }
});

it.each([['customer-service', '64'], ['reviews', '45']])('returns usage exit two for invalid %s days', (name, days) => {
  const result = runCli(['diagnose', name, '--days', days]);
  assert.equal(result.status, 2);
  assert.equal(result.envelope.error.code, 'E_USAGE');
  assert.equal(result.envelope.command, `diagnose.${name}`);
  assert.ok(result.envelope.error.message.includes('--days'));
});
