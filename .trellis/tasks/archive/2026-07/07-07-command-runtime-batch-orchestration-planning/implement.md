# Implementation Plan: Batch orchestration invariants

## Phase 1: Planning Gate

- [x] Create Trellis planning task.
- [x] Inspect previous command runtime invariant task.
- [x] Inspect `src/commands/runner/batch-executor.js`.
- [x] Inspect OpenSpec batch-command requirements.
- [x] Inspect existing batch/runner tests.
- [x] Decide first slice: batch orchestration invariants.
- [x] Review planning artifacts with the user before `task.py start`.

## Phase 2: Implementation Steps

After task start:

1. Load `trellis-before-dev` and re-read applicable specs:
   - `.trellis/spec/architecture/runtime-lifecycle.md`
   - `.trellis/spec/architecture/dependency-flow.md`
   - `.trellis/spec/commands/runner-lifecycle.md`
   - `.trellis/spec/commands/command-contracts.md`
   - `.trellis/spec/infra/envelope-errors-output.md`
   - `.trellis/spec/standards/testing.md`
2. Add a focused test file, likely `test/batch-orchestration.unit.test.js`.
3. Mock these dependencies:
   - `src/commands/runner/single-lifecycle.js` → `executeSingle`
   - `src/infra/account-registry.js` → `listAccounts`
   - `src/infra/daemon-launcher.js` → `ensureDaemonRunning`
   - `src/infra/abort.js` → `abortableSleep`
   - `src/infra/output.js` → `emit`, while preserving `buildBatchEnvelope`/`batchRenderer`
4. Add tests for the selected contracts:
   - mutual exclusions fail before daemon/account execution where applicable;
   - empty enabled accounts emits OK empty batch and skips daemon/execution/jitter;
   - non-empty batch calls daemon once;
   - per-account options are shaped correctly;
   - jitter count is `accounts.length - 1` and uses batch signal;
   - batch emits once and returns the emitted envelope.
5. Keep runtime files unchanged unless a test exposes an already-existing bug; if that happens, pause and update plan before fixing.

## Phase 3: Validation Commands

```bash
npx vitest run test/batch-orchestration.unit.test.js
npx vitest run test/batch-orchestration.unit.test.js test/batch-cooldown-attribution.unit.test.js test/pbt/batch-command.pbt.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
npx vitest run test/layering-guard.unit.test.js
npm test
npm run lint
```

Notes:

- `npm run lint` currently prints `no-lint`; report it as placeholder only.
- Do not claim CI.

## Phase 4: Finish Gate

- [x] Update Trellis spec only if a durable batch orchestration contract is learned.
- [x] Run final checks.
- [ ] Show diff summary.
- [ ] Ask for commit authorization.
- [ ] Archive task and record journal after commit.

## Rollback Points

- If tests are too mock-heavy or brittle, narrow them to fewer observable contracts.
- If implementation requires runtime changes, pause and revise design before coding.
- If runtime behavior change affects public batch semantics, create/update OpenSpec first.

## Phase 2 Progress: Batch orchestration invariants

- [x] Added `test/batch-orchestration.unit.test.js`.
- [x] Covered `--all-accounts` + `--account` mutual exclusion before account iteration, daemon start, jitter, or emit.
- [x] Covered `PDD_AUTH_STATE_PATH` mutual exclusion before account iteration, daemon start, jitter, or emit.
- [x] Covered all-disabled accounts emitting an OK empty batch and skipping daemon/execution/jitter.
- [x] Covered non-empty batch daemon-once behavior.
- [x] Covered per-account option shaping: `allAccounts:false`, `mall:undefined`, account-specific `authStatePath`, and per-account correlation id suffix.
- [x] Covered jitter count/range/signal semantics between accounts only.
- [x] Covered non-batch routing for `needsAuth:false` commands.
- [x] Preserved runtime code unchanged; this slice is test/spec-only.

## Phase 3 Validation Results

- [x] `npx vitest run test/batch-orchestration.unit.test.js` — passed, 1 file / 5 tests.
- [x] `npx vitest run test/batch-orchestration.unit.test.js test/batch-cooldown-attribution.unit.test.js test/pbt/batch-command.pbt.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js` — passed, 5 files / 25 tests.
- [x] `npx vitest run test/layering-guard.unit.test.js` — passed, 1 file / 3 tests.
- [x] `npm test` — passed, 119 files / 957 tests.
- [x] `npm run lint` — passed but is placeholder output `no-lint`.
