# Command runtime single fixture envelope follow-up audit

## Goal

Freeze the remaining high-risk command runtime edge contracts after the endpoint execution and batch policy work. The task should make `executeSingle()` safer to refactor by adding focused regression coverage around single-command abort/timeout behavior, fixture/live parity edges, and envelope finalization semantics.

User value: future cross-cutting pdd-cli runtime optimizations can proceed without silently changing JSON envelope behavior, fixture-mode behavior, or live browser cleanup/error behavior.

## Background

- Recent completed work extracted endpoint attempt lifecycle, added fixture parity diagnostics, froze runner/batch invariants, extracted batch policy helpers, synchronized command runtime specs, and fixed OpenSpec strict validation.
- Current Trellis context has no active task and git was clean when this task was created on 2026-07-07.
- `src/commands/_runner.js` remains a facade that exports `executeSingle` and `withCommand`; command imports should stay unchanged.
- `src/commands/runner/single-lifecycle.js:48` arms command deadlines and combines `parentSignal`.
- `src/commands/runner/single-lifecycle.js:94` keeps live execution as a promise-returning wrapper with deliberately preserved timing.
- `src/commands/runner/single-lifecycle.js:121` documents that live `pageSession.closeAll()` failures must become error envelopes rather than being hidden in `finally`.
- `src/commands/runner/fixture-runtime.js:10` is the shared command ctx construction point for fixture and live paths.
- `src/commands/runner/fixture-runtime.js:45` handles fixture auth invalid and fixture execution without launching Playwright.
- `src/commands/runner/envelope-finalizer.js:8` normalizes reserved result shapes.
- `src/commands/runner/envelope-finalizer.js:32` and `src/commands/runner/envelope-finalizer.js:50` are the success/error finalization exits.
- Existing runner contract tests cover emit exactly once, emit disabled, warning merge, and deadline injection at `test/runner-contract.unit.test.js:44`, `test/runner-contract.unit.test.js:56`, `test/runner-contract.unit.test.js:71`, `test/runner-contract.unit.test.js:82`, and `test/runner-contract.unit.test.js:97`.
- Existing ctx parity PBT freezes fixture/live field sets at `test/pbt/ctx-contract.pbt.test.js:86` and `test/pbt/ctx-contract.pbt.test.js:107`.
- Trellis runner spec still requires finalizer tests, abort/timeout no-double-emission tests, and fixture runtime tests at `.trellis/spec/commands/runner-lifecycle.md:53`.

## Requirements

- R1: Add targeted regression coverage for live single-command lifecycle edges not already covered by the runner contract tests.
- R2: Add targeted regression coverage for fixture runtime edge behavior not already covered by ctx field-set PBT.
- R3: Add targeted regression coverage for envelope finalizer normalization and error mapping, without changing the public envelope shape.
- R4: If a new test exposes a real mismatch with the documented contract, fix only the smallest owning module under `src/commands/runner/**` or `src/infra/**`.
- R5: Preserve the existing import surface of `src/commands/_runner.js`; do not move command-domain logic into runner internals.
- R6: Do not create an OpenSpec proposal unless implementation changes observable CLI behavior, exit-code semantics, envelope shape, auth/security behavior, or a cross-module architecture pattern.

## Acceptance Criteria

- [x] A live-path test proves `pageSession.closeAll()` failure is finalized as one error envelope, not swallowed and not double-emitted. Covered by `test/runner-contract.unit.test.js`.
- [x] An abort/timeout-focused test proves an already-aborted `parentSignal` or expired command deadline does not cause duplicate finalization and maps through the standard error envelope path. Covered by `test/runner-contract.unit.test.js`.
- [x] A fixture-path test proves `PDD_TEST_AUTH_INVALID=1` returns an auth error envelope without invoking the command `run(ctx)`. Covered by `test/runner-contract.unit.test.js`.
- [x] A finalizer-focused test proves reserved result shapes are normalized as documented: plain objects become data, `{ data, meta, warnings }` merges through meta/warnings, nullish returns become `data: null`, and arrays/primitives remain data. Covered by `test/envelope-finalizer.unit.test.js`.
- [x] Targeted Vitest files pass for runner/finalizer/ctx coverage: `npx vitest run test/envelope-finalizer.unit.test.js test/runner-contract.unit.test.js test/pbt/ctx-contract.pbt.test.js` passed 3 files / 13 tests.
- [x] No runtime code changed. Broader runner/envelope tests still passed: 6 files / 27 tests. Full `npm test` was not required for this coverage-only change.
- [x] `npm run lint` was run and returned `no-lint`, the repository-known no-op.

## Out Of Scope

- Broad runtime re-architecture.
- Changes to top-level envelope fields.
- Changes to command option parsing or command registry wiring.
- New OpenSpec capability unless tests force an observable behavior decision.
- Forced adding of ignored OpenSpec or Trellis files to git.

## Open Questions

None blocking. Repository evidence is enough to proceed with the recommended test-first scope.

