# Endpoint Refactor Invariants — Technical Design

## Problem Statement

The upcoming endpoint refactoring tasks (`endpoint-strategy-resolver` and `endpoint-attempt-lifecycle-extraction`) will touch critical runtime behavior in `PlaywrightEndpointClient`. Without explicit invariant tests, these refactors risk introducing subtle regressions in:

- Navigation URL resolution timing (one-time evaluation)
- 429 retry count and backoff behavior
- Abort/timeout handling during endpoint attempts
- Route setup/cleanup for fetch-path interception
- Collector lifecycle and empty/unparsable body handling
- Error-code mapping stability (auth, network, rate-limit, business errors)

**Current coverage gaps**:
- Existing PBT tests (`test/pbt/run-endpoint.pbt.test.js`) cover some invariants but miss route cleanup, abort timing, and fixture/live boundary semantics
- Unit tests (`test/run-endpoint.unit.test.js`, `test/endpoint-client-merge.unit.test.js`) cover specific edge cases but lack systematic invariant documentation

## Design Goals

1. **Freeze refactor-sensitive behavior** — Turn implicit contracts into explicit executable tests before code movement
2. **Balance PBT vs unit tests** — Use PBT for broad invariants with input variation; use focused unit tests for concrete edge cases
3. **Document invariant boundaries** — Create a written invariant list that future refactors can reference
4. **Enable safe refactoring** — Provide a safety net that catches behavior drift during strategy/lifecycle extraction
5. **Keep tests fast** — Avoid over-broad PBT that slows CI; target <5s total execution time for new invariant tests

## Architecture

### Invariant Classification

Invariants fall into three categories based on testing approach:

**Category A: Broad Invariants (PBT)**
- Input-agnostic properties that hold across wide parameter ranges
- Already partially covered in `test/pbt/run-endpoint.pbt.test.js`
- Example: nav.url function called exactly once, regardless of retry count

**Category B: Edge-Case Invariants (Unit Tests)**
- Concrete scenarios with specific inputs/states
- Require deterministic setup (e.g., abort signal at specific timing)
- Example: route cleanup happens even when navigation fails

**Category C: Cross-Boundary Invariants (Integration Tests)**
- Behavior at seams between components (fixture/live, client/strategy)
- May require both modes to verify parity
- Example: fixture mode produces compatible normalized output shape

### Invariant Registry

**Document**: `test/endpoint-invariants.md` (new file)

Acts as a living reference for:
- What behaviors are frozen as invariants
- Which test file covers each invariant
- Whether invariant is PBT or unit test
- Rationale for why this behavior must stay stable

Format:
```markdown
## INV-001: nav.url One-Time Evaluation
**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` → `pbt: run_endpoint_nav_resolution`
**Contract**: Function-form `nav.url` is evaluated exactly once per `runEndpoint` call, even if 429 retries occur.
**Rationale**: Prevents duplicate side effects (e.g., nonce generation, state mutation in nav.url function).
**Refactor Impact**: Strategy resolver and lifecycle extraction must preserve navUrl caching.
```

## Identified Invariants

### Group 1: Already Covered (Verify Only)

**INV-001: nav.url One-Time Evaluation**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:19`
- **Action**: Verify coverage, document in registry

**INV-002: nav.url Throwing Propagates as E_USAGE**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:58`
- **Action**: Verify coverage, document in registry

**INV-003: 429 Retry Count (≤3 retries, then E_RATE_LIMIT)**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:84`
- **Action**: Verify coverage, document in registry

**INV-004: readBusinessError Naming Compatibility (snake_case vs camelCase)**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:120`
- **Action**: Verify coverage, document in registry

**INV-005: Rate-Limit Cooldown Monotonicity**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:181`
- **Action**: Verify coverage, document in registry

**INV-006: Rate-Limit Cooldown Auto-Expiry**
- **Coverage**: `test/pbt/run-endpoint.pbt.test.js:208`
- **Action**: Verify coverage, document in registry

### Group 2: New PBT Invariants (To Implement)

**INV-007: Abort Signal Respected During Navigation**
- **Category**: A (PBT)
- **Contract**: If `ctx.signal` is aborted before navigation completes, `runEndpoint` rejects without completing the attempt
- **Test Strategy**: PBT with varied abort timing (before nav, during nav, during collector wait)
- **File**: `test/pbt/run-endpoint.pbt.test.js` (append)

**INV-008: Timeout Calculation Respects Remaining Context Time**
- **Category**: A (PBT)
- **Contract**: When `ctx.deadline` is set, nav/collector timeouts are clamped to `remainingMs(ctx)` rather than using full endpoint-spec timeouts
- **Test Strategy**: PBT with varied deadline values vs. endpoint timeout config
- **File**: `test/pbt/run-endpoint.pbt.test.js` (append)

### Group 3: New Unit Test Invariants (To Implement)

**INV-009: Route Cleanup After Navigation Failure (Fetch Mode)**
- **Category**: B (Unit Test)
- **Contract**: If navigation fails in fetch mode after `page.route()` is called, the route handler is still unrouted via `page.unroute()`
- **Test Scenario**: Mock page that throws during `goto()` after route registration
- **File**: `test/endpoint-route-cleanup.unit.test.js` (new)

**INV-010: Route Cleanup After Collector Timeout (Fetch Mode)**
- **Category**: B (Unit Test)
- **Contract**: If collector times out waiting for XHR response, route handler is unrouted
- **Test Scenario**: Mock page with no matching XHR responses
- **File**: `test/endpoint-route-cleanup.unit.test.js` (new)

**INV-011: Collector Disposal on Early Exit**
- **Category**: B (Unit Test)
- **Contract**: If `requiredTrigger` fails, collector is disposed before throwing
- **Test Scenario**: Mock trigger that throws + verify collector cleanup
- **File**: `test/endpoint-lifecycle-cleanup.unit.test.js` (new)

**INV-012: Empty/Unparsable Body Handling**
- **Category**: B (Unit Test)
- **Contract**: If XHR response has no body or unparsable JSON, `runEndpoint` rejects with `E_NETWORK` and hint about anti-fraud blocking
- **Test Scenario**: Mock responses with `null`, `""`, `"<html>..."`, invalid JSON
- **File**: `test/run-endpoint.unit.test.js` (append)

**INV-013: Error-Code Mapping Stability**
- **Category**: B (Unit Test)
- **Contract**: HTTP 401/403 → `E_AUTH_EXPIRED`; HTTP 429 after retries → `E_RATE_LIMIT`; business errors → `E_BUSINESS`; network/parse errors → `E_NETWORK`
- **Test Scenario**: Concrete error responses for each exit code path
- **File**: `test/endpoint-error-mapping.unit.test.js` (new)

### Group 4: Cross-Boundary Invariants (Deferred)

**INV-014: Fixture/Live Normalized Output Parity**
- **Category**: C (Integration Test)
- **Contract**: For endpoints with `normalize()`, fixture mode must produce output compatible with live mode (same top-level fields)
- **Complexity**: Requires fixture data validation infrastructure
- **Decision**: Defer to follow-up work after `endpoint-strategy-resolver` (too complex for safety-net scope)

## Implementation Plan

### Phase 1: Document Existing Coverage (Low Risk)

1. Create `test/endpoint-invariants.md` registry
2. Document INV-001 through INV-006 (already covered)
3. Add cross-references from registry to existing test files
4. Verify existing PBT tests still pass

**Deliverable**: Invariant registry with 6 documented invariants

**Validation**: `npx vitest run test/pbt/run-endpoint.pbt.test.js` passes

---

### Phase 2: Add New PBT Invariants (Medium Risk)

Append to `test/pbt/run-endpoint.pbt.test.js`:

**INV-007 Implementation**:
```javascript
test('pbt: abort_signal_respected_during_navigation', async () => {
  await property(
    'abort_respected',
    gen.record({
      abortBeforeNav: gen.bool(),
      abortDuringCollector: gen.bool(),
    }),
    async ({ abortBeforeNav, abortDuringCollector }) => {
      const controller = new AbortController();
      const page = createEndpointPage({
        respondBy: () => ({ status: 200, body: { success: true } }),
        onNav: () => { if (abortDuringCollector) controller.abort(); },
      });
      
      if (abortBeforeNav) controller.abort();
      
      const meta = {
        name: 'pbt.abort',
        urlPattern: /test/,
        nav: { url: 'http://host/fake' },
        isSuccess: () => true,
      };
      
      try {
        await runEndpoint(page, meta, {}, { signal: controller.signal });
        return !abortBeforeNav && !abortDuringCollector; // success only if no abort
      } catch (err) {
        return (abortBeforeNav || abortDuringCollector) && err?.message?.includes('abort');
      }
    },
    { runs: 20 },
  );
});
```

**INV-008 Implementation**:
```javascript
test('pbt: timeout_calculation_respects_context_deadline', async () => {
  await property(
    'timeout_clamps_to_deadline',
    gen.record({
      endpointTimeout: gen.int(5000, 30000),
      contextDeadlineMs: gen.int(1000, 10000),
    }),
    async ({ endpointTimeout, contextDeadlineMs }) => {
      const startedAt = Date.now();
      const page = createEndpointPage({
        respondBy: () => ({ status: 200, body: { success: true } }),
      });
      
      const meta = {
        name: 'pbt.deadline',
        urlPattern: /test/,
        nav: { url: 'http://host/fake' },
        navTimeout: endpointTimeout,
        collectorTimeout: endpointTimeout,
        isSuccess: () => true,
      };
      
      const ctx = {
        deadline: startedAt + contextDeadlineMs,
      };
      
      await runEndpoint(page, meta, {}, ctx);
      
      // Verify navigation used clamped timeout (would fail if used full endpointTimeout)
      return Date.now() - startedAt < Math.min(endpointTimeout, contextDeadlineMs) + 500;
    },
    { runs: 20 },
  );
});
```

**Deliverable**: 2 new PBT invariants (INV-007, INV-008)

**Validation**: `npx vitest run test/pbt/run-endpoint.pbt.test.js` passes with 9 total PBT tests

---

### Phase 3: Add New Unit Test Invariants (High Risk — Touches Mock Internals)

**File 1: `test/endpoint-route-cleanup.unit.test.js`** (INV-009, INV-010)

```javascript
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';

test('route cleanup after navigation failure (fetch mode)', async () => {
  let routeRegistered = false;
  let routeUnregistered = false;
  
  const page = {
    on: () => {},
    off: () => {},
    url: () => 'http://fake',
    route: async () => { routeRegistered = true; },
    unroute: async () => { routeUnregistered = true; },
    goto: async () => { throw new Error('navigation failed'); },
    waitForSelector: async () => {},
  };
  
  const meta = {
    name: 'test.routeCleanup',
    urlPattern: /test/,
    apiUrl: '/api/test',
    buildPayload: () => ({}),
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };
  
  const client = new PlaywrightEndpointClient();
  
  await assert.rejects(
    () => client.execute(meta, {}, { page }),
    (err) => err.code === 'E_NETWORK',
  );
  
  assert.ok(routeRegistered, 'route should be registered before nav');
  assert.ok(routeUnregistered, 'route should be unregistered in finally block');
});

test('route cleanup after collector timeout (fetch mode)', async () => {
  let routeUnregistered = false;
  
  const page = {
    on: () => {},
    off: () => {},
    url: () => 'http://fake',
    route: async () => {},
    unroute: async () => { routeUnregistered = true; },
    goto: async () => {}, // nav succeeds but no XHR
    waitForSelector: async () => {},
  };
  
  const meta = {
    name: 'test.collectorTimeout',
    urlPattern: /no-match/, // collector will timeout
    apiUrl: '/api/test',
    buildPayload: () => ({}),
    collectorTimeout: 100,
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };
  
  const client = new PlaywrightEndpointClient();
  
  await assert.rejects(
    () => client.execute(meta, {}, { page }),
  );
  
  assert.ok(routeUnregistered, 'route should be unregistered even on timeout');
});
```

**File 2: `test/endpoint-lifecycle-cleanup.unit.test.js`** (INV-011)

```javascript
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';

test('collector disposal on requiredTrigger failure', async () => {
  let collectorDisposed = false;
  
  const page = {
    on: () => {},
    off: (evt, fn) => { if (evt === 'response') collectorDisposed = true; },
    url: () => 'http://fake',
    goto: async () => {},
    waitForSelector: async () => {},
  };
  
  const meta = {
    name: 'test.triggerFail',
    urlPattern: /test/,
    nav: { url: 'http://host/fake' },
    trigger: async () => { throw new Error('trigger failed'); },
    requiredTrigger: true,
    isSuccess: () => true,
  };
  
  const client = new PlaywrightEndpointClient();
  
  await assert.rejects(
    () => client.execute(meta, {}, { page }),
    (err) => err.code === 'E_GENERAL' && err.message.includes('required trigger failed'),
  );
  
  assert.ok(collectorDisposed, 'collector should be disposed before throwing');
});
```

**File 3: `test/endpoint-error-mapping.unit.test.js`** (INV-013)

```javascript
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { PlaywrightEndpointClient } from '../src/adapter/endpoint-client.js';

describe('error-code mapping stability', () => {
  function createMockPage(status, body) {
    return {
      on: (evt, fn) => {
        if (evt === 'response') {
          queueMicrotask(() => {
            const resp = {
              url: () => 'http://fake/endpoint',
              status: () => status,
              text: async () => JSON.stringify(body),
              json: async () => body,
            };
            fn(resp);
          });
        }
      },
      off: () => {},
      url: () => 'http://fake',
      goto: async () => {},
      waitForSelector: async () => {},
    };
  }
  
  test('HTTP 401 → E_AUTH_EXPIRED', async () => {
    const page = createMockPage(401, {});
    const meta = {
      name: 'test.401',
      urlPattern: /endpoint/,
      nav: { url: 'http://fake/endpoint' },
      isSuccess: () => true,
    };
    const client = new PlaywrightEndpointClient();
    
    await assert.rejects(
      () => client.execute(meta, {}, { page }),
      (err) => err.code === 'E_AUTH_EXPIRED' && err.exitCode === 3,
    );
  });
  
  test('HTTP 429 after retries → E_RATE_LIMIT', async () => {
    let attempts = 0;
    const page = {
      on: (evt, fn) => {
        if (evt === 'response') {
          queueMicrotask(() => {
            attempts += 1;
            const resp = {
              url: () => 'http://fake/endpoint',
              status: () => 429,
              text: async () => '{}',
              json: async () => ({}),
            };
            fn(resp);
          });
        }
      },
      off: () => {},
      url: () => 'http://fake',
      goto: async () => {},
      waitForSelector: async () => {},
    };
    
    const meta = {
      name: 'test.429',
      urlPattern: /endpoint/,
      nav: { url: 'http://fake/endpoint' },
      isSuccess: () => true,
    };
    const client = new PlaywrightEndpointClient();
    
    await assert.rejects(
      () => client.execute(meta, {}, { page }),
      (err) => err.code === 'E_RATE_LIMIT' && err.exitCode === 4,
    );
    
    assert.equal(attempts, 4, 'should retry 3 times then fail');
  });
  
  test('Business error → E_BUSINESS', async () => {
    const page = createMockPage(200, { success: false, error_code: 9999, error_msg: '库存不足' });
    const meta = {
      name: 'test.business',
      urlPattern: /endpoint/,
      nav: { url: 'http://fake/endpoint' },
      isSuccess: (raw) => raw?.success === true,
    };
    const client = new PlaywrightEndpointClient();
    
    await assert.rejects(
      () => client.execute(meta, {}, { page }),
      (err) => err.code === 'E_BUSINESS' && err.exitCode === 6 && err.message.includes('库存不足'),
    );
  });
});
```

**Append to `test/run-endpoint.unit.test.js`** (INV-012):

```javascript
test('empty body rejects with E_NETWORK', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: null }),
  });
  const meta = {
    name: 'test.emptyBody',
    urlPattern: /fake/,
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_NETWORK' && err.message.includes('empty or unparsable'),
  );
});

test('unparsable body rejects with E_NETWORK', async () => {
  const page = createFakePage({
    respondBy: () => ({ status: 200, body: '<html>Blocked by anti-fraud</html>' }),
  });
  const meta = {
    name: 'test.unparsable',
    urlPattern: /fake/,
    nav: { url: 'http://host/fake' },
    isSuccess: () => true,
  };
  await assert.rejects(
    () => runEndpoint(page, meta, {}, {}),
    (err) => err.code === 'E_NETWORK',
  );
});
```

**Deliverable**: 3 new test files + 2 appended tests (INV-009 through INV-013)

**Validation**: `npm test` passes with all new tests green

---

### Phase 4: Update Invariant Registry

Add INV-007 through INV-013 to `test/endpoint-invariants.md` with cross-references to test files.

**Deliverable**: Complete invariant registry with 13 documented invariants

---

## Testing Strategy

### Coverage Target

- **Existing PBT**: 6 invariants (already passing)
- **New PBT**: 2 invariants (INV-007, INV-008)
- **New Unit Tests**: 5 invariants (INV-009 through INV-013)
- **Total**: 13 invariants frozen before refactoring begins

### Execution Time Budget

- Existing PBT: ~3s (7 tests × ~400ms avg)
- New PBT: ~1s (2 tests × 20 runs × ~25ms)
- New Unit Tests: ~1s (8 tests × ~125ms avg)
- **Total**: <5s for all new invariant tests

### Test Organization

```
test/
  pbt/
    run-endpoint.pbt.test.js         # 9 PBT tests (6 existing + 2 new)
  endpoint-route-cleanup.unit.test.js # 2 unit tests (new)
  endpoint-lifecycle-cleanup.unit.test.js # 1 unit test (new)
  endpoint-error-mapping.unit.test.js  # 3 unit tests (new)
  run-endpoint.unit.test.js           # append 2 tests (INV-012)
  endpoint-invariants.md              # registry (new)
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Mock page stubs diverge from Playwright API | False confidence in tests | Keep mocks minimal; focus on contract boundaries not implementation details |
| PBT runs become slow (>10s total) | CI friction | Use `{ runs: 20 }` (not 100); monitor execution time; prune slow generators |
| Invariant tests catch false positives during refactor | Wasted investigation time | Document rationale in registry; verify invariants match actual behavior before freezing |
| Unit tests become brittle to internal refactoring | Maintenance burden | Test public behavior (PlaywrightEndpointClient.execute) not private methods |

## Success Criteria

- [ ] `test/endpoint-invariants.md` registry created with 13 documented invariants
- [ ] All 6 existing PBT invariants verified and documented
- [ ] 2 new PBT invariants implemented (INV-007, INV-008)
- [ ] 5 new unit test invariants implemented (INV-009 through INV-013)
- [ ] Full test suite passes (`npm test`)
- [ ] New invariant tests execute in <5s
- [ ] Zero changes to `src/adapter/endpoint-client.js` (invariants freeze existing behavior)

## Follow-Up Integration

After this task completes:

1. **Task `endpoint-strategy-resolver`** can reference invariant registry to ensure strategy resolution preserves INV-001 (nav.url caching) and INV-003 (retry count)
2. **Task `endpoint-attempt-lifecycle-extraction`** can run invariant tests as regression checks after each extraction step
3. **Future endpoint refactors** use registry as a checklist of behaviors that must remain stable

## Open Questions

None blocking implementation. Invariant scope is well-defined and actionable.

## References

- Parent task: `.trellis/tasks/07-06-scamper-project-optimization-grill/prd.md`
- Current implementation: `src/adapter/endpoint-client.js`
- Existing PBT tests: `test/pbt/run-endpoint.pbt.test.js`
- Existing unit tests: `test/run-endpoint.unit.test.js`
