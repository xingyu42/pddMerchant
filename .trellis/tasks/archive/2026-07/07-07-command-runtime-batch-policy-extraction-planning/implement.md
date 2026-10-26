# Implementation Plan: Batch policy extraction

## Phase 1: Planning Gate

- [x] Create Trellis task.
- [x] Confirm no active task and clean git state.
- [x] Read `trellis-brainstorm`.
- [x] Read `pdd-openspec-change-flow`.
- [x] Read `openspec/AGENTS.md` and `openspec/project.md`.
- [x] Run `openspec list` and `openspec list --specs`.
- [x] Read `openspec/specs/batch-command/spec.md`.
- [x] Read `openspec/specs/cli-runtime/spec.md`.
- [x] Read `src/commands/runner/batch-executor.js`.
- [x] Read `test/batch-orchestration.unit.test.js`.
- [x] Read relevant Trellis specs:
  - `.trellis/spec/commands/runner-lifecycle.md`
  - `.trellis/spec/architecture/dependency-flow.md`
  - `.trellis/spec/commands/command-contracts.md`

## Phase 2: Implementation Steps

After user review and `task.py start`:

1. Load `trellis-before-dev`.
2. Re-read applicable implementation specs:
   - `.trellis/spec/commands/runner-lifecycle.md`
   - `.trellis/spec/architecture/dependency-flow.md`
   - `.trellis/spec/commands/command-contracts.md`
   - `.trellis/spec/infra/envelope-errors-output.md`
   - `.trellis/spec/standards/testing.md`
3. Run the current targeted baseline:
   ```bash
   npx vitest run test/batch-orchestration.unit.test.js test/batch-cooldown-attribution.unit.test.js test/pbt/batch-command.pbt.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
   ```
4. Extract `validateBatchOptions(opts)` inside `src/commands/runner/batch-executor.js`.
5. Extract `buildPerAccountOptions(opts, slug, batch)` inside the same file.
6. Extract `batchJitterMs(random = Math.random)` only if the resulting call site stays clearer.
7. Consider a tiny finalization metadata helper only if it removes duplication without hiding behavior.
8. Do not move helpers into `src/infra/` or create a new module unless the design is revised first.
9. Keep `withCommand()`, `executeBatch()`, `runAccountLoop()`, `runOneAccount()`, `finalizeBatch()`, and `applyCooldownAttribution()` behavior unchanged.

## Phase 3: Validation Commands

Minimum validation after implementation:

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

- [ ] Run final checks after implementation.
- [ ] Review diff for no behavior changes beyond helper extraction.
- [ ] Decide whether `.trellis/spec/commands/runner-lifecycle.md` needs a small update about helper ownership.
- [ ] Request commit authorization with an explicit file list.
- [ ] Archive task and record journal after commit.

## Rollback Points

- If tests fail after `validateBatchOptions()`, inline it and re-run targeted tests before trying another extraction.
- If `buildPerAccountOptions()` makes the original flow harder to read, inline it and keep only validation extraction.
- If a behavior change appears necessary, stop implementation and return to planning/OpenSpec decision.

## Phase 2 Progress: Same-module helper extraction

- [x] Extracted `validateBatchOptions(opts)` inside `src/commands/runner/batch-executor.js`.
- [x] Extracted `buildPerAccountOptions(opts, slug, batch)` inside the same file.
- [x] Extracted `batchJitterMs(random = Math.random)` inside the same file.
- [x] Kept `withCommand()` and `src/commands/_runner.js` facade unchanged.
- [x] Kept `executeBatch()`, `runAccountLoop()`, `runOneAccount()`, `finalizeBatch()`, and `applyCooldownAttribution()` observable behavior unchanged.
- [x] Did not add new modules, new dependencies, or OpenSpec proposal.

## Phase 3 Validation Results

- [x] Baseline before refactor: `npx vitest run test/batch-orchestration.unit.test.js test/batch-cooldown-attribution.unit.test.js test/pbt/batch-command.pbt.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js` — passed, 5 files / 25 tests.
- [x] `npx vitest run test/batch-orchestration.unit.test.js` — passed, 1 file / 5 tests.
- [x] `npx vitest run test/batch-orchestration.unit.test.js test/batch-cooldown-attribution.unit.test.js test/pbt/batch-command.pbt.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js` — passed, 5 files / 25 tests.
- [x] `npx vitest run test/layering-guard.unit.test.js` — passed, 1 file / 3 tests.
- [x] `git diff --check` — passed.
- [x] `npm test` — passed, 119 files / 957 tests.
- [x] `npm run lint` — passed but remains placeholder output `no-lint`.

## Spec Update Judgment

No `.trellis/spec/` update is needed for this implementation because it follows the batch orchestration invariants already recorded in `.trellis/spec/commands/runner-lifecycle.md` and does not introduce a new public contract or reusable cross-module pattern.
