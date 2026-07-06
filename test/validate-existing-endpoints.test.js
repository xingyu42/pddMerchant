import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { validateEndpointSpec } from '../src/adapter/endpoint-validator.js';
import * as goodsEndpoints from '../src/adapter/endpoints/goods.js';
import * as ordersEndpoints from '../src/adapter/endpoints/orders.js';
import * as promoEndpoints from '../src/adapter/endpoints/promo.js';
import * as goodsPublishEndpoints from '../src/adapter/endpoints/goods-publish.js';

const allEndpoints = [
  ...Object.values(goodsEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(ordersEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(promoEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(goodsPublishEndpoints).filter((e) => e?.name && e?.urlPattern),
];

describe('existing endpoint spec diagnostics', () => {
  test('all endpoint specs are collected', () => {
    assert.ok(allEndpoints.length >= 12, `expected >= 12 endpoints, got ${allEndpoints.length}`);
  });

  test('no critical errors in existing endpoints', () => {
    const failures = [];

    for (const spec of allEndpoints) {
      const result = validateEndpointSpec(spec);
      const errors = result.warnings.filter((w) => w.severity === 'error');

      if (errors.length > 0) {
        failures.push({ name: spec.name, errors });
      }
    }

    if (failures.length > 0) {
      const report = failures
        .map(({ name, errors }) => {
          const lines = errors.map((e) => `  [${e.code}] ${e.message}`);
          return `${name}:\n${lines.join('\n')}`;
        })
        .join('\n\n');
      assert.fail(`${failures.length} endpoint(s) have critical errors:\n\n${report}`);
    }
  });

  test('log warnings for existing endpoints (informational)', () => {
    const warningsByEndpoint = new Map();

    for (const spec of allEndpoints) {
      const result = validateEndpointSpec(spec);
      const warnings = result.warnings.filter((w) => w.severity === 'warning');

      if (warnings.length > 0) {
        warningsByEndpoint.set(spec.name, warnings);
      }
    }

    if (warningsByEndpoint.size > 0) {
      const lines = [];
      for (const [name, warnings] of warningsByEndpoint) {
        lines.push(`${name}:`);
        for (const w of warnings) {
          lines.push(`  [${w.code}] ${w.message}`);
        }
      }
      console.warn(`\n${warningsByEndpoint.size} endpoint(s) have warnings (non-blocking):\n${lines.join('\n')}`);
    }
  });

  test('every endpoint has an inferred strategy', () => {
    for (const spec of allEndpoints) {
      const result = validateEndpointSpec(spec);
      assert.ok(
        ['fetch', 'legacy', 'ambiguous'].includes(result.strategy),
        `${spec.name}: unexpected strategy ${result.strategy}`,
      );
    }
  });
});
