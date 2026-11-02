# Compatible Endpoint Strategy Resolver — Implementation Plan

## Overview

Extract endpoint transport strategy inference logic into an explicit resolver function while maintaining 100% backward compatibility. This task adds infrastructure for future explicit strategy declarations without changing current endpoint behavior.

## Pre-Implementation Checklist

- [x] Read `design.md` to understand resolver architecture and phases
- [x] Read `prd.md` for requirements and constraints
- [x] Review current inference logic at `src/adapter/endpoint-client.js:297-303`
- [x] Review diagnostics validator at `src/adapter/endpoint-validator.js:99-122`
- [ ] Verify baseline: all endpoint tests pass (`npm test`)

## Implementation Steps

### Step 1: Create Resolver Module

**File**: `src/adapter/endpoint-strategy-resolver.js`

**Objective**: Extract current inference logic into a pure function with backward-compatible output.

**Actions**:
1. Create file with ESM exports
2. Implement `resolveEndpointStrategy(spec)` function:
   - Input: endpoint spec object
   - Output: `{ strategy: 'fetch'|'legacy', explicit: false, ambiguous: boolean }`
   - Logic: exactly match `endpoint-client.js:298` inference
3. Add JSDoc documentation:
   - Function purpose
   - Parameter types
   - Return value schema
   - Example usage for fetch/legacy/ambiguous cases
4. Phase 1 constraint: **only implicit inference, no `spec.strategy` support yet**

**Implementation**:
```javascript
/**
 * Resolve endpoint transport strategy from spec.
 * 
 * Phase 1: Implicit inference only (backward compatible).
 * Phase 2+: Add explicit spec.strategy support.
 * 
 * @param {object} spec - Endpoint spec with fields like buildPayload, apiUrl, etc.
 * @returns {{ strategy: 'fetch'|'legacy', explicit: boolean, ambiguous: boolean }}
 * 
 * @example
 * // Fetch mode (has both buildPayload + apiUrl)
 * resolveEndpointStrategy({ buildPayload: () => ({}), apiUrl: '/api/test' })
 * // => { strategy: 'fetch', explicit: false, ambiguous: false }
 * 
 * @example
 * // Legacy mode (has neither)
 * resolveEndpointStrategy({ trigger: async () => {} })
 * // => { strategy: 'legacy', explicit: false, ambiguous: false }
 * 
 * @example
 * // Ambiguous (has one but not both)
 * resolveEndpointStrategy({ buildPayload: () => ({}) })
 * // => { strategy: 'legacy', explicit: false, ambiguous: true }
 */
export function resolveEndpointStrategy(spec) {
  if (!spec || typeof spec !== 'object') {
    return { strategy: 'legacy', explicit: false, ambiguous: true };
  }

  const hasBuildPayload = typeof spec.buildPayload === 'function';
  const hasApiUrl = typeof spec.apiUrl === 'string' && spec.apiUrl.length > 0;

  // Match PlaywrightEndpointClient._attemptOnce logic exactly:
  // const hasFetchPath = typeof meta.buildPayload === 'function' && meta.apiUrl;
  if (hasBuildPayload && hasApiUrl) {
    return { strategy: 'fetch', explicit: false, ambiguous: false };
  }

  if (!hasBuildPayload && !hasApiUrl) {
    return { strategy: 'legacy', explicit: false, ambiguous: false };
  }

  // Ambiguous: has one but not both → fallback to legacy
  return { strategy: 'legacy', explicit: false, ambiguous: true };
}
```

**Validation command**:
```bash
# Visual inspection
cat src/adapter/endpoint-strategy-resolver.js
```

**Expected output**: Clean module with single exported function, JSDoc complete.

**Review gate**: Logic exactly matches `endpoint-client.js:298` (check with unit tests in Step 2).

---

### Step 2: Add Unit Tests for Resolver

**File**: `test/endpoint-strategy-resolver.unit.test.js` (new)

**Objective**: Verify resolver output matches current `_attemptOnce` behavior for all inference paths.

**Actions**:
1. Create test file with vitest imports
2. Implement 5 core tests:
   - Test 1: `buildPayload + apiUrl` → `{ strategy: 'fetch', explicit: false, ambiguous: false }`
   - Test 2: `no buildPayload, no apiUrl` → `{ strategy: 'legacy', explicit: false, ambiguous: false }`
   - Test 3: `buildPayload without apiUrl` → `{ strategy: 'legacy', explicit: false, ambiguous: true }`
   - Test 4: `apiUrl without buildPayload` → `{ strategy: 'legacy', explicit: false, ambiguous: true }`
   - Test 5: `null/undefined spec` → `{ strategy: 'legacy', explicit: false, ambiguous: true }`
3. Add edge case tests:
   - Empty string `apiUrl: ''` → treated as no apiUrl
   - Non-function `buildPayload` → treated as no buildPayload

**Validation command**:
```bash
npx vitest run test/endpoint-strategy-resolver.unit.test.js
```

**Expected output**: `7 passed (7)` in <500ms.

**Review gate**: All inference paths covered; output schema consistent.

---

### Step 3: Add Integration Tests

**File**: `test/endpoint-strategy-integration.test.js` (new)

**Objective**: Validate all existing endpoint specs resolve to expected strategies.

**Actions**:
1. Create test file importing resolver + all endpoint modules
2. Collect all endpoint specs (goods, orders, promo, goods-publish)
3. Define expected strategy map:
   ```javascript
   const expectedStrategies = {
     'goods.list': 'fetch',
     'goods.adStrategy': 'fetch',
     'orders.list': 'fetch',
     'orders.stats': 'fetch',
     'promo.entityReport': 'fetch',
     'promo.hourlyReport': 'fetch',
     'goods.update.status': 'legacy',
     'goods.update.price': 'legacy',
     'goods.update.stock': 'legacy',
     'orders.detail': 'legacy',
     // ... complete list for all 12+ endpoints
   };
   ```
4. Test: iterate all specs, assert `resolveEndpointStrategy(spec).strategy === expected`
5. Add informational test: log any ambiguous endpoints (non-blocking)

**Validation command**:
```bash
npx vitest run test/endpoint-strategy-integration.test.js
```

**Expected output**: `1-2 passed` (depends on test structure), all existing endpoints match expected strategy.

**Review gate**: Zero unexpected strategies; ambiguous endpoints (if any) are logged but don't fail test.

---

### Step 4: Integrate Resolver into PlaywrightEndpointClient

**File**: `src/adapter/endpoint-client.js` (modify)

**Objective**: Replace inline inference with resolver call; preserve exact behavior.

**Actions**:
1. Add import at top:
   ```javascript
   import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
   ```
2. Modify `_attemptOnce()` method (line 297-303):
   
   **Before**:
   ```javascript
   async _attemptOnce(page, meta, params, ctx, log, navUrl) {
     const hasFetchPath = typeof meta.buildPayload === 'function' && meta.apiUrl;
     if (hasFetchPath) {
       return this._attemptFetch(page, meta, params, ctx, log, navUrl);
     }
     return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
   }
   ```
   
   **After**:
   ```javascript
   async _attemptOnce(page, meta, params, ctx, log, navUrl) {
     const { strategy } = resolveEndpointStrategy(meta);
     
     if (strategy === 'fetch') {
       return this._attemptFetch(page, meta, params, ctx, log, navUrl);
     }
     return this._attemptLegacy(page, meta, params, ctx, log, navUrl);
   }
   ```

3. No other changes to `endpoint-client.js`

**Validation command**:
```bash
# Run full endpoint test suite
npx vitest run test/run-endpoint.unit.test.js test/pbt/run-endpoint.pbt.test.js
```

**Expected output**: All existing endpoint tests pass unchanged.

**Review gate**: 
- One-line change in `_attemptOnce()`
- Behavior identical (verified by tests)
- No new dependencies beyond resolver

---

### Step 5: Integrate Resolver into Diagnostics Validator

**File**: `src/adapter/endpoint-validator.js` (modify)

**Objective**: Use resolver for strategy classification; eliminate duplicated inference logic.

**Actions**:
1. Add import at top:
   ```javascript
   import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
   ```
2. Modify `validateTransportStrategy()` function (line 99-122):
   
   **Before** (inline inference):
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
       message: `...`,
       field: missing,
       suggestion: '...',
     });

     return 'ambiguous';
   }
   ```
   
   **After** (using resolver):
   ```javascript
   function validateTransportStrategy(spec, warnings) {
     const { strategy, ambiguous } = resolveEndpointStrategy(spec);

     if (ambiguous) {
       const hasBuildPayload = typeof spec.buildPayload === 'function';
       const present = hasBuildPayload ? 'buildPayload' : 'apiUrl';
       const missing = hasBuildPayload ? 'apiUrl' : 'buildPayload';

       warnings.push({
         code: 'AMBIGUOUS_TRANSPORT',
         severity: 'warning',
         message: `Endpoint has ${present} but not ${missing}`,
         field: missing,
         suggestion: hasBuildPayload
           ? 'Add apiUrl: "/path/to/api" for fetch mode'
           : 'Add buildPayload: (params, ctx) => ({...}) for fetch mode, or remove apiUrl for legacy mode',
       });
     }

     return strategy;
   }
   ```

3. Keep warning message logic (needs `hasBuildPayload` check for message customization)

**Validation command**:
```bash
npx vitest run test/endpoint-validator.unit.test.js test/validate-existing-endpoints.test.js
```

**Expected output**: All validator tests pass; warning messages unchanged.

**Review gate**: No behavior change; warning output identical to before.

---

### Step 6: Full Test Suite Verification

**Objective**: Ensure resolver integration causes zero regressions.

**Actions**:
1. Run full test suite: `npm test`
2. Verify all ~930 tests pass
3. Check execution time (should be <90s, same as before)
4. Run invariant tests explicitly:
   ```bash
   npx vitest run test/pbt/run-endpoint.pbt.test.js
   ```
5. Verify INV-001 (nav.url one-time eval), INV-003 (retry count) still pass

**Validation command**:
```bash
npm test
```

**Expected output**: All ~930 tests pass in <90s.

**Review gate**: 
- Zero regressions
- No new test failures
- Invariant tests confirm behavior preservation

---

### Step 7: Update Documentation

**File**: `src/adapter/endpoint-strategy-resolver.js` (update JSDoc)

**Objective**: Document Phase 1 limitations and future Phase 2 path.

**Actions**:
1. Add module-level JSDoc comment:
   ```javascript
   /**
    * Endpoint Strategy Resolver
    * 
    * Resolves endpoint transport strategy from spec fields.
    * 
    * ## Phase 1 (Current)
    * - Implicit inference only (backward compatible)
    * - Returns strategy based on buildPayload + apiUrl presence
    * - No explicit spec.strategy field support
    * 
    * ## Phase 2 (Future)
    * - Add explicit spec.strategy field support
    * - Enable opt-in explicit strategy declarations
    * - Validate declared strategy matches inferred strategy
    * 
    * ## Usage
    * ```javascript
    * import { resolveEndpointStrategy } from './endpoint-strategy-resolver.js';
    * 
    * const { strategy, ambiguous } = resolveEndpointStrategy(endpointSpec);
    * if (strategy === 'fetch') {
    *   // Use fetch-mode execution
    * } else {
    *   // Use legacy-mode execution
    * }
    * ```
    */
   ```

2. Add inline comment in `_attemptOnce()` integration:
   ```javascript
   // Resolve transport strategy (Phase 1: implicit inference only)
   const { strategy } = resolveEndpointStrategy(meta);
   ```

**Validation**: Visual inspection of JSDoc completeness.

**Review gate**: Documentation explains Phase 1 scope and future path.

---

## Rollback Plan

If resolver integration causes issues:

1. **Revert endpoint-client.js change**:
   ```bash
   git diff src/adapter/endpoint-client.js | git apply -R
   ```
2. **Revert validator change**:
   ```bash
   git diff src/adapter/endpoint-validator.js | git apply -R
   ```
3. **Remove new files**:
   ```bash
   rm src/adapter/endpoint-strategy-resolver.js
   rm test/endpoint-strategy-resolver.unit.test.js
   rm test/endpoint-strategy-integration.test.js
   ```
4. **Verify clean state**: `npm test` passes

**Rollback validation**: All tests pass with original inline inference logic.

---

## Quality Gates

Before marking task as complete:

- [ ] `resolveEndpointStrategy()` function exists with backward-compatible logic
- [ ] 7 unit tests pass for all inference paths
- [ ] Integration tests validate all existing endpoints
- [ ] `PlaywrightEndpointClient._attemptOnce()` uses resolver (one-line change)
- [ ] `endpoint-validator.js` uses resolver (eliminates duplicated logic)
- [ ] Full test suite passes (~930 tests, zero regressions)
- [ ] INV-001, INV-003 from `endpoint-refactor-invariants` still pass
- [ ] JSDoc documentation complete with Phase 1/2 explanation

---

## Known Issues and Workarounds

**Issue 1: Ambiguous endpoints may exist in current codebase**
- **Impact**: Integration test logs them as warnings
- **Workaround**: Informational only; don't fail test (existing behavior allowed ambiguity)
- **Mitigation**: Diagnostics validator already flags ambiguous specs

**Issue 2: Empty string `apiUrl: ''` edge case**
- **Impact**: Resolver treats as "no apiUrl" (falsy check)
- **Workaround**: Matches current behavior (empty string is falsy)
- **Mitigation**: Unit test explicitly covers this case

---

## Follow-Up Tasks

After this task completes:

1. **Phase 2: Explicit Strategy Support**:
   - Add `spec.strategy` field recognition in resolver
   - Update validator to recommend explicit strategy for new endpoints
   - Migrate 1-2 endpoints as proof-of-concept

2. **Task `endpoint-attempt-lifecycle-extraction`**:
   - Use resolver to determine strategy before lifecycle execution
   - Keep strategy resolution outside retry loop (preserves INV-001)

3. **Future: Strategy Registry**:
   - Generalize resolver to support pluggable strategy types
   - Add WebSocket/gRPC strategy examples (requires OpenSpec proposal)

---

## Implementation Notes

- All changes use ESM (`import`/`export`), no CommonJS
- Resolver is a pure function (no I/O, no state, fast synchronous execution)
- Integration uses one-line changes to minimize risk
- Tests verify 1:1 parity with current behavior, not ideal behavior
- Phase 1 constraint: **no explicit `spec.strategy` support** (deferred to follow-up)
- Do NOT modify retry logic, cooldown, or limiter (outside resolver scope)
- Do NOT add new warning codes (use existing `AMBIGUOUS_TRANSPORT`)

---

## Estimated Effort

- Step 1 (Create resolver): 1 hour
- Step 2 (Unit tests): 1.5 hours
- Step 3 (Integration tests): 2 hours
- Step 4 (Integrate into client): 30 minutes
- Step 5 (Integrate into validator): 1 hour
- Step 6 (Full suite verification): 30 minutes
- Step 7 (Update documentation): 30 minutes

**Total**: 7-8 hours for complete implementation and testing.

---

## Success Criteria

Task is complete when:

1. Resolver module exists with backward-compatible logic
2. Unit tests cover all inference paths (7 tests pass)
3. Integration tests validate all existing endpoints
4. Client and validator use resolver (inline inference eliminated)
5. Full test suite passes with zero regressions
6. Invariant tests confirm behavior preservation
7. JSDoc documentation explains Phase 1 scope and future path
8. Code review confirms: pure function, one-line integrations, zero behavior change
