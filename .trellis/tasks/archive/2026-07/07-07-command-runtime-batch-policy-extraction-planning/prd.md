# Command runtime batch policy extraction planning

## Goal

Plan the next command runtime optimization slice: a no-behavior-change extraction of batch policy helpers from `src/commands/runner/batch-executor.js`.

In plain terms: the last two slices froze `executeSingle()` and batch orchestration behavior. This task decides the smallest safe refactor that makes batch code easier to maintain without changing CLI output, envelope shape, exit codes, account iteration, jitter, daemon behavior, or warning semantics.

## Background

Completed prerequisite commits:

- `8fedd5e ✅ test(commands): freeze runner contract invariants`
- `94dfd54 ✅ test(commands): freeze batch orchestration invariants`

Repository state at task creation:

- Branch: `main`.
- Working tree: clean.
- No active Trellis task before this task.
- Recent batch orchestration tests are in `test/batch-orchestration.unit.test.js`.

## Confirmed Facts

- `src/commands/runner/batch-executor.js` currently owns batch constants, cooldown attribution, enabled-account listing, per-account option shaping, per-account execution, sequential account loop, jitter, SIGINT handling, empty-batch finalization, non-empty-batch finalization, and `withCommand()` single/batch routing.
- Key current function anchors:
  - `applyCooldownAttribution()` at `src/commands/runner/batch-executor.js:27`
  - `listEnabledAccounts()` at `src/commands/runner/batch-executor.js:46`
  - `runOneAccount()` at `src/commands/runner/batch-executor.js:59`
  - `runAccountLoop()` at `src/commands/runner/batch-executor.js:91`
  - `finalizeBatch()` at `src/commands/runner/batch-executor.js:121`
  - `executeBatch()` at `src/commands/runner/batch-executor.js:147`
  - `withCommand()` at `src/commands/runner/batch-executor.js:208`
- Existing executable safety net:
  - mutual exclusion before side effects: `test/batch-orchestration.unit.test.js:83`
  - empty disabled-account batch behavior: `test/batch-orchestration.unit.test.js:114`
  - sequential execution, per-account option shaping, jitter, daemon-once, emit-once: `test/batch-orchestration.unit.test.js:136`
  - `needsAuth:false` remains single-command path: `test/batch-orchestration.unit.test.js:172`
- Existing specs already define the public batch behavior:
  - mutual exclusions: `openspec/specs/batch-command/spec.md:22`
  - sequential account execution: `openspec/specs/batch-command/spec.md:65`
  - aggregated envelope output: `openspec/specs/batch-command/spec.md:108`
  - daemon auto-start once: `openspec/specs/batch-command/spec.md:205`
- Trellis runner spec now records batch orchestration invariants at `.trellis/spec/commands/runner-lifecycle.md:93`.
- OpenSpec proposal need:
  - Not required if implementation only extracts helpers inside the same runner module boundary and preserves behavior.
  - Required if implementation changes batch command behavior, envelope/exit-code semantics, public command flags, or introduces a new cross-module architecture pattern.

## Requirements

- R1: Keep this task in planning until artifacts are reviewed and the user approves `task.py start`.
- R2: The first implementation slice MUST be no-behavior-change refactor only.
- R3: Preserve all existing batch public contracts:
  - no CLI output shape change;
  - no envelope top-level change;
  - no batch exit-code mapping change;
  - no account iteration order change;
  - no jitter range/count/signal change;
  - no daemon start behavior change;
  - no warning semantics change;
  - no real browser/backend calls in automated tests.
- R4: Prefer lowest-risk extraction:
  - keep `withCommand()` and `executeBatch()` export surface stable;
  - avoid moving helpers outside `src/commands/runner/` in the first slice;
  - avoid new npm dependencies;
  - avoid broad file splitting unless the design is revised first.
- R5: If implementation reveals a required behavior change, stop and revise planning; create/update OpenSpec if the change is public or architectural.

## Recommended Slice

Choose **small same-module batch policy extraction**.

Recommended extraction targets:

1. `validateBatchOptions(opts)`:
   - owns `--all-accounts` mutual exclusions with `--account`, `--auth-state-path`, and `PDD_AUTH_STATE_PATH`.
   - returns initial batch warnings such as `unused_flag_mall_in_batch`.
2. `buildPerAccountOptions(opts, slug, batch)`:
   - owns account-specific `authStatePath`, `allAccounts:false`, `mall:undefined`, and per-account correlation id.
3. `batchJitterMs(random = Math.random)` or equivalent pure helper:
   - owns `[2000, 4999]` jitter calculation without changing `abortableSleep()` behavior.
4. Optional only if it stays tiny: `emitEmptyBatch()` or `buildBatchMeta()` for duplicated finalization metadata.

Do not extract cooldown attribution in this first refactor; it is already exported and has dedicated tests.

## Out of Scope

- Changing batch command behavior.
- Changing `withCommand()` public import surface through `src/commands/_runner.js`.
- Moving batch policy helpers into `src/infra/` or `src/services/`.
- Reworking SIGINT semantics.
- Changing `applyCooldownAttribution()` semantics.
- Adding new OpenSpec proposal for the no-behavior slice.
- Adding dependencies.

## Acceptance Criteria

- [x] `design.md` and `implement.md` exist before `task.py start`.
- [x] Planning records why OpenSpec is not required for the recommended no-behavior extraction.
- [x] The selected slice names exact helper boundaries and non-goals.
- [x] Implementation keeps all existing targeted batch/runner tests passing.
- [x] Implementation ran `test/batch-orchestration.unit.test.js`, batch cooldown/PBT/runner tests, layering guard, `npm test`, and `npm run lint`.

## Open Questions

No blocking repository-answerable question remains.

One user decision remains before implementation start: accept the recommended conservative scope, or choose a broader file split that may require an OpenSpec proposal.


