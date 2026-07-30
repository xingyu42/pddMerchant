import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { resolveEndpointStrategy } from '../src/adapter/endpoint-strategy-resolver.js';

describe('resolveEndpointStrategy', () => {
  test('buildPayload + apiUrl → fetch (implicit)', () => {
    const spec = {
      name: 'test.fetch',
      urlPattern: /test/,
      apiUrl: '/api/test',
      buildPayload: () => ({}),
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'fetch');
    assert.equal(result.explicit, false);
    assert.equal(result.ambiguous, false);
  });

  test('no buildPayload, no apiUrl → legacy (implicit)', () => {
    const spec = {
      name: 'test.legacy',
      urlPattern: /test/,
      trigger: async () => {},
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.explicit, false);
    assert.equal(result.ambiguous, false);
  });

  test('buildPayload without apiUrl → legacy (ambiguous)', () => {
    const spec = {
      name: 'test.ambiguous',
      urlPattern: /test/,
      buildPayload: () => ({}),
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.explicit, false);
    assert.equal(result.ambiguous, true);
  });

  test('apiUrl without buildPayload → legacy (ambiguous)', () => {
    const spec = {
      name: 'test.ambiguous2',
      urlPattern: /test/,
      apiUrl: '/api/test',
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.explicit, false);
    assert.equal(result.ambiguous, true);
  });

  test('null spec → legacy (ambiguous)', () => {
    const result = resolveEndpointStrategy(null);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.explicit, false);
    assert.equal(result.ambiguous, true);
  });

  test('empty string apiUrl treated as no apiUrl', () => {
    const spec = {
      name: 'test.emptyUrl',
      urlPattern: /test/,
      apiUrl: '',
      buildPayload: () => ({}),
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.ambiguous, true);
  });

  test('non-function buildPayload treated as no buildPayload', () => {
    const spec = {
      name: 'test.nonFn',
      urlPattern: /test/,
      apiUrl: '/api/test',
      buildPayload: 'not a function',
    };
    const result = resolveEndpointStrategy(spec);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.ambiguous, true);
  });

  test('explicit page-api resolves only when apiUrl and buildPayload are complete', () => {
    assert.deepEqual(
      resolveEndpointStrategy({
        strategy: 'page-api',
        apiUrl: '/api/test',
        buildPayload: () => ({}),
      }),
      { strategy: 'page-api', explicit: true, ambiguous: false },
    );
    assert.equal(
      resolveEndpointStrategy({ strategy: 'page-api', apiUrl: '/api/test' }).ambiguous,
      true,
    );
  });
});
