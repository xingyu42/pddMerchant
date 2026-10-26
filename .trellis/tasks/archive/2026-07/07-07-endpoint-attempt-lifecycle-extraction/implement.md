# Endpoint Attempt Lifecycle Extraction — Implementation Plan

## Overview

Extract duplicated lifecycle code from `_attemptFetch()` and `_attemptLegacy()` into a shared `executeAttempt()` function while preserving all 13 invariants from `endpoint-refactor-invariants`. This task reduces ~100 lines of duplication to ~20 lines of transport-specific hooks.

## Pre-Implementation Checklist

- [x] Read `design.md` to understand lifecycle abstraction and hook interface
- [x] Read `prd.md` for requirements and constraints
- [x] Review current implementations at `src/adapter/endpoint-client.js:305-430`
- [x] Review invariant registry at `test/endpoint-invariants.md`
- [ ] Verify baseline: all 13 invariants pass (`npx vitest run test/pbt/run-endpoint.pbt.test.js test/endpoint-route-cleanup.unit.test.js test/endpoint-lifecycle-cleanup.unit.test.js`)

## Implementation Steps

### Step 1: Create Attempt Lifecycle Module

**File**: `src/adapter/endpoint-attempt.js` (new)

**Objective**: Extract shared lifecycle into a reusable function with transport hooks.

**Actions**:
1. Create file with ESM imports:
   ```javascript
   import { createCollector } from './xhr-collector.js';
   import { PddCliError, ExitCodes } from '../infra/errors.js';
   import { TIMEOUTS } from '../infra/timeouts.js';
   import { throwIfAborted, remainingMs } from '../infra/abort.js';
   ```

2. Implement `executeAttempt()` function with JSDoc:
   ```javascript
   /**
    * Execute a single endpoint attempt with shared lifecycle.
    * 
    * Lifecycle phases:
    * 1. Check abort signal
    * 2. Calculate timeouts from ctx.deadline
    * 3. Prepare transport (fetch: route setup; legacy: no-op)
    * 4. Create XHR collector
    * 5. Navigate (with pageSession if available)
    * 6. Wait for readyEl (optional)
    * 7. Execute trigger
    * 8. Wait for collector responses
    * 9. Cleanup transport in finally block
    * 
    * @param {object} config
    * @param {object} config.page - Playwright page
    * @param {object} config.meta - Endpoint spec
    * @param {object} config.params - Request params
    * @param {object} config.ctx - Execution context (signal, deadlineAt, pageSession)
    * @param {object} config.log - Logger instance
    * @param {string} config.navUrl - Resolved navigation URL
    * @param {function} config.prepareTransport - Setup hook (async (page, meta, params, ctx) => void)
    * @param {function} config.cleanupTransport - Cleanup hook (async (page, meta) => void)
    * @param {function} config.runTrigger - Trigger execution (async (page, meta, params, ctx, log, collector) => void)
    * @returns {Promise<Response>} First XHR response matching urlPattern
    * @throws {PddCliError} E_NETWORK on navigation failure, E_TIMEOUT on abort
    */
   export async function executeAttempt({
     page,
     meta,
     params,
     ctx,
     log,
     navUrl,
     prepareTransport,
     cleanupTransport,
     runTrigger,
   }) {
     // ... implementation (see design.md for full code)
   }
   ```

3. Copy lifecycle logic from `_attemptFetch()`:
   - Abort check (`throwIfAborted`)
   - Timeout calculation (`remainingMs`, clamping)
   - Collector creation
   - Navigation (with pageSession check)
   - readyEl wait (with try/catch)
   - Trigger execution
   - Collector wait
   - Error wrapping (`E_NETWORK`)
   - Cleanup in finally block

**Validation command**:
```bash
# Visual inspection
cat src/adapter/endpoint-attempt.js
```

**Expected output**: Clean module with single exported function, ~80 lines.

**Review gate**: 
- All lifecycle steps present
- Hook calls in correct order (prepare before collector, cleanup in finally)
- Error handling matches original

---

### Step 2: Refactor _attemptFetch to Use executeAttempt

**File**: `src/adapter/endpoint-client.js` (modify)

**Objective**: Replace `_attemptFetch()` body with `executeAttempt()` call and transport hooks.

**Actions**:
1. Add import at top:
   ```javascript
   import { executeAttempt } from './endpoint-attempt.js';
   ```

2. Replace `_attemptFetch()` implementation (line 305-372):
   
   **Before** (67 lines):
   ```javascript
   async _attemptFetch(page, meta, params, ctx, log, navUrl) {
     throwIfAborted(ctx.signal);
     const remaining = remainingMs(ctx);
     // ... 60+ lines of lifecycle + route setup/cleanup ...
   }
   ```
   
   **After** (15 lines):
   ```javascript
   async _attemptFetch(page, meta, params, ctx, log, navUrl) {
     const payload = meta.buildPayload(params, ctx);
     let routeHandler;

     return executeAttempt({
       page,
       meta,
       params,
       ctx,
       log,
       navUrl,
       prepareTransport: async (page) => {
         routeHandler = async (route) => {
           const origPostData = route.request().postData();
           const merged = mergePayload(origPostData, payload);
           await route.continue({ postData: JSON.stringify(merged) });
         };
         await page.route(meta.urlPattern, routeHandler);
       },
       cleanupTransport: async (page) => {
         if (routeHandler) {
           await page.unroute(meta.urlPattern, routeHandler).catch(() => {});
         }
       },
       runTrigger: this._runTrigger.bind(this),
     });
   }
   ```

3. Keep `_runTrigger()` method unchanged (stays in client)

**Validation command**:
```bash
# Run fetch-mode tests
npx vitest run test/endpoint-route-cleanup.unit.test.js
```

**Expected output**: Both route cleanup tests pass (INV-009, INV-010).

**Review gate**: 
- Route setup/cleanup logic preserved
- `mergePayload` still called
- `_runTrigger` bound correctly

---

### Step 3: Refactor _attemptLegacy to Use executeAttempt

**File**: `src/adapter/endpoint-client.js` (modify)

**Objective**: Replace `_attemptLegacy()` body with `executeAttempt()` call and no-op hooks.

**Actions**:
1. Replace `_attemptLegacy()` implementation (line 374-430):
   
   **Before** (56 lines):
   ```javascript
   async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
     throwIfAborted(ctx.signal);
     const remaining = remainingMs(ctx);
     // ... 50+ lines of lifecycle ...
   }
   ```
   
   **After** (8 lines):
   ```javascript
   async _attemptLegacy(page, meta, params, ctx, log, navUrl) {
     return executeAttempt({
       page,
       meta,
       params,
       ctx,
       log,
       navUrl,
       prepareTransport: async () => {}, // no-op
       cleanupTransport: async () => {},  // no-op
       runTrigger: this._runTrigger.bind(this),
     });
   }
   ```

**Validation command**:
```bash
# Run legacy-mode tests
npx vitest run test/run-endpoint.unit.test.js
```

**Expected output**: All existing legacy-mode tests pass.

**Review gate**: 
- No transport setup/cleanup (legacy doesn't use routes)
- `_runTrigger` bound correctly
- Behavior identical to before

---

### Step 4: Run Invariant Tests

**Objective**: Verify all 13 invariants from `endpoint-refactor-invariants` still pass.

**Actions**:
1. Run PBT invariants (INV-001 through INV-008):
   ```bash
   npx vitest run test/pbt/run-endpoint.pbt.test.js
   ```
2. Run route cleanup invariants (INV-009, INV-010):
   ```bash
   npx vitest run test/endpoint-route-cleanup.unit.test.js
   ```
3. Run lifecycle cleanup invariant (INV-011):
   ```bash
   npx vitest run test/endpoint-lifecycle-cleanup.unit.test.js
   ```
4. Run error mapping invariants (INV-012, INV-013):
   ```bash
   npx vitest run test/run-endpoint.unit.test.js test/endpoint-error-mapping.unit.test.js
   ```

**Validation command**:
```bash
# Run all invariant tests
npx vitest run test/pbt/run-endpoint.pbt.test.js test/endpoint-route-cleanup.unit.test.js test/endpoint-lifecycle-cleanup.unit.test.js test/endpoint-error-mapping.unit.test.js test/run-endpoint.unit.test.js
```

**Expected output**: All 13 invariants pass (9 PBT + 8 unit tests).

**Review gate**: 
- Zero invariant failures
- If any fail, revert extraction and debug before proceeding

---

### Step 5: Add Unit Tests for executeAttempt

**File**: `test/endpoint-attempt.unit.test.js` (new)

**Objective**: Test `executeAttempt()` edge cases independently of strategies.

**Actions**:
1. Create test file with minimal mock page helper:
   ```javascript
   function createMockPage({ navSucceeds = true, hasReadyEl = true, responses = [] } = {}) {
     const listeners = [];
     return {
       on: (evt, fn) => { if (evt === 'response') listeners.push(fn); },
       off: (evt, fn) => { /* ... */ },
       goto: async (url) => {
         if (!navSucceeds) throw new Error('nav failed');
         queueMicrotask(() => {
           for (const resp of responses) {
             for (const l of listeners) l(resp);
           }
         });
       },
       waitForSelector: async (selector) => {
         if (!hasReadyEl) throw new Error('selector not found');
       },
       url: () => 'http://fake',
     };
   }
   ```

2. Implement 3 tests:
   - Test 1: Successful attempt returns first response
   - Test 2: Navigation failure disposes collector and calls cleanup
   - Test 3: readyEl failure is non-fatal (attempt continues)

**Validation command**:
```bash
npx vitest run test/endpoint-attempt.unit.test.js
```

**Expected output**: `3 passed (3)` in <500ms.

**Review gate**: Edge cases covered; mocks minimal.

---

### Step 6: Full Test Suite Verification

**Objective**: Ensure lifecycle extraction causes zero regressions across entire codebase.

**Actions**:
1. Run full test suite: `npm test`
2. Verify all ~930 tests pass
3. Check execution time (should be <90s, same as before)
4. Specifically verify:
   - All endpoint tests pass (goods, orders, promo)
   - All PBT tests pass
   - All new invariant tests pass

**Validation command**:
```bash
npm test
```

**Expected output**: All ~930 tests pass in <90s.

**Review gate**: 
- Zero regressions
- No new test failures
- Execution time unchanged

---

### Step 7: Code Review and Documentation

**File**: `src/adapter/endpoint-attempt.js` (update JSDoc)

**Objective**: Document lifecycle abstraction and hook contract.

**Actions**:
1. Add module-level JSDoc comment:
   ```javascript
   /**
    * Endpoint Attempt Lifecycle
    * 
    * Shared lifecycle for single endpoint attempts. Strategies (fetch, legacy)
    * provide minimal transport hooks (prepare/cleanup) while the core lifecycle
    * handles navigation, collector, trigger, and error wrapping.
    * 
    * ## Lifecycle Phases
    * 1. Abort check (throwIfAborted)
    * 2. Timeout calculation (remainingMs, clamping)
    * 3. Transport preparation (route setup for fetch, no-op for legacy)
    * 4. Collector creation
    * 5. Navigation (with pageSession support)
    * 6. Optional readyEl wait
    * 7. Trigger execution
    * 8. Collector wait
    * 9. Transport cleanup (finally block)
    * 
    * ## Hook Contract
    * - prepareTransport: Called before navigation; sets up transport (e.g., route)
    * - cleanupTransport: Called in finally block; tears down transport
    * - runTrigger: Executes endpoint trigger (bound from client)
    * 
    * ## Invariant Preservation
    * - INV-001: navUrl evaluated once (outside lifecycle, passed in)
    * - INV-007: throwIfAborted at top of lifecycle
    * - INV-008: Timeout clamping to ctx.deadlineAt
    * - INV-009/010: cleanupTransport in finally block
    * - INV-011: collector.dispose() in catch block
    */
   ```

2. Add inline comments for invariant-sensitive sections:
   ```javascript
   // INV-007: Check abort signal before starting attempt
   throwIfAborted(ctx.signal);
   
   // INV-008: Clamp timeouts to context deadline
   const remaining = remainingMs(ctx);
   
   // INV-009/010: Cleanup transport in finally block
   } finally {
     await cleanupTransport(page, meta).catch(() => {});
   }
   ```

**Validation**: Visual inspection of JSDoc completeness.

**Review gate**: Documentation explains lifecycle phases, hook contract, and invariant preservation.

---

## Rollback Plan

If lifecycle extraction causes issues:

1. **Revert endpoint-client.js changes**:
   ```bash
   git diff src/adapter/endpoint-client.js | git apply -R
   ```
2. **Remove new files**:
   ```bash
   rm src/adapter/endpoint-attempt.js
   rm test/endpoint-attempt.unit.test.js
   ```
3. **Verify clean state**: `npm test` passes with original duplication

**Rollback validation**: All 13 invariants pass; full suite passes.

---

## Quality Gates

Before marking task as complete:

- [ ] `executeAttempt()` function exists in `src/adapter/endpoint-attempt.js`
- [ ] `_attemptFetch()` reduced to ~15 lines using `executeAttempt()`
- [ ] `_attemptLegacy()` reduced to ~8 lines using `executeAttempt()`
- [ ] All 13 invariants from `endpoint-refactor-invariants` pass
- [ ] New unit tests for `executeAttempt()` cover edge cases
- [ ] Full test suite passes (~930 tests, zero regressions)
- [ ] JSDoc documentation explains lifecycle phases and hook contract
- [ ] Code review confirms: duplication eliminated, hooks minimal, invariants preserved

---

## Known Issues and Workarounds

**Issue 1: _runTrigger stays in client (coupling)**
- **Impact**: `executeAttempt()` depends on client-provided function
- **Workaround**: Pass as bound method (`this._runTrigger.bind(this)`)
- **Mitigation**: Accept trade-off for Phase 1; extract trigger logic in Phase 2 if needed

**Issue 2: Transport hooks receive full page/meta/params/ctx**
- **Impact**: Hooks have access to more than they need
- **Workaround**: Hooks only use page/meta; ignore extra params
- **Mitigation**: Keep hook implementations minimal (no creep beyond transport setup/cleanup)

**Issue 3: Mock page stubs may not match real Playwright API**
- **Impact**: Unit tests pass but may miss real behavior
- **Workaround**: Keep mocks minimal; rely on existing integration tests for real behavior
- **Mitigation**: Invariant tests use real `PlaywrightEndpointClient` with minimal mocks

---

## Follow-Up Tasks

After this task completes:

1. **Phase 2: Extract Trigger Logic (Optional)**:
   - If `_runTrigger` coupling becomes problematic
   - Extract to `src/adapter/endpoint-trigger.js`
   - Make standalone function `executeTrigger(page, meta, params, ctx, log, collector)`

2. **Future: Strategy Pattern**:
   - If more strategies added (WebSocket, gRPC)
   - Formalize hooks as strategy interface
   - Move fetch/legacy to separate strategy files
   - Make client a pure orchestrator

3. **Performance Optimization**:
   - Profile `executeAttempt()` for hot paths
   - Consider inlining critical sections if overhead detected

---

## Implementation Notes

- All changes use ESM (`import`/`export`), no CommonJS
- `executeAttempt()` is async (matches original lifecycle)
- Hooks are async functions (even no-ops, for consistency)
- Keep `_runTrigger()` in client for Phase 1 (minimize change surface)
- Do NOT modify retry logic, cooldown, or limiter (outside lifecycle scope)
- Do NOT change error-code mapping or response normalization
- Transport hooks called with full context (page, meta, params, ctx) but only page/meta needed
- Cleanup hook never throws (wrapped in `.catch(() => {})`)

---

## Estimated Effort

- Step 1 (Create lifecycle module): 2 hours
- Step 2 (Refactor _attemptFetch): 1 hour
- Step 3 (Refactor _attemptLegacy): 30 minutes
- Step 4 (Run invariant tests): 30 minutes
- Step 5 (Add unit tests): 1.5 hours
- Step 6 (Full suite verification): 30 minutes
- Step 7 (Code review + docs): 1 hour

**Total**: 7-8 hours for complete implementation and testing.

---

## Success Criteria

Task is complete when:

1. Lifecycle module exists with shared attempt logic
2. `_attemptFetch()` and `_attemptLegacy()` drastically reduced in size
3. All 13 invariants pass (verified by invariant test suite)
4. New unit tests cover `executeAttempt()` edge cases
5. Full test suite passes with zero regressions
6. JSDoc documentation explains lifecycle phases and invariant preservation
7. Code review confirms: duplication eliminated (~100 lines → ~20 lines transport hooks), hooks minimal, zero behavior change

---

## Duplication Reduction Summary

**Before**:
- `_attemptFetch()`: 67 lines (305-372)
- `_attemptLegacy()`: 56 lines (374-430)
- **Total**: 123 lines with ~100 lines duplicated

**After**:
- `executeAttempt()`: 80 lines (new shared module)
- `_attemptFetch()`: 15 lines (route hooks + executeAttempt call)
- `_attemptLegacy()`: 8 lines (no-op hooks + executeAttempt call)
- **Total**: 103 lines with ~20 lines transport-specific

**Duplication eliminated**: ~100 lines → ~20 lines (80% reduction in strategy-specific code)
