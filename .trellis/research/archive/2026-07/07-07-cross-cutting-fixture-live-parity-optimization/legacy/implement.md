# Implementation Plan: Cross-cutting fixture live parity optimization

## Phase 0: Planning Gate

- [x] Review `prd.md` and `design.md`.
- [x] Resolve Q1: diagnostics-first vs immediate normalization unification.
- [x] Confirm first slice is diagnostics-first and should not change runtime behavior.
- [x] Receive explicit approval to run `task.py start`.

## Phase 1: Evidence And Contract Baseline

- [x] Read relevant files:
  - `src/adapter/run-endpoint.js`
  - `src/adapter/fixtures/endpoint.js`
  - `src/commands/runner/fixture-runtime.js`
  - `src/adapter/endpoint-validator.js`
  - `src/adapter/endpoint-strategy-resolver.js`
  - `openspec/specs/endpoint-transport/spec.md`
  - `.trellis/spec/adapter/fixture-mode.md`
- [x] Confirm all endpoint specs exported from `src/adapter/endpoints/*.js`.
- [x] Confirm fixture files under `test/fixtures/endpoints/`.
- [x] Decide the minimum parity checks for the first slice.

## Phase 2: Recommended First Slice - Diagnostics / Tests Only

- [x] Add or extend a fixture/live parity diagnostic helper.
- [x] Reuse `validateEndpointSpec()` and `resolveEndpointStrategy()` where possible.
- [x] Add unit tests for:
  - endpoint spec to fixture filename alignment;
  - paginated fixture `fixtureListKey` coverage;
  - fixture payload normalization compatibility;
  - direct `runEndpoint()` fixture short-circuit remains limiter/client-free;
  - `FixtureEndpointClient.execute()` data/meta shape remains stable.
- [x] Avoid changing runtime behavior in this slice.

## Phase 3: Validation Commands

Run targeted checks first:

```bash
npx vitest run test/endpoint-validator.unit.test.js test/validate-existing-endpoints.test.js
npx vitest run test/pbt/mock-dispatcher-baseline.pbt.test.js test/pbt/fixture-endpoint.pbt.test.js
npx vitest run test/pbt/run-endpoint-shim.pbt.test.js test/limiter-in-services.unit.test.js
```

Completed:

- [x] `npx vitest run test/fixture-parity-diagnostics.unit.test.js test/validate-existing-endpoints.test.js test/endpoint-strategy-integration.test.js test/endpoint-validator.unit.test.js` — 4 files / 50 tests passed.
- [x] `npx vitest run test/pbt/mock-dispatcher-baseline.pbt.test.js test/pbt/fixture-endpoint.pbt.test.js test/pbt/run-endpoint-shim.pbt.test.js test/limiter-in-services.unit.test.js` — 4 files / 15 tests passed.

If shared contracts are touched, run broader tests:

```bash
npm test
```

Completed:

- [x] `npm test` — 117 files / 947 tests passed.
- [x] `npm run lint` — passes (`echo no-lint`).
- [x] `npx vitest run test/layering-guard.unit.test.js` — 1 file / 3 tests passed.

## Rollback Points

- Before changing runtime code, `git diff` should show diagnostics/tests only.
- If runtime code changes become necessary, split into a follow-up task or OpenSpec-backed slice.
- If tests reveal existing fixture/live drift, record the finding in `prd.md` before fixing.

## Not Yet Approved For Implementation

Implementation has started with explicit approval. Keep any follow-up runtime behavior changes in a separate approved slice.

## Phase 4: Spec Sync / Finish Gate

- [x] Updated `.trellis/spec/adapter/fixture-mode.md` with fixture/live parity diagnostics contract, warning/error matrix, and required tests.
