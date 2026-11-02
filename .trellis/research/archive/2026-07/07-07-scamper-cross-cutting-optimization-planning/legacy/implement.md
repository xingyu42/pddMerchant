# Implementation Plan: Command runtime diagnostics and invariants

## Phase 1: Planning Gate

- [x] Create Trellis planning task.
- [x] Confirm next SCAMPER target: command runtime / batch / single lifecycle contract.
- [x] Confirm first slice: diagnostics + invariants.
- [x] Inspect runner code, tests, OpenSpec, and Trellis specs.
- [x] Review this PRD/design/implement plan with the user before starting.

## Phase 2: First Slice Candidate Work

Recommended implementation order after `task.py start`:

1. Re-read required specs before editing:
   - `.trellis/spec/architecture/runtime-lifecycle.md`
   - `.trellis/spec/architecture/dependency-flow.md`
   - `.trellis/spec/commands/runner-lifecycle.md`
   - `.trellis/spec/commands/command-contracts.md`
   - `.trellis/spec/infra/envelope-errors-output.md`
2. Add focused runner invariant coverage without changing runtime behavior.
   - Prefer extending `test/pbt/with-command.pbt.test.js` or adding a small runner contract unit/PBT file.
   - Candidate assertions:
     - success and error paths emit at most once when `emitResult: true`;
     - `emitResult: false` returns an envelope and emits nothing;
     - result `warnings` merge with runtime warnings once;
     - batch per-account warnings survive into batch warnings without changing exit semantics;
     - timeout/deadline appears in ctx when `timeoutMs` is supplied.
3. If a helper is needed, keep it test-local first.
4. Do not refactor `batch-executor.js` in this slice.
5. Do not update OpenSpec unless the implementation confirms a stable documentation drift that should be captured as spec sync.

## Phase 3: Validation Commands

Run from repo root after implementation:

```bash
npx vitest run test/pbt/with-command.pbt.test.js test/pbt/ctx-contract.pbt.test.js test/pbt/batch-command.pbt.test.js test/batch-cooldown-attribution.unit.test.js
npx vitest run test/command-runner.unit.test.js test/pbt/raw-strip.pbt.test.js test/pbt/abort-timeout.pbt.test.js
npx vitest run test/layering-guard.unit.test.js
npm test
npm run lint
```

Notes:

- `npm run lint` is currently a placeholder that prints `no-lint`; report it honestly.
- Do not claim CI unless a real CI workflow is verified.

## Phase 4: Finish Gate

- [x] Update Trellis spec if a durable runner contract or doc drift is confirmed.
- [x] Run final checks.
- [ ] Show `git diff --stat` and relevant diff summary.
- [ ] Ask for commit authorization before committing.
- [ ] Archive task and record session only after implementation and checks are complete.

## Rollback Points

- If new tests are flaky, remove or narrow the new test cases before changing runtime code.
- If a runtime change appears necessary, pause and update design/acceptance criteria before implementing it.
- If behavior change is public or architectural, create/update OpenSpec proposal before proceeding.

## Phase 2 Progress: Runner contract invariants

- [x] Added `test/runner-contract.unit.test.js`.
- [x] Covered `emitResult: true` success path emits exactly once.
- [x] Covered `emitResult: true` error path emits exactly once.
- [x] Covered `emitResult: false` returns an envelope without emitting.
- [x] Covered runner warning + result warning merge order and single inclusion.
- [x] Covered `timeoutMs` injection of `ctx.signal` and `ctx.deadlineAt`.
- [x] Preserved runtime code unchanged; this slice is test/spec-only.

## Phase 3 Validation Results

- [x] `npx vitest run test/runner-contract.unit.test.js` — passed, 1 file / 5 tests.
- [x] `npx vitest run test/runner-contract.unit.test.js test/pbt/with-command.pbt.test.js test/pbt/ctx-contract.pbt.test.js test/pbt/batch-command.pbt.test.js test/batch-cooldown-attribution.unit.test.js test/command-runner.unit.test.js test/pbt/raw-strip.pbt.test.js test/pbt/abort-timeout.pbt.test.js` — passed, 8 files / 44 tests.
- [x] `npx vitest run test/layering-guard.unit.test.js` — passed, 1 file / 3 tests.
- [x] `npm test` — passed, 118 files / 952 tests.
- [x] `npm run lint` — passed but is placeholder output `no-lint`.
