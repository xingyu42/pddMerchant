# Command runtime batch orchestration planning

## Goal

Continue the command runtime SCAMPER optimization line by planning the next independently verifiable slice around batch orchestration and policy boundaries in `src/commands/runner/batch-executor.js`.

In plain terms: the previous slice froze core `executeSingle()` runner contracts; this task decides how to safely harden or reshape the batch path without changing CLI output or batch semantics accidentally.

## Background

The previous completed task was `07-07-scamper-cross-cutting-optimization-planning`, committed as `8fedd5e` with `test/runner-contract.unit.test.js`.

That first slice added executable contracts for:

- `executeSingle(..., { emitResult: true })` emits exactly once on success/error and returns the emitted envelope.
- `executeSingle(..., { emitResult: false })` returns an envelope without emitting.
- runner warnings merge with command result warnings once and in order.
- `timeoutMs` injects `ctx.signal` and numeric `ctx.deadlineAt`.

Current task scope starts after those invariants are in place.

## Confirmed Facts

- Current git branch is `main`; working tree was clean when this task was created.
- Latest code commit is `8fedd5e ✅ test(commands): freeze runner contract invariants`.
- Current Trellis active task is this planning task.
- `src/commands/runner/batch-executor.js` currently owns multiple batch concerns in one module:
  - `withCommand()` routing for single vs batch;
  - `allowAllAccounts` guard;
  - `--all-accounts` mutual exclusion checks;
  - `--mall` ignored warning;
  - enabled account listing;
  - per-account `executeSingle(..., emitResult:false, skipDaemonStart:true)`;
  - inter-account jitter via `abortableSleep()`;
  - SIGINT listener and batch abort signal;
  - cooldown attribution;
  - batch warning aggregation;
  - final `buildBatchEnvelope()` + `emit()`.
- `openspec/specs/batch-command/spec.md` already defines batch behavior: sequential execution, no-account behavior, warning semantics, partial exit code, SIGINT, daemon auto-start once, and per-account timeout isolation.
- Existing tests cover parts of this surface:
  - `test/pbt/batch-command.pbt.test.js` covers `batchExitCode()` and `buildBatchEnvelope()` properties.
  - `test/batch-cooldown-attribution.unit.test.js` covers cooldown attribution and batch warning propagation for that concern.
  - `test/command-runner.unit.test.js` covers `allowAllAccounts=false` guard and non-batch normal execution.
  - `test/e2e/batch-orders.e2e.test.js` covers at least the `unused_flag_mall_in_batch` CLI/e2e path.
- Coverage appears thinner around the orchestration glue itself: batch routing, mutual exclusion, daemon once, jitter calls, abort short-circuit, emit-once, and per-account option shaping.

## Requirements

- R1: Keep this as a Trellis planning task until the user reviews and approves implementation.
- R2: Use repository evidence before asking scope questions.
- R3: Preserve command runtime public behavior:
  - no CLI output shape changes;
  - no envelope top-level changes;
  - no batch exit-code changes;
  - no new dependencies;
  - no real browser/backend calls in automated tests.
- R4: Prefer a diagnostics/invariants-first slice unless the user explicitly chooses refactor.
- R5: If runtime batch semantics change, create/update OpenSpec before implementation.
- R6: If implementation only adds tests or extracts no-behavior helpers under the same module boundary, OpenSpec proposal is likely not required.

## Candidate Next Slices

### Candidate A: Batch orchestration invariants

Add focused tests around the observable orchestration path without changing runtime code.

Potential assertions:

- `withCommand({ needsAuth:true })` routes `opts.allAccounts=true` into batch and emits exactly once.
- `--all-accounts` + `--account` rejects before account iteration.
- `--all-accounts` + `PDD_AUTH_STATE_PATH` rejects before account iteration.
- `ensureDaemonRunning()` is called once per batch, not per account.
- per-account `executeSingle()` receives `emitResult:false`, `skipDaemonStart:true`, `allAccounts:false`, `mall:undefined`, and account-specific auth path.
- inter-account jitter runs between accounts and not after the last account.
- empty enabled-account list returns an OK batch envelope without daemon start or per-account execution.

Recommended because it extends the previous reliability-first sequence with minimal risk.

### Candidate B: Batch policy extraction

Extract small pure helpers from `batch-executor.js`, such as option validation, account option shaping, or final batch meta construction.

Potential value:

- Improves maintainability by reducing policy density inside one file.
- Makes future tests simpler.

Risk:

- Even small extraction touches runtime module structure and can accidentally change behavior if not fully covered first.

### Candidate C: Spec synchronization only

Update Trellis/OpenSpec drift, especially old references to `src/infra/command-runner.js` in archived/current OpenSpec text where current code uses `src/commands/_runner.js` and `src/commands/runner/**`.

Value:

- Helps future agents navigate correctly.

Risk:

- Lower immediate code safety value than executable batch invariants.

## Recommendation

Choose **Candidate A: Batch orchestration invariants** as the next slice.

Reason: it is the safest continuation after `8fedd5e`: first freeze the batch orchestration behavior that would make later extraction safe, then decide whether a refactor is worth doing.

## Out of Scope

- Changing batch output shape.
- Changing batch exit-code mapping.
- Changing cooldown policy semantics.
- Refactoring `batch-executor.js` before adding orchestration coverage.
- Adding new npm dependencies.
- Requiring real accounts, real browser, or real PDD backend in automated tests.

## Acceptance Criteria

- [x] The user chose Candidate A: batch orchestration invariants.
- [x] `design.md` and `implement.md` were written before `task.py start`.
- [x] Planning records OpenSpec is not required for tests-only invariants.
- [x] The user approved implementation before `task.py start`.

## Decisions

### D1: First slice

Choose **Batch orchestration invariants** as the first slice.

Rationale:

- It continues the diagnostics-first sequence after commit 8fedd5e.
- It freezes behavior that later policy extraction would depend on.
- It does not require an OpenSpec proposal because it should only add tests and does not change runtime behavior.

Trade-off:

- batch-executor.js remains broad for one more slice, but future extraction becomes safer.

## Open Questions

- No blocking scope question remains. The next gate is planning artifact review and approval before task.py start.


