import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { FixtureEndpointClient, clearFixtureCache } from '../../src/adapter/mock-dispatcher.js';

describe('FixtureEndpointClient PBT', () => {
  it('PROP-FX-1: idempotent + cache immutability — repeated execute returns deep-equal results', async () => {
    const originalEnv = process.env.PDD_TEST_ADAPTER;
    process.env.PDD_TEST_ADAPTER = 'fixture';

    try {
      const client = new FixtureEndpointClient();
      const spec = {
        name: 'orders.list',
        normalize: (raw) => raw,
      };

      const r1 = await client.execute(spec, { page: 1 }, {});
      const r2 = await client.execute(spec, { page: 1 }, {});

      assert.deepStrictEqual(r1.data, r2.data, 'results should be deep-equal');

      if (r1.data && typeof r1.data === 'object') {
        r1.data.__mutated = true;
        const r3 = await client.execute(spec, { page: 1 }, {});
        assert.ok(!r3.data.__mutated, 'cache should be immune to caller mutation');
      }
    } finally {
      clearFixtureCache();
      if (originalEnv !== undefined) {
        process.env.PDD_TEST_ADAPTER = originalEnv;
      } else {
        delete process.env.PDD_TEST_ADAPTER;
      }
    }
  });
});
