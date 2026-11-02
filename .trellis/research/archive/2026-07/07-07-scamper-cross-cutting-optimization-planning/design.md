# Design: Command runtime SCAMPER diagnostics and invariants

## Context

The previous SCAMPER optimization chain hardened endpoint execution first, then fixture/live parity. The next chosen cross-cutting surface is command runtime: the seam that turns Commander options into command context, service execution, envelope finalization, and batch aggregation.

This slice intentionally follows the same safety order as the endpoint work: diagnose and freeze contracts before refactoring.

## Current Runtime Map

```text
bin/pdd.js
  -> registry/<domain>.js
  -> command handler run = withCommand({...})
  -> src/commands/_runner.js facade
     -> withCommand() in runner/batch-executor.js
        -> single path: executeSingle() in runner/single-lifecycle.js
           -> fixture path: executeFixture() in runner/fixture-runtime.js
           -> live path: withBrowser/auth/mall/pageSession/buildCommandCtx/run/finalize
        -> batch path: executeBatch()
           -> list accounts
           -> executeSingle(... emitResult:false ...) per account
           -> apply cooldown attribution
           -> buildBatchEnvelope + emit once
  -> infra/output.js and infra/errors.js own envelope/error shapes
```

## Boundaries

### Runner owns

- Account/auth path resolution.
- Timeout/deadline signal construction.
- Fixture vs live runtime branch.
- Mall resolution/switching for standard commands.
- Command `ctx` construction.
- Success/error finalization through envelope helpers.
- Batch account loop, partial handling, cooldown attribution, and final batch envelope emission.

### Runner must not own

- Domain aggregation logic.
- Endpoint transport internals.
- Raw platform response parsing.
- New envelope top-level fields.
- Browser simulation inside fixture mode.

## Chosen First Slice

First slice: **diagnostics + invariants only**.

It should add or extend tests/diagnostic helpers without changing `withCommand()`, `executeSingle()`, `executeFixture()`, `executeBatch()`, or finalizer runtime semantics.

## Contract Matrix

| Contract | Current evidence | Gap to harden |
| --- | --- | --- |
| Exactly-once finalization | `PROP-WC-1` checks returned envelope on success/throw | Actual emit count / stdout path is less directly frozen |
| Fixture/live ctx shape | `PROP-CTX-1` freezes key sets | Keep as baseline; avoid expanding unless needed |
| Raw stripping | `PROP-RAW-1` covers buildEnvelope, executeSingle, batch | Not the main gap |
| Batch summary/exit code | `batch-command.pbt.test.js` covers batchExitCode/buildBatchEnvelope | Batch orchestration path around executeSingle, warnings, emit remains narrower |
| Cooldown attribution | unit + PBT coverage exists | Good baseline; keep out of first slice unless touched |
| Timeout/deadline | infra abort PBT and endpoint deadline PBT exist | Runner-level deadline propagation and no double finalize can be more explicit |
| Spec alignment | Trellis spec matches current facade; OpenSpec has stale `src/infra/command-runner.js` path | Record/update spec if implementation confirms drift |

## Compatibility

- No CLI output shape changes.
- No runtime behavior changes in the first slice.
- No new npm dependencies.
- Existing facade imports stay stable: `src/commands/_runner.js` continues exporting `executeSingle` and `withCommand`.
- Fixture mode remains browser-free and auth-state-free.

## OpenSpec Need

No OpenSpec proposal is required for the first diagnostics/invariant slice if it only adds tests or diagnostics and does not alter runtime behavior.

If a later slice changes `withCommand()` behavior, batch semantics, exit-code semantics, or public envelope fields, create or update an OpenSpec change first.

## Risks And Mitigations

- Risk: Tests mirror implementation internals too closely.
  - Mitigation: Assert observable envelope/emit/context contracts, not private call order unless call order is the contract.
- Risk: Diagnostics become broad and noisy.
  - Mitigation: Limit first slice to 2-3 high-value gaps.
- Risk: OpenSpec drift is mixed with runtime work.
  - Mitigation: Treat spec sync as finish/spec-update work unless runtime behavior changes.
- Risk: Batch tests accidentally sleep 2-5 seconds per account.
  - Mitigation: Mock `abortableSleep()` as existing tests do.

## Rollback

The first slice should be easy to roll back by removing only new tests/diagnostic helpers. Runtime files should remain unchanged unless a tiny test seam is explicitly justified later.
