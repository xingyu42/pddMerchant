# Command Runtime Follow-up Audit Design

## Design Direction

This is a test-first audit task. The default implementation strategy is to add missing regression tests around documented contracts and avoid runtime edits unless a test exposes a real mismatch.

The useful seam is already present:

- `src/commands/_runner.js` keeps the public command import surface stable.
- `src/commands/runner/single-lifecycle.js` owns account resolution, deadlines, parent abort signals, fixture/live dispatch, live auth/mall/page session setup, and finalization.
- `src/commands/runner/fixture-runtime.js` owns fixture ctx construction and fixture auth invalid behavior.
- `src/commands/runner/envelope-finalizer.js` owns normalize + success/error envelope finalization and emit gating.

## Contract Focus

1. Live cleanup failure contract

`pageSession.closeAll()` intentionally runs before success finalization on the live path. A close failure should become an error envelope through `finalizeError()`. Tests should mock `createPageSession()` to return a `closeAll()` that rejects, then assert the returned envelope is the single emitted envelope and has standard error shape.

2. Abort/deadline contract

`armDeadline()` combines `parentSignal` and the local timeout signal. Tests should cover the observable result rather than private timer internals: no double emit, returned envelope shape is standard, and command ctx carries the combined signal/deadline when command code observes it.

3. Fixture auth invalid contract

`PDD_TEST_AUTH_INVALID=1` should short-circuit before `spec.run(ctx)` when `needsAuth` is true and return an auth envelope. This keeps fixture mode useful for auth failure e2e and avoids accidental service execution under invalid auth.

4. Finalizer normalization contract

`normalizeRunResult()` is small and directly exported. Unit coverage can lock the exact behavior with no browser mocks: nullish -> `data: null`; primitive/array -> data; plain object -> data; reserved shape -> extracted data/meta/warnings.

## OpenSpec Decision

No OpenSpec proposal is required for the planned work because it is coverage for existing behavior. If the audit reveals the current behavior must change, stop before implementing the behavior change and create/update an OpenSpec change for the affected capability.

## Risk Controls

- Prefer adding to `test/runner-contract.unit.test.js` or a focused new unit test over modifying broad e2e tests.
- Keep mocks local to the test file and reset env vars in `afterEach`.
- Assert returned envelopes, emitted envelope count, and important exit code/error code fields.
- Avoid assertions on private implementation order unless the order is the documented contract, such as `closeAll()` before success finalization.
