# Endpoint Execution Invariants

Living registry of frozen endpoint behaviors. Refactoring tasks (strategy resolver,
lifecycle extraction) must preserve every invariant listed here. Run the referenced
tests after any change to `src/adapter/endpoint-client.js` or `src/adapter/run-endpoint.js`.

## Summary

| ID | Title | Category | Test File | Status |
|----|-------|----------|-----------|--------|
| INV-001 | nav.url One-Time Evaluation | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-002 | nav.url Throwing Propagates as E_USAGE | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-003 | 429 Retry Count (<=3, then E_RATE_LIMIT) | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-004 | readBusinessError Naming Compatibility | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-005 | Rate-Limit Cooldown Monotonicity | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-006 | Rate-Limit Cooldown Auto-Expiry | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-007 | Abort Signal Respected | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-008 | Timeout Deadline Clamping | A (PBT) | `test/pbt/run-endpoint.pbt.test.js` | ✅ |
| INV-009 | Route Cleanup After Navigation Failure | B (Unit) | `test/endpoint-route-cleanup.unit.test.js` | ✅ |
| INV-010 | Route Cleanup After Collector Timeout | B (Unit) | `test/endpoint-route-cleanup.unit.test.js` | ✅ |
| INV-011 | Collector Disposal on Trigger Failure | B (Unit) | `test/endpoint-lifecycle-cleanup.unit.test.js` | ✅ |
| INV-012 | Empty/Unparsable Body Handling | B (Unit) | `test/run-endpoint.unit.test.js` | ✅ |
| INV-013 | Error-Code Mapping Stability | B (Unit) | `test/endpoint-error-mapping.unit.test.js` | ✅ |

---

## INV-001: nav.url One-Time Evaluation

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: run_endpoint_nav_resolution evaluates fn nav.url exactly once`
**Contract**: Function-form `nav.url` is evaluated exactly once per `runEndpoint` call, even if 429 retries occur. The resolved URL is cached for the entire retry loop.
**Rationale**: Prevents duplicate side effects (nonce generation, state mutation) in nav.url functions.
**Refactor Impact**: Strategy resolver and lifecycle extraction must preserve navUrl caching in `_executeWithRetry`.

## INV-002: nav.url Throwing Propagates as E_USAGE

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: run_endpoint throwing nav.url propagates as E_USAGE`
**Contract**: If `nav.url` is a function and it throws, `runEndpoint` rejects with `E_USAGE` containing the original error message.
**Rationale**: URL resolution errors must surface clearly, not be swallowed as network errors.
**Refactor Impact**: resolveNavUrl error handling must remain outside the retry loop.

## INV-003: 429 Retry Count (<=3, then E_RATE_LIMIT)

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: run_endpoint_429_retry count invariant`
**Contract**: HTTP 429 responses trigger up to 3 retries with backoff delays `[1000, 2000, 4000]ms`. If the 4th consecutive response is still 429, `runEndpoint` rejects with `E_RATE_LIMIT`. If any retry succeeds, the successful response is returned.
**Rationale**: Bounded retry prevents infinite loops; fixed delay array ensures predictable backoff.
**Refactor Impact**: Retry logic and RETRY_DELAYS_MS must remain consistent after lifecycle extraction.

## INV-004: readBusinessError Naming Compatibility

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: read_business_error_naming_compat`
**Contract**: `readBusinessError(raw)` resolves code via `raw.error_code ?? raw.errorCode` and message via `raw.error_msg ?? raw.errorMsg`. Returns null for null/non-object input, for code=null, and for success sentinels `{0, 1000000}`. Otherwise returns `{code: String, message: String}`.
**Rationale**: PDD endpoints inconsistently use snake_case vs camelCase; both must be handled.
**Refactor Impact**: `readBusinessError` is a pure function; strategy changes must not alter its behavior.

## INV-005: Rate-Limit Cooldown Monotonicity

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: rate_limit_cooldown_monotonicity_and_gate`
**Contract**: Cooldown activates if and only if `consecutiveFailures >= threshold`. While active, `_cooldownRemainingMs` returns a positive value bounded by `cooldownMs`.
**Rationale**: Cooldown gate prevents hammering rate-limited endpoints; monotonicity ensures deterministic behavior.
**Refactor Impact**: Cooldown state management must remain in the client, not move to strategy.

## INV-006: Rate-Limit Cooldown Auto-Expiry

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: rate_limit_cooldown_expiry_auto_clears_state`
**Contract**: After cooldown duration elapses, `_cooldownRemainingMs` returns 0 and state is auto-cleared. A single subsequent failure does not immediately re-trigger cooldown.
**Rationale**: Endpoints must become usable again after cooldown expires without manual intervention.
**Refactor Impact**: Auto-clear logic in `_cooldownRemainingMs` must survive extraction.

## INV-007: Abort Signal Respected

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: abort_signal_respected_before_navigation`
**Contract**: If `ctx.signal` is already aborted when `runEndpoint` is called, the function rejects with `E_TIMEOUT` without initiating navigation. This holds regardless of endpoint configuration or expected response.
**Rationale**: Pre-aborted signals must short-circuit immediately; no wasted I/O.
**Refactor Impact**: `throwIfAborted` call at the top of the retry loop must survive lifecycle extraction.

## INV-008: Timeout Deadline Clamping

**Category**: A (PBT)
**Test**: `test/pbt/run-endpoint.pbt.test.js` -> `pbt: timeout_clamped_to_context_deadline`
**Contract**: When `ctx.deadlineAt` is set, navigation and collector timeouts are clamped to `remainingMs(ctx)` rather than using the full endpoint-spec timeout. A near-expired deadline causes the endpoint to fail quickly, not wait for the full spec timeout.
**Rationale**: Commands with tight deadlines must not hang on slow endpoints.
**Refactor Impact**: Timeout clamping in `_attemptFetch` and `_attemptLegacy` must be preserved.

## INV-009: Route Cleanup After Navigation Failure (Fetch Mode)

**Category**: B (Unit)
**Test**: `test/endpoint-route-cleanup.unit.test.js` -> `route cleanup after navigation failure (fetch mode)`
**Contract**: If navigation fails in fetch mode after `page.route()` is called, the route handler is still unrouted via `page.unroute()` in the finally block.
**Rationale**: Leaked route handlers cause memory leaks and interfere with subsequent navigations.
**Refactor Impact**: The `finally` block in `_attemptFetch` must survive lifecycle extraction.

## INV-010: Route Cleanup After Collector Timeout (Fetch Mode)

**Category**: B (Unit)
**Test**: `test/endpoint-route-cleanup.unit.test.js` -> `route cleanup after collector timeout (fetch mode)`
**Contract**: If the collector times out waiting for XHR responses in fetch mode, the route handler is still unrouted.
**Rationale**: Same as INV-009; collector timeout is a different failure path that must still clean up.
**Refactor Impact**: Error handling in `_attemptFetch` try/catch/finally must remain consistent.

## INV-011: Collector Disposal on Trigger Failure

**Category**: B (Unit)
**Test**: `test/endpoint-lifecycle-cleanup.unit.test.js` -> `collector disposal on requiredTrigger failure`
**Contract**: If `requiredTrigger` is true and the trigger function throws, the collector is disposed before the error propagates. This prevents collector leaks and `E_COLLECTOR_COLLISION` in subsequent calls.
**Rationale**: Trigger failures must clean up all resources, not just propagate the error.
**Refactor Impact**: `_runTrigger`'s collector?.dispose() call must survive extraction.

## INV-012: Empty/Unparsable Body Handling

**Category**: B (Unit)
**Test**: `test/run-endpoint.unit.test.js` -> `null body rejects with E_NETWORK`
**Contract**: If XHR response body parses to `null` (via `parseBody`), `runEndpoint` rejects with `E_NETWORK` and a hint about anti-fraud blocking.
**Rationale**: Empty responses typically indicate anti-fraud interception; clear error messaging aids debugging.
**Refactor Impact**: The `raw == null` check in `_executeWithRetry` must remain after status/retry handling.

## INV-013: Error-Code Mapping Stability

**Category**: B (Unit)
**Test**: `test/endpoint-error-mapping.unit.test.js`
**Contract**: HTTP status codes map to stable error codes: 401/403 -> `E_AUTH_EXPIRED` (exitCode 3); 429 after retries -> `E_RATE_LIMIT` (exitCode 4); business failure (isSuccess=false) -> `E_BUSINESS` (exitCode 6); network/parse errors -> `E_NETWORK` (exitCode 5).
**Rationale**: Exit codes drive CLI behavior and envelope contracts; drift would break downstream consumers.
**Refactor Impact**: Error mapping in `_executeWithRetry` must produce identical codes and exit codes.

---

## Usage

Before modifying `endpoint-client.js` or `run-endpoint.js`:

1. Run all invariant tests: `npx vitest run test/pbt/run-endpoint.pbt.test.js test/endpoint-route-cleanup.unit.test.js test/endpoint-lifecycle-cleanup.unit.test.js test/endpoint-error-mapping.unit.test.js test/run-endpoint.unit.test.js`
2. If any test fails, the refactor has introduced a behavior change.
3. If the behavior change is intentional, update this registry and the test before proceeding.

## Maintenance

When endpoint behavior intentionally changes:

1. Update the affected invariant entry with the new contract.
2. Update the corresponding test to match the new behavior.
3. Add a note explaining why the change was necessary.
4. Verify all other invariants still pass.
