import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { METRIC_KINDS } from '../../src/infra/metrics.js';

it('statically checks every declared view metric kind against its output unit suffix', () => {
  const root = fileURLToPath(new URL('../../src/services/views/', import.meta.url));
  const kinds = new Set();
  let tableCount = 0;
  for (const file of readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(join(root, file), 'utf8');
    const declarations = [...source.matchAll(/^(?:export )?const (\w+) = metricTable\(\[([\s\S]*?)\]\);/gm)];
    assert.equal(declarations.length, [...source.matchAll(/\bmetricTable\s*\(/g)].length, `${file}: declare each metric table as a literal const`);
    for (const [, name, body] of declarations) {
      const entries = [...body.matchAll(/\['([^']+)', '([^']+)', '([^']+)'\]/g)];
      assert.ok(entries.length > 0, `${file}:${name} must declare metrics`);
      const keys = entries.map(([, key]) => key);
      assert.equal(new Set(keys).size, keys.length, `${file}:${name} duplicate metric keys`);
      for (const [, key, field, kind] of entries) {
        assert.ok(Object.hasOwn(METRIC_KINDS, kind), `${file}:${name}:${field} unknown kind ${kind}`);
        assert.ok(METRIC_KINDS[kind].suffixes.some((suffix) => key.endsWith(suffix)), `${file}:${name}:${key} mismatches ${kind}`);
        kinds.add(kind);
      }
      tableCount += 1;
    }
  }
  assert.ok(tableCount >= 3, 'customer service, traffic and goods traffic tables are covered');
  assert.deepEqual([...kinds].sort(), Object.keys(METRIC_KINDS).sort());
});
