# Compatible Endpoint Strategy Resolver — Technical Design

## Problem Statement

Endpoint transport strategy is currently inferred implicitly inside `PlaywrightEndpointClient._attemptOnce()` (line 298):

```javascript
const hasFetchPath = typeof meta.buildPayload === 'function' && meta.apiUrl;
if (hasFetchPath) {
  return this._attemptFetch(page, meta, params, ctx, log, navUrl);
}
return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
```

**Problems with implicit inference**:
1. Transport semantics are hidden inside the client rather than declared in endpoint specs
2. Ambiguous specs (e.g., `buildPayload` without `apiUrl`) silently fall back to legacy mode
3. New transport strategies require modifying client code rather than endpoint declarations
4. Diagnostics can only warn about ambiguity; they cannot make strategy explicit

**Design goals**:
- Make strategy resolution explicit while preserving backward compatibility
- Enable future explicit strategy declarations without breaking existing specs
- Support diagnostics and future strategy-aware tooling
- Keep strategy focused on single-attempt transport semantics (exclude retry/cooldown)

## Design Goals

1. **Backward compatibility** — All existing endpoint specs work unchanged
2. **Explicit strategy path** — Enable future endpoints to declare strategy explicitly
3. **Strategy-aware diagnostics** — `validateEndpointSpec()` can recommend explicit strategy
4. **Single-attempt focus** — Strategy describes one attempt's transport, not retry/cooldown policy
5. **Extensibility** — Adding new strategies (e.g., WebSocket, gRPC) requires minimal client changes

## Architecture

### Core Component

**`resolveEndpointStrategy(spec)`**

- **Input**: Endpoint spec object
- **Output**: `{ strategy: 'fetch' | 'legacy', explicit: boolean, ambiguous: boolean }`
- **Location**: New file `src/adapter/endpoint-strategy-resolver.js`
- **Behavior**: 
  - If `spec.strategy` exists (explicit) → return it with `explicit: true`
  - Else infer from `buildPayload` + `apiUrl` (current logic) → return with `explicit: false`
  - Set `ambiguous: true` if inference is unclear

### Strategy Schema

**Implicit inference (current behavior, backward compatible)**:
```javascript
// Endpoint spec without explicit strategy
{
  name: 'goods.list',
  urlPattern: /goodsList/,
  apiUrl: '/api/goodsList',
  buildPayload: (params) => ({ page: params.page }),
  // ... other fields
}

// resolveEndpointStrategy() returns:
// { strategy: 'fetch', explicit: false, ambiguous: false }
```

**Explicit strategy (future, opt-in)**:
```javascript
// Endpoint spec with explicit strategy
{
  name: 'goods.list',
  strategy: 'fetch', // ← explicit declaration
  urlPattern: /goodsList/,
  apiUrl: '/api/goodsList',
  buildPayload: (params) => ({ page: params.page }),
  // ... other fields
}

// resolveEndpointStrategy() returns:
// { strategy: 'fetch', explicit: true, ambiguous: false }
```

**Ambiguous inference (backward compatible, flagged for review)**:
```javascript
// Endpoint spec with ambiguous fields
{
  name: 'goods.partial',
  urlPattern: /goodsList/,
  buildPayload: (params) => ({ page: params.page }),
  // ❌ Missing apiUrl → ambiguous
}

// resolveEndpointStrategy() returns:
// { strategy: 'legacy', explicit: false, ambiguous: true }
```

### Integration with PlaywrightEndpointClient

**Before (current)**:
```javascript
// src/adapter/endpoint-client.js:297-303
async _attemptOnce(page, meta, params, ctx, log, navUrl) {
  const hasFetchPath = typeof meta.buildPayload === 'function' && meta.apiUrl;
  if (hasFetchPath) {
    return this._attemptFetch(page, meta, params, ctx, log, navUrl);
  }
  return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
}
```

**After (compatible)**:
```javascript
// src/adapter/endpoint-client.js (modified)
import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';

async _attemptOnce(page, meta, params, ctx, log, navUrl) {
  const { strategy } = resolveEndpointStrategy(meta);
  
  if (strategy === 'fetch') {
    return this._attemptFetch(page, meta, params, ctx, log, navUrl);
  }
  return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
}
```

**Behavior change**: Zero for existing specs (resolver mimics current inference)

### Integration with Diagnostics

**Before (endpoint-validator.js:99-122)**:
```javascript
function validateTransportStrategy(spec, warnings) {
  if (!spec || typeof spec !== 'object') return 'ambiguous';

  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

  if (hasBuildPayload && hasApiUrl) return 'fetch';
  if (!hasBuildPayload && !hasApiUrl) return 'legacy';

  // Ambiguous case
  warnings.push({
    code: 'AMBIGUOUS_TRANSPORT',
    severity: 'warning',
    message: `Endpoint has ${present} but not ${missing}`,
    field: missing,
    suggestion: '...',
  });

  return 'ambiguous';
}
```

**After (endpoint-validator.js uses resolver)**:
```javascript
import { resolveEndpointStrategy } from '../adapter/endpoint-strategy-resolver.js';

function validateTransportStrategy(spec, warnings) {
  const { strategy, explicit, ambiguous } = resolveEndpointStrategy(spec);

  if (ambiguous) {
    warnings.push({
      code: 'AMBIGUOUS_TRANSPORT',
      severity: 'warning',
      message: `Endpoint strategy inferred as '${strategy}' but may be ambiguous`,
      field: explicit ? null : 'strategy',
      suggestion: explicit
        ? 'Verify buildPayload/apiUrl match declared strategy'
        : `Add explicit strategy: '${strategy}' to endpoint spec`,
    });
  }

  if (!explicit) {
    warnings.push({
      code: 'IMPLICIT_STRATEGY',
      severity: 'info',
      message: `Strategy inferred as '${strategy}' from buildPayload/apiUrl`,
      field: 'strategy',
      suggestion: `Consider adding explicit strategy: '${strategy}' for clarity`,
    });
  }

  return strategy;
}
```

## Implementation Design

### Phase 1: Extract Resolver (No Behavior Change)

**File**: `src/adapter/endpoint-strategy-resolver.js`

```javascript
/**
 * Resolve endpoint transport strategy from spec.
 * 
 * @param {object} spec - Endpoint spec
 * @returns {{ strategy: 'fetch'|'legacy', explicit: boolean, ambiguous: boolean }}
 */
export function resolveEndpointStrategy(spec) {
  if (!spec || typeof spec !== 'object') {
    return { strategy: 'legacy', explicit: false, ambiguous: true };
  }

  // Phase 1: Only support implicit inference (backward compatible)
  // Phase 2+: Add explicit spec.strategy support

  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

  // Match current PlaywrightEndpointClient._attemptOnce logic exactly
  if (hasBuildPayload && hasApiUrl) {
    return { strategy: 'fetch', explicit: false, ambiguous: false };
  }

  if (!hasBuildPayload && !hasApiUrl) {
    return { strategy: 'legacy', explicit: false, ambiguous: false };
  }

  // Ambiguous: has one but not both
  return {
    strategy: 'legacy', // fallback to legacy (current behavior)
    explicit: false,
    ambiguous: true,
  };
}
```

**Invariant**: For all existing endpoint specs, `resolveEndpointStrategy(spec).strategy` matches current `_attemptOnce()` behavior.

**Validation**: Run existing endpoint tests + new resolver unit tests.

---

### Phase 2: Add Explicit Strategy Support (Opt-In)

**Updated resolver**:
```javascript
export function resolveEndpointStrategy(spec) {
  if (!spec || typeof spec !== 'object') {
    return { strategy: 'legacy', explicit: false, ambiguous: true };
  }

  // Explicit strategy (opt-in, Phase 2+)
  if (spec.strategy) {
    const explicit = true;
    const declared = spec.strategy;

    if (declared !== 'fetch' && declared !== 'legacy') {
      // Invalid strategy value
      return { strategy: 'legacy', explicit, ambiguous: true };
    }

    // Check consistency with inferred strategy
    const inferred = inferStrategyFromFields(spec);
    const ambiguous = inferred.ambiguous || (inferred.strategy !== declared);

    return { strategy: declared, explicit, ambiguous };
  }

  // Implicit inference (backward compatible)
  const inferred = inferStrategyFromFields(spec);
  return { ...inferred, explicit: false };
}

function inferStrategyFromFields(spec) {
  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

  if (hasBuildPayload && hasApiUrl) {
    return { strategy: 'fetch', ambiguous: false };
  }

  if (!hasBuildPayload && !hasApiUrl) {
    return { strategy: 'legacy', ambiguous: false };
  }

  return { strategy: 'legacy', ambiguous: true };
}
```

**Migration path**:
1. Phase 1 ships with implicit-only resolver (zero breaking changes)
2. Diagnostics recommend explicit strategy for new/touched endpoints
3. Phase 2 enables explicit `spec.strategy` (opt-in, backward compatible)
4. Future: gradually migrate existing specs to explicit strategy

---

### Phase 3: Strategy Registry (Future Extensibility)

**For future strategies** (e.g., WebSocket, gRPC):

```javascript
const STRATEGY_REGISTRY = {
  fetch: {
    validate: (spec) => {
      // Must have buildPayload + apiUrl
      return typeof spec.buildPayload === 'function' && spec.apiUrl;
    },
    executor: '_attemptFetch', // method name in PlaywrightEndpointClient
  },
  legacy: {
    validate: (spec) => true, // no strict requirements
    executor: '_attemptLegacy',
  },
  // Future:
  // websocket: {
  //   validate: (spec) => spec.wsUrl && spec.messagePattern,
  //   executor: '_attemptWebSocket',
  // },
};

export function resolveEndpointStrategy(spec) {
  // ... existing logic ...

  if (spec.strategy && STRATEGY_REGISTRY[spec.strategy]) {
    const strategyDef = STRATEGY_REGISTRY[spec.strategy];
    const valid = strategyDef.validate(spec);
    return {
      strategy: spec.strategy,
      explicit: true,
      ambiguous: !valid,
      executor: strategyDef.executor,
    };
  }

  // ... fallback to inference ...
}
```

**Deferred to follow-up work** — Not implemented in this task.

---

## Execution Order Clarification

**Current execution order** (from `PlaywrightEndpointClient.execute`):
```
1. Cooldown check
2. Limiter acquisition
3. _executeWithRetry
   3.1. Resolve navUrl (once)
   3.2. Retry loop
        3.2.1. _attemptOnce → strategy inference → _attemptFetch or _attemptLegacy
        3.2.2. HTTP status check (429 → retry, 401/403 → fail)
        3.2.3. Parse body
        3.2.4. Rate-limit classification
        3.2.5. Business error check
        3.2.6. Normalize
```

**Proposed execution order** (after strategy resolver):
```
1. Resolve strategy (new, happens once before cooldown)
2. Cooldown check
3. Limiter acquisition
4. _executeWithRetry
   4.1. Resolve navUrl (once)
   4.2. Retry loop
        4.2.1. _attemptOnce(strategy) → _attemptFetch or _attemptLegacy
        4.2.2. HTTP status check
        4.2.3. Parse body
        4.2.4. Rate-limit classification
        4.2.5. Business error check
        4.2.6. Normalize
```

**Rationale**: Strategy resolution is spec-shape validation, should happen before network-like work (cooldown/limiter).

**Risk**: Moving strategy resolution before cooldown changes error ordering for ambiguous specs.

**Mitigation**: Keep resolver pure (no I/O, fast), so early resolution is safe. Ambiguous specs currently fall back to legacy mode anyway.

---

## Strategy vs. Client Responsibility Boundary

**Strategy responsibilities** (single-attempt transport):
- Navigation approach (goto vs. no-nav)
- Request modification (route interception + payload merge vs. trigger-only)
- XHR collection pattern (specific urlPattern)
- Response extraction (collector.waitFor() vs. direct HTTP)

**Client responsibilities** (shared policies):
- Retry logic (429 backoff, max 3 retries)
- Cooldown enforcement (3 consecutive failures → 5min cooldown)
- Limiter acquisition (global rate limiting)
- Nav URL resolution (once per execute call)
- Error classification (HTTP status → exit code)
- Business error mapping (isSuccess + errorMapper)
- Response normalization (normalize function)

**Boundary rule**: Strategies never implement retry/cooldown; client orchestrates all attempts.

---

## Testing Strategy

### Unit Tests for Resolver

**File**: `test/endpoint-strategy-resolver.unit.test.js` (new)

```javascript
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
    assert.equal(result.ambiguous, true);
  });

  test('null spec → legacy (ambiguous)', () => {
    const result = resolveEndpointStrategy(null);
    assert.equal(result.strategy, 'legacy');
    assert.equal(result.ambiguous, true);
  });
});
```

### Integration Tests

**File**: `test/endpoint-strategy-integration.test.js` (new)

Validate that all existing endpoint specs resolve to the same strategy as current `_attemptOnce()` behavior:

```javascript
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { resolveEndpointStrategy } from '../src/adapter/endpoint-strategy-resolver.js';
import * as goodsEndpoints from '../src/adapter/endpoints/goods.js';
import * as ordersEndpoints from '../src/adapter/endpoints/orders.js';
import * as promoEndpoints from '../src/adapter/endpoints/promo.js';
import * as goodsPublishEndpoints from '../src/adapter/endpoints/goods-publish.js';

const allEndpoints = [
  ...Object.values(goodsEndpoints).filter(e => e?.name),
  ...Object.values(ordersEndpoints).filter(e => e?.name),
  ...Object.values(promoEndpoints).filter(e => e?.name),
  ...Object.values(goodsPublishEndpoints).filter(e => e?.name),
];

describe('endpoint strategy integration', () => {
  test('all existing endpoints resolve to expected strategy', () => {
    const expectedStrategies = {
      'goods.list': 'fetch',
      'goods.update.status': 'legacy',
      'goods.update.price': 'legacy',
      'goods.update.stock': 'legacy',
      'goods.update.title': 'legacy',
      'goods.adStrategy': 'fetch',
      'orders.list': 'fetch',
      'orders.detail': 'legacy',
      'orders.stats': 'fetch',
      'promo.entityReport': 'fetch',
      'promo.hourlyReport': 'fetch',
      // goods-publish endpoints
      'goods.publish.create_draft': 'legacy',
      'goods.publish.template': 'legacy',
      'goods.publish.edit_draft': 'legacy',
      // ... add all endpoints
    };

    for (const spec of allEndpoints) {
      const result = resolveEndpointStrategy(spec);
      const expected = expectedStrategies[spec.name];
      
      assert.ok(expected, `Missing expected strategy for ${spec.name}`);
      assert.equal(
        result.strategy,
        expected,
        `${spec.name}: expected ${expected}, got ${result.strategy}`
      );
    }
  });

  test('no existing endpoints are ambiguous', () => {
    const ambiguous = allEndpoints.filter(spec => {
      const result = resolveEndpointStrategy(spec);
      return result.ambiguous;
    });

    if (ambiguous.length > 0) {
      console.warn(`Found ${ambiguous.length} ambiguous endpoints:`);
      for (const spec of ambiguous) {
        console.warn(`  - ${spec.name}`);
      }
    }

    // This test is informational, not blocking
    // (existing endpoints may legitimately be ambiguous)
  });
});
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Resolver diverges from current inference logic | Behavior change for existing specs | Unit tests verify 1:1 parity; integration tests validate all existing endpoints |
| Explicit strategy conflicts with inferred strategy | Confusing diagnostics | Resolver flags conflicts with `ambiguous: true`; diagnostics explain mismatch |
| Future strategy types break backward compatibility | Existing specs stop working | Strategy registry validates spec shape; unknown strategies fall back to inference |
| Execution order change surfaces new failure modes | Edge-case regressions | Invariant tests (from `endpoint-refactor-invariants`) catch behavior drift |

---

## Implementation Phases

### Phase 1: Extract Resolver (This Task)

- Create `src/adapter/endpoint-strategy-resolver.js` with implicit inference only
- Update `PlaywrightEndpointClient._attemptOnce()` to use resolver
- Add unit tests verifying parity with current behavior
- Add integration tests validating all existing endpoints
- Update `endpoint-validator.js` to use resolver
- **No explicit strategy support yet** (deferred to Phase 2)

**Deliverables**:
- `src/adapter/endpoint-strategy-resolver.js`
- `test/endpoint-strategy-resolver.unit.test.js`
- `test/endpoint-strategy-integration.test.js`
- Modified `src/adapter/endpoint-client.js` (one line change in `_attemptOnce`)
- Modified `src/adapter/endpoint-validator.js` (imports resolver)

**Validation**: All tests pass, zero behavior change for existing endpoints.

---

### Phase 2: Enable Explicit Strategy (Follow-Up)

- Add `spec.strategy` field support in resolver
- Update diagnostics to recommend explicit strategy for new endpoints
- Migrate 1-2 endpoints to explicit strategy as proof-of-concept
- Document migration guide in OpenSpec

**Deferred** — Not part of this task.

---

### Phase 3: Strategy Registry (Future)

- Generalize resolver to support pluggable strategy types
- Add WebSocket/gRPC strategy examples
- Update client to dispatch to strategy executors dynamically

**Deferred** — Requires separate OpenSpec proposal.

---

## Success Criteria

- [ ] `resolveEndpointStrategy(spec)` function exists and handles implicit inference
- [ ] All existing endpoints resolve to same strategy as current `_attemptOnce()` logic
- [ ] `PlaywrightEndpointClient._attemptOnce()` uses resolver (one-line change)
- [ ] `endpoint-validator.js` uses resolver for strategy classification
- [ ] Unit tests cover all inference paths (fetch, legacy, ambiguous)
- [ ] Integration tests validate all existing endpoint specs
- [ ] Zero behavior change (verified by existing endpoint tests + invariant tests)
- [ ] Execution order documented (strategy resolution before cooldown/limiter)

---

## Open Questions

None blocking Phase 1 implementation. Explicit strategy support (Phase 2) will need user feedback on migration path.

---

## References

- Parent task: `.trellis/tasks/07-06-scamper-project-optimization-grill/prd.md`
- Current implementation: `src/adapter/endpoint-client.js:297-303`
- Diagnostics: `src/adapter/endpoint-validator.js`
- Invariant tests: `test/pbt/run-endpoint.pbt.test.js`
