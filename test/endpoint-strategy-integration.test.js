import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { resolveEndpointStrategy } from '../src/adapter/endpoint-strategy-resolver.js';
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

const expectedStrategies = {
  'goods.list': 'fetch',
  'goods.adStrategy': 'fetch',
  'goods.update.status': 'legacy',
  'goods.update.price': 'legacy',
  'goods.update.stock': 'legacy',
  'goods.update.title': 'legacy',
  'orders.list': 'fetch',
  'orders.detail': 'legacy',
  'orders.stats': 'fetch',
  'promo.entityReport': 'fetch',
  'promo.hourlyReport': 'fetch',
  'goods.publish.create_draft': 'legacy',
  'goods.publish.template': 'legacy',
  'goods.publish.edit_draft': 'legacy',
  'goods.publish.save_decoration': 'legacy',
  'goods.publish.submit': 'legacy',
  'goods.publish.cost_template_list': 'legacy',
};

describe('endpoint strategy integration', () => {
  test('all existing endpoints resolve to expected strategy', () => {
    for (const spec of allEndpoints) {
      const result = resolveEndpointStrategy(spec);
      const expected = expectedStrategies[spec.name];

      assert.ok(expected !== undefined, `missing expected strategy for ${spec.name}`);
      assert.equal(
        result.strategy,
        expected,
        `${spec.name}: expected '${expected}', got '${result.strategy}'`,
      );
    }
  });

  test('expected strategy map covers all existing endpoints', () => {
    const specNames = new Set(allEndpoints.map((s) => s.name));
    const mapNames = new Set(Object.keys(expectedStrategies));

    for (const name of specNames) {
      assert.ok(mapNames.has(name), `endpoint '${name}' missing from expectedStrategies`);
    }
  });

  test('no existing endpoints are ambiguous', () => {
    const ambiguous = allEndpoints.filter((spec) => resolveEndpointStrategy(spec).ambiguous);

    assert.equal(
      ambiguous.length,
      0,
      `found ${ambiguous.length} ambiguous endpoint(s): ${ambiguous.map((s) => s.name).join(', ')}`,
    );
  });

  test('all existing endpoints resolve with explicit=false (Phase 1)', () => {
    for (const spec of allEndpoints) {
      const result = resolveEndpointStrategy(spec);
      assert.equal(
        result.explicit,
        false,
        `${spec.name}: expected explicit=false in Phase 1`,
      );
    }
  });
});
