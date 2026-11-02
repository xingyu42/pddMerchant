# Endpoint Refactor Invariants — Implementation Plan

## Overview

Freeze endpoint execution behavior before strategy/lifecycle refactors by documenting existing invariants and adding targeted safety-net tests. This task produces executable contracts that catch behavior drift during follow-up refactoring work.

## Pre-Implementation Checklist

- [x] Read `design.md` to understand invariant classification and registry structure
- [x] Read `prd.md` for requirements and constraints
- [x] Review existing PBT tests in `test/pbt/run-endpoint.pbt.test.js`
- [x] Review existing unit tests in `test/run-endpoint.unit.test.js`
- [ ] Verify baseline: `npx vitest run test/pbt/run-endpoint.pbt.test.js` passes

## Implementation Steps

### Step 1: Create Invariant Registry

**File**: `test/endpoint-invariants.md`

**Objective**: Document all 13 endpoint execution invariants as a living reference for refactoring work.

**Actions**:
1. Create file with header explaining purpose and structure
2. Add template for invariant entries:
   ```markdown
   ## INV-XXX: Short Title
   **Category**: A (PBT) | B (Unit) | C (Integration)
   **Test**: `test/path/to/file.test.js` → `test name`
   **Contract**: One-sentence description of frozen behavior
   **Rationale**: Why this behavior must stay stable
   **Refactor Impact**: Which follow-up tasks must preserve this
   ```
3. Document INV-001 through INV-006 (existing PBT coverage):
   - INV-001: nav.url one-time evaluation
   - INV-002: nav.url throwing propagates as E_USAGE
   - INV-003: 429 retry count (≤3 retries)
   - INV-004: readBusinessError naming compatibility
   - INV-005: Rate-limit cooldown monotonicity
   - INV-006: Rate-limit cooldown auto-expiry
4. Add placeholders for INV-007 through INV-013 (to be implemented in later steps)

**Validation command**:
```bash
# Visual inspection only
cat test/endpoint-invariants.md
```

**Expected output**: Well-structured registry with 6 documented invariants + 7 placeholders.

**Review gate**: All existing PBT tests referenced correctly; format is consistent.

---

### Step 2: Verify Existing PBT Coverage

**Objective**: Confirm existing PBT tests still pass and cover documented invariants.

**Actions**:
1. Run PBT test suite:
   ```bash
   npx vitest run test/pbt/run-endpoint.pbt.test.js
   ```
2. Verify 7 existing PBT tests pass (INV-001 through INV-006 coverage)
3. Check execution time (<5s)
4. If any test fails, investigate root cause before proceeding

**Validation command**:
```bash
npx vitest run test/pbt/run-endpoint.pbt.test.js
```

**Expected output**: `7 passed (7)` in <5s.

**Review gate**: Zero test failures; execution time acceptable.

---

### Step 3: Implement New PBT Invariants (INV-007, INV-008)

**File**: `test/pbt/run-endpoint.pbt.test.js` (append)

**Objective**: Add 2 new PBT invariants for abort signal handling and timeout calculation.

**Actions**:
1. Append INV-007: Abort signal respected during navigation
   - Test structure: PBT with `abortBeforeNav` and `abortDuringCollector` flags
   - Generator: `gen.record({ abortBeforeNav: gen.bool(), abortDuringCollector: gen.bool() })`
   - Property: abort before/during → rejection with abort error; no abort → success
   - Run count: 20
2. Append INV-008: Timeout calculation respects context deadline
   - Test structure: PBT with `endpointTimeout` and `contextDeadlineMs` inputs
   - Generator: `gen.record({ endpointTimeout: gen.int(5000, 30000), contextDeadlineMs: gen.int(1000, 10000) })`
   - Property: actual execution time < min(endpointTimeout, contextDeadlineMs) + margin
   - Run count: 20
3. Update registry placeholders with test references

**Validation command**:
```bash
npx vitest run test/pbt/run-endpoint.pbt.test.js
```

**Expected output**: `9 passed (9)` in <6s (2 new tests × 20 runs × ~25ms).

**Review gate**: 
- Both new tests pass
- Total PBT execution time <6s
- No false positives (tests fail when behavior genuinely changes)

---

### Step 4: Implement Route Cleanup Invariants (INV-009, INV-010)

**File**: `test/endpoint-route-cleanup.unit.test.js` (new)

**Objective**: Verify fetch-mode route cleanup happens even on navigation/collector failures.

**Actions**:
1. Create file with vitest imports
2. Implement INV-009: Route cleanup after navigation failure
   - Mock page with `route()` / `unroute()` / `goto()` (throws)
   - Execute fetch-mode endpoint
   - Assert: `routeUnregistered === true` even though navigation failed
3. Implement INV-010: Route cleanup after collector timeout
   - Mock page with non-matching `urlPattern` → collector times out
   - Execute fetch-mode endpoint with short `collectorTimeout`
   - Assert: `routeUnregistered === true` even though collector timed out
4. Update registry with test references

**Validation command**:
```bash
npx vitest run test/endpoint-route-cleanup.unit.test.js
```

**Expected output**: `2 passed (2)` in <500ms.

**Review gate**: Both tests pass; mock page stubs are minimal (don't recreate full Playwright API).

---

### Step 5: Implement Lifecycle Cleanup Invariants (INV-011)

**File**: `test/endpoint-lifecycle-cleanup.unit.test.js` (new)

**Objective**: Verify collector disposal on `requiredTrigger` failure.

**Actions**:
1. Create file with vitest imports
2. Implement INV-011: Collector disposal on requiredTrigger failure
   - Mock page with `on()` / `off()` (off = disposal signal)
   - Execute legacy-mode endpoint with `requiredTrigger: true` and throwing trigger
   - Assert: `collectorDisposed === true` before error propagates
3. Update registry with test reference

**Validation command**:
```bash
npx vitest run test/endpoint-lifecycle-cleanup.unit.test.js
```

**Expected output**: `1 passed (1)` in <200ms.

**Review gate**: Test passes; collector disposal happens before `E_GENERAL` is thrown.

---

### Step 6: Implement Error Mapping Invariants (INV-012, INV-013)

**File 1**: `test/endpoint-error-mapping.unit.test.js` (new)
**File 2**: `test/run-endpoint.unit.test.js` (append)

**Objective**: Freeze error-code mapping for auth, rate-limit, business, and network errors.

**Actions**:
1. Create `test/endpoint-error-mapping.unit.test.js` for INV-013:
   - Test: HTTP 401 → `E_AUTH_EXPIRED` (exitCode 3)
   - Test: HTTP 403 → `E_AUTH_EXPIRED` (exitCode 3)
   - Test: HTTP 429 after 3 retries → `E_RATE_LIMIT` (exitCode 4)
   - Test: Business error (success=false, error_code≠0) → `E_BUSINESS` (exitCode 6)
   - Helper: `createMockPage(status, body)` for each scenario
2. Append to `test/run-endpoint.unit.test.js` for INV-012:
   - Test: Empty body (`null` / `""`) → `E_NETWORK` with hint about anti-fraud
   - Test: Unparsable body (`<html>...`) → `E_NETWORK`
3. Update registry with test references

**Validation command**:
```bash
npx vitest run test/endpoint-error-mapping.unit.test.js
npx vitest run test/run-endpoint.unit.test.js
```

**Expected output**: 
- `endpoint-error-mapping.unit.test.js`: `4 passed (4)` in <1s
- `run-endpoint.unit.test.js`: existing tests + 2 new pass

**Review gate**: All error-code paths tested; exit codes match current behavior.

---

### Step 7: Finalize Invariant Registry

**File**: `test/endpoint-invariants.md` (update)

**Objective**: Complete registry with all 13 invariants fully documented.

**Actions**:
1. Replace placeholders for INV-007 through INV-013 with full documentation
2. Add summary table at top:
   ```markdown
   ## Summary
   | ID | Title | Category | Status |
   |----|-------|----------|--------|
   | INV-001 | nav.url One-Time Evaluation | A (PBT) | ✅ |
   | ... | ... | ... | ... |
   | INV-013 | Error-Code Mapping Stability | B (Unit) | ✅ |
   ```
3. Add "Usage" section explaining how refactoring tasks should use this registry
4. Add "Maintenance" section explaining how to update when behavior intentionally changes

**Validation command**:
```bash
# Visual inspection only
cat test/endpoint-invariants.md
```

**Expected output**: Complete registry with 13 invariants, all marked `✅`.

**Review gate**: Registry is authoritative reference; all test cross-references valid.

---

### Step 8: Full Test Suite Verification

**Objective**: Ensure new invariant tests integrate cleanly with existing test suite.

**Actions**:
1. Run full test suite: `npm test`
2. Verify no regressions in existing tests
3. Verify new invariant tests execute in <5s total
4. Check test output for any warnings or failures

**Validation command**:
```bash
npm test
```

**Expected output**: All ~920+ tests pass (existing + ~13 new invariant tests).

**Review gate**: 
- Zero regressions
- New tests contribute <5s overhead
- No changes to `src/adapter/endpoint-client.js` (invariants freeze existing behavior)

---

## Rollback Plan

If invariant tests cause issues:

1. **Remove new test files**:
   - Delete `test/endpoint-route-cleanup.unit.test.js`
   - Delete `test/endpoint-lifecycle-cleanup.unit.test.js`
   - Delete `test/endpoint-error-mapping.unit.test.js`
2. **Revert appended tests**:
   - Remove INV-007, INV-008 from `test/pbt/run-endpoint.pbt.test.js`
   - Remove INV-012 tests from `test/run-endpoint.unit.test.js`
3. **Remove registry**: Delete `test/endpoint-invariants.md`
4. **Verify clean state**: Run `npm test` to confirm no breakage

**Rollback validation**: `npm test` passes with original test count.

---

## Quality Gates

Before marking task as complete:

- [ ] Invariant registry (`test/endpoint-invariants.md`) created with 13 documented invariants
- [ ] All 6 existing PBT invariants verified and documented (INV-001 through INV-006)
- [ ] 2 new PBT invariants implemented and passing (INV-007, INV-008)
- [ ] 5 new unit test invariants implemented and passing (INV-009 through INV-013)
- [ ] Full test suite passes (`npm test`)
- [ ] New invariant tests execute in <5s total
- [ ] Zero changes to `src/adapter/endpoint-client.js` (verified by git diff)
- [ ] Registry includes usage guidance for follow-up refactoring tasks

---

## Known Issues and Workarounds

**Issue 1: Mock page stubs may not match Playwright API evolution**
- **Impact**: Tests pass but may miss real Playwright behavior changes
- **Workaround**: Keep mocks minimal; focus on contract boundaries (route registered → unregistered) not implementation details
- **Mitigation**: Follow-up tasks run E2E tests with real Playwright to catch gaps

**Issue 2: PBT runs may be non-deterministic on slow machines**
- **Impact**: Tests occasionally timeout or report false failures
- **Workaround**: Use `withInstantTimers()` helper from `test/pbt/_fake-pages.js` to bypass real delays
- **Mitigation**: CI runs on consistent hardware; local flakes are rare

---

## Follow-Up Tasks

After this task completes:

1. **Task `07-07-endpoint-strategy-resolver`**:
   - Use invariant registry as checklist before implementation
   - Run invariant tests after strategy resolver changes
   - Update registry if new invariants discovered

2. **Task `07-07-endpoint-attempt-lifecycle-extraction`**:
   - Run invariant tests after each extraction step
   - Treat any failing invariant as a blocker (revert or fix before continuing)
   - Update registry if lifecycle extraction reveals new contracts

3. **Future endpoint refactors**:
   - Check registry before modifying `endpoint-client.js`
   - Run `npx vitest run test/pbt/run-endpoint.pbt.test.js` after changes
   - Add new invariants when discovering frozen behavior not yet documented

---

## Implementation Notes

- All new tests use `vitest` + `assert/strict` (project convention)
- Mock pages should be minimal: only stub methods actually called by endpoint client
- PBT generators should avoid pathological inputs (e.g., negative timeouts, null pages)
- Test names should match invariant IDs for easy cross-referencing
- Invariant registry is Markdown (not code) so it can be read without running tests
- Do NOT modify `src/adapter/endpoint-client.js` in this task — only freeze its current behavior

---

## Estimated Effort

- Step 1 (Registry creation): 1 hour
- Step 2 (Verify existing PBT): 30 minutes
- Step 3 (New PBT): 2 hours
- Step 4 (Route cleanup tests): 1.5 hours
- Step 5 (Lifecycle cleanup test): 1 hour
- Step 6 (Error mapping tests): 2 hours
- Step 7 (Finalize registry): 30 minutes
- Step 8 (Full suite verification): 30 minutes

**Total**: 9-10 hours for complete implementation and testing.

---

## Success Criteria

Task is complete when:

1. Invariant registry exists with 13 documented invariants
2. 2 new PBT tests pass (INV-007, INV-008)
3. 5 new unit tests pass (INV-009 through INV-013)
4. Full test suite passes with zero regressions
5. New tests execute in <5s
6. `src/adapter/endpoint-client.js` unchanged (git diff shows no modifications)
7. Registry includes usage guidance for follow-up tasks
8. Code review confirms: tests are focused, mocks are minimal, invariants match actual behavior
