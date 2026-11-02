# Endpoint Spec Diagnostics — Implementation Plan

## Overview

Implement warning-first endpoint spec diagnostics following the technical design in `design.md`. This is a no-behavior-change implementation that adds validation infrastructure without altering `PlaywrightEndpointClient` runtime behavior.

## Pre-Implementation Checklist

- [x] Read `design.md` to understand validator architecture
- [x] Read `prd.md` for requirements and constraints
- [x] Review existing endpoint specs in `src/adapter/endpoints/`
- [x] Review current strategy inference logic in `src/adapter/endpoint-client.js:298-303`
- [ ] Verify test setup: `vitest` runs successfully with `npm test`

## Implementation Steps

### Step 1: Create Validator Module

**File**: `src/adapter/endpoint-validator.js`

**Objective**: Implement `validateEndpointSpec(spec, options)` function with diagnostic rules R1-R6.

**Actions**:
1. Create file with ESM export structure
2. Define `Warning` schema (code, severity, message, field, suggestion)
3. Implement helper: `inferStrategy(spec)` matching `endpoint-client.js:298` logic
4. Implement rule R1: Missing required fields (name, urlPattern)
5. Implement rule R2: Transport strategy inference + ambiguous warning
6. Implement rule R3: Fetch-mode validation (buildPayload arity, apiUrl format, urlPattern match)
7. Implement rule R4: Legacy-mode validation (requiredTrigger, nav.url presence)
8. Implement rule R5: Response contract validation (isSuccess, errorMapper, normalize)
9. Implement rule R6: Navigation contract validation (nav.url type, readyEl)
10. Return `{ valid, warnings, strategy }` object

**Validation command**: None yet (unit tests in Step 2)

**Review gate**: Self-review all 6 rules match design.md specification; no external dependencies introduced.

---

### Step 2: Write Unit Tests for Validator

**File**: `test/endpoint-validator.unit.test.js`

**Objective**: Achieve >90% code coverage for validator logic with synthetic endpoint specs.

**Actions**:
1. Create test file with `vitest` + `assert/strict` imports
2. Test R1: Missing name → `MISSING_NAME` error
3. Test R1: Missing urlPattern → `MISSING_URL_PATTERN` error
4. Test R2: Valid fetch spec (buildPayload + apiUrl) → strategy='fetch', no errors
5. Test R2: Valid legacy spec (no buildPayload, no apiUrl) → strategy='legacy', no errors
6. Test R2: Ambiguous (buildPayload only) → `AMBIGUOUS_TRANSPORT` warning
7. Test R2: Ambiguous (apiUrl only) → `AMBIGUOUS_TRANSPORT` warning
8. Test R3: Fetch-mode with suspicious buildPayload arity → `SUSPICIOUS_BUILD_PAYLOAD_ARITY` info
9. Test R3: Fetch-mode with invalid apiUrl format → `INVALID_API_URL` warning
10. Test R3: Fetch-mode with urlPattern mismatch → `URL_PATTERN_MISMATCH` warning
11. Test R4: requiredTrigger without trigger → `REQUIRED_TRIGGER_MISSING` error
12. Test R4: requiredTrigger with trigger (valid) → no error
13. Test R4: Legacy-mode without nav.url → `LEGACY_MISSING_NAV_URL` warning
14. Test R5: Missing isSuccess → `MISSING_IS_SUCCESS` warning
15. Test R5: Neither errorMapper nor normalize → `MISSING_RESPONSE_HANDLERS` info
16. Test R5: errorMapper without isSuccess → `ERROR_MAPPER_WITHOUT_IS_SUCCESS` warning
17. Test R6: Invalid nav.url type → `INVALID_NAV_URL_TYPE` error
18. Test R6: Invalid readyEl type → `INVALID_READY_EL` warning
19. Test edge case: Empty spec → multiple errors
20. Test edge case: Fully valid spec → no warnings

**Validation command**:
```bash
npx vitest run test/endpoint-validator.unit.test.js
```

**Expected output**: All tests pass, >90% coverage reported.

**Review gate**: All 6 diagnostic rules have at least 2 test cases each (happy path + error path).

---

### Step 3: Write Integration Test for Existing Endpoints

**File**: `test/validate-existing-endpoints.test.js`

**Objective**: Validate all existing endpoint specs to ensure no critical errors in current codebase and surface warnings for review.

**Actions**:
1. Create test file with `vitest` + `assert/strict` imports
2. Import validator: `import { validateEndpointSpec } from '../src/adapter/endpoint-validator.js'`
3. Import all endpoint modules:
   - `import * as goodsEndpoints from '../src/adapter/endpoints/goods.js'`
   - `import * as ordersEndpoints from '../src/adapter/endpoints/orders.js'`
   - `import * as promoEndpoints from '../src/adapter/endpoints/promo.js'`
   - `import * as goodsPublishEndpoints from '../src/adapter/endpoints/goods-publish.js'`
4. Collect all endpoint specs: `Object.values(module).filter(e => e?.name)`
5. Test 1: "no critical errors in existing endpoints"
   - Run `validateEndpointSpec(spec)` for each
   - Filter warnings with `severity === 'error'`
   - Assert zero error-level warnings
   - If failures, log detailed report with code, message, suggestion
6. Test 2: "log warnings for existing endpoints" (always passes)
   - Filter warnings with `severity === 'warning'`
   - Log to console for developer awareness
   - No assertion failure (informational only)

**Validation command**:
```bash
npx vitest run test/validate-existing-endpoints.test.js
```

**Expected output**: Test 1 passes (no critical errors). Test 2 passes with logged warnings.

**Review gate**: 
- Zero error-level warnings from existing endpoints (or fix revealed endpoint bugs)
- Warning output is actionable and not overwhelming (<5 warnings per endpoint on average)

---

### Step 4: Document Warning Codes

**File**: `src/adapter/endpoint-validator.js` (inline JSDoc)

**Objective**: Add JSDoc block documenting all warning codes for developer reference.

**Actions**:
1. Add file-level JSDoc comment listing all 15+ warning codes
2. For each code: include severity, description, example fix
3. Group by category: Required Fields, Transport Strategy, Fetch Mode, Legacy Mode, Response Contract, Navigation

**Example format**:
```javascript
/**
 * Endpoint Spec Validator
 * 
 * Warning Codes:
 * 
 * ## Required Fields (R1)
 * - MISSING_NAME [error]: Endpoint spec must have a string name
 *   Fix: Add name: "domain.action"
 * 
 * - MISSING_URL_PATTERN [error]: Endpoint spec must have urlPattern for XHR collector
 *   Fix: Add urlPattern: /your-api-path/
 * 
 * ## Transport Strategy (R2)
 * - AMBIGUOUS_TRANSPORT [warning]: Endpoint has buildPayload or apiUrl but not both
 *   Fix: Add both for fetch mode, or remove both for legacy mode
 * 
 * ... [continue for all codes]
 */
```

**Validation command**: None (documentation only)

**Review gate**: All warning codes from `design.md` rules R1-R6 are documented.

---

### Step 5: Update Test Script (Optional)

**File**: `package.json`

**Objective**: Add convenience script for endpoint validation.

**Actions**:
1. Add script entry:
   ```json
   "scripts": {
     "test:endpoints": "vitest run test/validate-existing-endpoints.test.js",
     "test": "vitest",
     "test:unit": "vitest run"
   }
   ```

**Validation command**:
```bash
npm run test:endpoints
```

**Expected output**: Integration test runs and reports pass/warnings.

**Review gate**: Command works in clean shell; no dependency issues.

---

### Step 6: Smoke Test Full Suite

**Objective**: Ensure new validator does not break existing tests or introduce regressions.

**Actions**:
1. Run full test suite: `npm test`
2. Verify no new test failures unrelated to validator
3. Check test execution time did not increase significantly (<5% overhead)

**Validation command**:
```bash
npm test
```

**Expected output**: All ~770 existing tests pass, plus new validator tests.

**Review gate**: 
- Zero regressions in existing tests
- New validator tests contribute <10 additional tests to total count
- Test suite remains fast (<30s for full run, or proportional to baseline)

---

## Rollback Plan

If validator implementation causes issues:

1. **Remove validator module**: Delete `src/adapter/endpoint-validator.js`
2. **Remove validator tests**: Delete `test/endpoint-validator.unit.test.js` and `test/validate-existing-endpoints.test.js`
3. **Revert package.json**: Remove `test:endpoints` script if added
4. **Verify clean state**: Run `npm test` to confirm no breakage

**Rollback validation**: `npm test` passes with original test count.

---

## Quality Gates

Before marking task as complete:

- [ ] All 6 diagnostic rules (R1-R6) implemented and tested
- [ ] Unit tests achieve >90% validator code coverage
- [ ] Integration test validates all existing endpoints with zero error-level warnings
- [ ] Warning codes documented in validator source
- [ ] Full test suite passes without regressions
- [ ] No new external dependencies introduced
- [ ] No changes to `PlaywrightEndpointClient` runtime behavior (verified by existing PBT tests)

---

## Known Issues and Workarounds

None anticipated. Validator is pure function with no side effects.

---

## Follow-Up Tasks

After this task completes:

1. **Task `07-07-endpoint-refactor-invariants`**: Use validator warnings to inform PBT invariant selection
2. **Task `07-07-endpoint-strategy-resolver`**: Add explicit strategy field support to validator
3. **CI Integration**: Add `npm run test:endpoints` to CI pipeline (project-level decision)
4. **Fixture Parity Checks**: Extend validator to check fixture response shapes (complex, needs separate design)

---

## Implementation Notes

- Keep validator logic synchronous (no async/await needed)
- Use defensive checks for all spec field accesses (undefined-safe)
- Warning messages should be actionable, not just descriptive
- Severity levels: `error` = objectively broken, `warning` = risky but functional, `info` = improvement suggestion
- Follow project code style: const preferred, <50 lines per function, nesting ≤3 levels

---

## Estimated Effort

- Step 1 (Validator): 2-3 hours
- Step 2 (Unit tests): 2-3 hours  
- Step 3 (Integration test): 1 hour
- Step 4 (Documentation): 30 minutes
- Step 5 (Script): 10 minutes
- Step 6 (Smoke test): 30 minutes

**Total**: 6-8 hours for complete implementation and testing.

---

## Success Criteria

Task is complete when:

1. `validateEndpointSpec()` function exists and handles all 6 rule categories
2. Unit tests cover all rule paths with synthetic specs
3. Integration test validates existing endpoints with zero critical errors
4. Warning codes are documented
5. Full test suite passes
6. Code review confirms: no behavior changes, no new dependencies, follows project conventions
