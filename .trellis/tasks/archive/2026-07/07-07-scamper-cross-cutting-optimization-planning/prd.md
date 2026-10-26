# SCAMPER cross-cutting optimization planning

## Goal

Use the SCAMPER method to choose and plan the next cross-cutting optimization slice for `pdd-cli`, after the endpoint execution contract chain and fixture/live parity diagnostics have been completed.

This planning task produces a reviewed optimization plan and, if needed, a parent/child Trellis task map. It does not start implementation by itself.

## Background

Previous SCAMPER line completed the endpoint execution contract sequence:

1. endpoint spec diagnostics;
2. endpoint refactor invariants;
3. compatible endpoint strategy resolver;
4. endpoint attempt lifecycle extraction.

The follow-up fixture/live parity slice is also completed and committed as `1c2cae2`, adding warning-first fixture/live parity diagnostics while preserving existing runtime behavior.

Verified repository facts at planning time:

- Branch is `main`; working tree was clean when this planning task was created.
- Trellis had no active task before this task.
- OpenSpec active changes currently show completed entries, not a new active proposal for this SCAMPER pass.
- Existing OpenSpec specs include `cli-runtime`, `cli-envelope`, `endpoint-transport`, `batch-command`, `mall-context-resolution`, auth/account specs, orders, promo, logging, and daemon lifecycle.
- The architecture contract remains `commands -> services -> adapter -> infra`.
- Cross-cutting changes touching architecture, runtime behavior, security, or performance may require an OpenSpec proposal before implementation.
- No root `CONTEXT.md` / `CONTEXT-MAP.md` or `docs/adr/*.md` currently exists, so glossary/ADR files should be created lazily only when a stable term or hard-to-reverse decision is resolved.

## Decisions

### D1: Next SCAMPER Target

Choose **Command runtime / batch / single lifecycle contract** as the next deep SCAMPER target.

Rationale:

- It is the next natural cross-cutting layer after endpoint execution and fixture/live parity work.
- It connects `withCommand()`, single-command execution, batch execution, timeout/abort propagation, fixture/live ctx construction, warnings, and envelope finalization.
- It touches multiple layers through a central contract while still allowing small diagnostics-first slices.

Rejected for now:

- Envelope/error as the main target: important, but already has strong PBT coverage around raw stripping and envelope shape; better treated as a boundary inside command runtime.
- Mall/auth context as the main target: valuable, but more subsystem-specific.
- Rate-limit/cooldown as the main target: valuable, but currently narrower and partly covered by endpoint/batch cooldown attribution tests.
- Goods publish runtime safety as the main target: high-risk but domain-specific, not the broad cross-cutting slice requested here.

### D2: First Implementation Slice

Choose **diagnostics + invariants** as the first implementation slice, not behavior change and not direct refactor.

Recommended shape:

- Add or extend runner contract diagnostics/tests around the command runtime seam.
- Focus on observable contracts: exactly-once finalization/emit behavior, fixture/live ctx shape, timeout/deadline preservation, batch per-account envelope shape, batch warning propagation, and spec drift detection where safe.
- Keep `withCommand()`, `executeSingle()`, `executeBatch()` runtime behavior unchanged in the first slice.

Rationale:

- The runner already contains subtle timing and finalization comments; refactoring before strengthening tests risks changing behavior accidentally.
- Existing PBT coverage is useful but uneven: ctx shape and raw stripping are strong; actual emit count and batch execution orchestration have narrower coverage.
- A diagnostics/invariant slice preserves reliability first, matching the previous successful endpoint sequence.

## Current Runtime Evidence

Confirmed code structure:

- `src/commands/_runner.js` is a stable facade exporting `executeSingle` and `withCommand`.
- `src/commands/runner/single-lifecycle.js` owns account resolution, deadline/abort setup, fixture/live branching, auth validation, daemon auto-start, mall resolution/switching, page session creation, ctx construction, and finalizer dispatch.
- `src/commands/runner/fixture-runtime.js` owns fixture ctx construction, fixture auth failure simulation, and mock mall resolution.
- `src/commands/runner/batch-executor.js` owns `--all-accounts`, per-account `executeSingle`, sequential execution, jitter, SIGINT abort, cooldown attribution, batch warnings, and batch envelope finalization.
- `src/commands/runner/envelope-finalizer.js` owns `normalizeRunResult()`, success/error envelope construction, and emit gating.

Confirmed test/spec coverage:

- `test/pbt/ctx-contract.pbt.test.js` freezes fixture/live ctx key sets.
- `test/pbt/with-command.pbt.test.js` freezes basic exactly-once envelope behavior for success/throw in fixture mode.
- `test/pbt/raw-strip.pbt.test.js` covers `buildEnvelope`, `executeSingle`, and `buildBatchEnvelope` raw stripping paths.
- `test/pbt/batch-command.pbt.test.js` covers `batchExitCode()` and `buildBatchEnvelope()` invariants.
- `test/batch-cooldown-attribution.unit.test.js` covers endpoint-scoped cooldown attribution propagation into batch warnings.
- `openspec/specs/batch-command/spec.md` defines batch execution, partial results, exit-code mapping, SIGINT, daemon auto-start, and per-account timeout isolation.
- `.trellis/spec/commands/runner-lifecycle.md` defines the current runner module split and required validation focus.

Potential drift/risk signals:

- OpenSpec `cli-runtime` still mentions `src/infra/command-runner.js`, while current code exposes runner through `src/commands/_runner.js` facade. This may be spec drift rather than runtime bug.
- `withCommand` exactly-once PBT currently checks returned envelope shape but not actual stdout emit count, so an emit-related regression could be under-specified.
- Batch executor contains several policies in one module: eligibility, account iteration, jitter, SIGINT, cooldown attribution, and envelope finalization. This is acceptable today, but it is the likely next source of contract drift.
- Single lifecycle intentionally keeps live `executeLive()` promise timing comments around deadline timer cleanup; this is subtle and should be frozen before behavior changes.

## Requirements

- R1: Run planning as a `grill-with-docs` style interview: one high-value question at a time, with a recommended answer and trade-off.
- R2: Use SCAMPER lenses as the main exploration frame.
- R3: Preserve the earlier priority order unless the user changes it: reliability > architecture convergence > maintainability > CLI UX > runtime performance.
- R4: Answer repository-answerable questions through code, tests, specs, or Trellis history before asking the user.
- R5: The first implementation slice must be diagnostics/invariants only unless the plan is explicitly revised.
- R6: Do not change CLI output shape, envelope top-level shape, or fixture/live runtime semantics in the first slice.
- R7: Do not introduce new npm dependencies.
- R8: Do not start implementation until planning artifacts are reviewed and the task is explicitly started.
- R9: Do not commit changes without explicit user authorization.

## SCAMPER Map: Command Runtime

### Substitute

- Candidate S1: Substitute informal runner assumptions with executable contract diagnostics.
  - Evidence: exactly-once finalization is documented in comments and lightly covered by `PROP-WC-1`, but actual emit-count boundaries are not fully asserted.
  - Expected value: catches runner regressions before refactors.
  - Risk: diagnostics can become tautological if they only restate implementation details.
  - Suggested first action: test observable behavior at facade/finalizer boundaries, not private implementation steps.

### Combine

- Candidate C1: Combine single and batch runtime contract expectations into a shared test vocabulary.
  - Evidence: `executeSingle()` returns envelopes used directly by batch; `buildBatchEnvelope()` then re-wraps per-account results.
  - Expected value: reduces drift between single-command and batch-account envelope semantics.
  - Risk: over-abstracted helpers could hide important single/batch differences.
  - Suggested first action: create small test helpers only if duplication appears in tests; do not create runtime abstraction first.

### Adapt

- Candidate A1: Adapt the endpoint optimization sequence to runner work.
  - Evidence: endpoint work succeeded by sequencing diagnostics -> invariants -> compatible resolver -> lifecycle extraction.
  - Expected value: the same risk-first order fits runner work.
  - Risk: copying the sequence too literally could over-plan a smaller problem.
  - Suggested first action: start with diagnostics/invariants only; decide later whether refactor is justified.

### Modify / Magnify / Minify

- Candidate M1: Magnify `withCommand()` observable contracts before reducing module size.
  - Evidence: `batch-executor.js` is 202 lines and owns several policies; `single-lifecycle.js` is 157 lines with subtle deadline timing behavior.
  - Expected value: makes future decomposition safer.
  - Risk: adding tests without refactor may feel like no user-visible progress.
  - Suggested first action: define the contract matrix and validate it with targeted tests.

### Put to another use

- Candidate P1: Use runner contract checks to detect documentation/spec drift.
  - Evidence: OpenSpec `cli-runtime` still references `src/infra/command-runner.js`, while current code uses `src/commands/_runner.js`.
  - Expected value: keeps OpenSpec/Trellis docs aligned with code before future agents follow stale paths.
  - Risk: spec drift checks should not fail runtime tests unless the rule is stable.
  - Suggested first action: record drift in planning; consider spec update in finish phase if implementation confirms it.

### Eliminate

- Candidate E1: Eliminate hidden runner behavior assumptions before changing code.
  - Evidence: live `executeLive()` intentionally returns a promise without awaiting inside `executeSingle()` to preserve deadline timer cleanup timing.
  - Expected value: prevents accidental changes to timeout/abort behavior.
  - Risk: overfitting to current timing could block useful future simplification.
  - Suggested first action: freeze user-visible deadline behavior rather than private promise timing.

### Reverse / Rearrange

- Candidate R1: Rearrange future work so batch policy extraction happens after contract hardening.
  - Evidence: batch includes eligibility, account iteration, jitter, SIGINT, cooldown attribution, warning aggregation, and final batch envelope.
  - Expected value: keeps refactor safe and small.
  - Risk: delaying refactor means batch-executor remains broad for one more slice.
  - Suggested first action: diagnostics/invariants first; only then decide whether to split batch policies.

## Out of Scope

- Direct implementation in this planning phase.
- Broad rewrites or file splitting without an executable contract first.
- Introducing new npm dependencies.
- Changing the top-level envelope shape.
- Replacing fixture mode with browser simulation.
- Bypassing platform risk controls or expanding scraping beyond the user's own shop operations.
- Directly refactoring `batch-executor.js` in the first slice.

## Acceptance Criteria

- [x] The SCAMPER map names the chosen next cross-cutting surface and rejected alternatives.
- [x] Each major candidate includes evidence, expected value, risk, and suggested next action.
- [x] The first implementation slice is small enough to verify independently.
- [x] OpenSpec proposal need is recorded: not needed for diagnostics-only; required later for runtime behavior/architecture/public contract changes.
- [x] `design.md` and `implement.md` exist for this complex task before `task.py start`.
- [x] The user reviewed the final planning artifacts and approved starting implementation.

## Open Questions

- No blocking scope question remains for the diagnostics/invariants first slice. The next gate is user review/approval before `task.py start`.
