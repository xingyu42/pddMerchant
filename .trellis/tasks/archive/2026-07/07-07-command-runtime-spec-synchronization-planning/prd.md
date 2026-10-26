# Command runtime spec synchronization planning

## Goal

Plan a small documentation-only synchronization slice for current OpenSpec truth after the command runtime refactor chain.

In plain terms: the code now uses `src/commands/_runner.js` plus `src/commands/runner/**`, Vitest, and 957 tests. Some current OpenSpec text still points future agents to older paths or stale counts. This task narrows the exact docs to update without changing runtime code.

## Background

The recent command runtime chain completed:

- `8fedd5e ✅ test(commands): freeze runner contract invariants`
- `94dfd54 ✅ test(commands): freeze batch orchestration invariants`
- `c4ca930 ♻️ refactor(commands): extract batch policy helpers`

Current repo facts at task creation:

- Branch: `main`.
- Working tree: clean.
- Current Trellis active task: this task.
- No runtime code change is intended for this slice.

## Confirmed Facts

### Current code truth

- `src/commands/_runner.js` is the runner facade and re-exports:
  - `executeSingle` from `./runner/single-lifecycle.js`
  - `withCommand` from `./runner/batch-executor.js`
- Current runner internals are:
  - `src/commands/runner/batch-executor.js`
  - `src/commands/runner/envelope-finalizer.js`
  - `src/commands/runner/fixture-runtime.js`
  - `src/commands/runner/single-lifecycle.js`
- `package.json` test script is `vitest run`; lint script is `echo no-lint`.
- Current verified full suite result from the last task was `119 files / 957 tests`.
- Current `rg "withCommand(" src/commands -g "*.js"` finds 23 command handlers plus the `withCommand` definition.

### Current documentation drift

- `openspec/specs/cli-runtime/spec.md` still says `withCommand(...)` lives in `src/infra/command-runner.js`.
- `openspec/specs/cli-runtime/spec.md` still labels the scenario as `All 13 commands share one launch/close path`.
- `openspec/specs/endpoint-transport/spec.md` says `getSharedClient()` is called again from `command-runner.js`, while current live ctx construction happens in `src/commands/runner/single-lifecycle.js` and `runEndpoint` uses `src/adapter/run-endpoint.js`.
- `openspec/specs/endpoint-transport/spec.md` says `The command-runner SHALL populate ctx.pageSession`, which should be updated to the current runner path/module wording.
- `openspec/specs/batch-command/spec.md` still says `all 427 existing tests pass without modification`.
- `openspec/project.md` still describes tests as `node:test` in the tech stack and testing strategy, while current scripts and project specs use Vitest.
- `openspec/changes/goods-management-write-ops/**` also contains old `src/infra/command-runner.js` references, but this is an active completed proposal/task history, not the current spec truth.
- `openspec/changes/archive/**` contains many historical old-path references. Those should remain historical records and are out of scope.

## Requirements

- R1: Keep this as a Trellis planning task until artifacts are reviewed and the user approves `task.py start`.
- R2: This slice MUST be documentation-only.
- R3: Do not change runtime code, tests, fixtures, package scripts, or OpenSpec behavior requirements.
- R4: Keep the first implementation slice limited to current truth docs:
  - `openspec/project.md`
  - `openspec/specs/cli-runtime/spec.md`
  - `openspec/specs/endpoint-transport/spec.md`
  - `openspec/specs/batch-command/spec.md`
- R5: Do not edit `openspec/changes/archive/**`; archived changes are historical records.
- R6: Do not edit completed-but-unarchived change tasks/proposals in this first slice unless implementation reveals they block OpenSpec validation or current navigation.
- R7: No OpenSpec proposal is required because this is documentation-only synchronization of existing built behavior.

## Recommended Slice

Choose **current truth spec sync only**.

Planned edits:

1. Update `openspec/project.md`:
   - replace `node:test` references with Vitest wording;
   - mention `npm test` runs `vitest run`;
   - keep zero-dependency custom PBT harness wording.
2. Update `openspec/specs/cli-runtime/spec.md`:
   - replace `src/infra/command-runner.js` with `src/commands/_runner.js` facade plus `src/commands/runner/**` internals;
   - replace `All 13 commands` scenario label/list with wording that does not hard-code a stale count.
3. Update `openspec/specs/endpoint-transport/spec.md`:
   - replace `command-runner.js` references with current runner/live lifecycle wording;
   - keep endpoint behavior unchanged.
4. Update `openspec/specs/batch-command/spec.md`:
   - replace the stale `427 existing tests` phrase with a non-count-based compatibility requirement, or current validation wording if needed.

## Out of Scope

- Runtime code changes.
- Test changes.
- New OpenSpec proposal.
- Archive rewrites under `openspec/changes/archive/**`.
- Broad cleanup of old completed change/task history.
- Updating README unless implementation finds a current README contradiction.

## Acceptance Criteria

- [x] Planning identifies exact current drift and recommended file scope.
- [x] Planning records why no OpenSpec proposal is required.
- [x] `design.md` and `implement.md` exist before `task.py start`.
- [x] Implementation changed only documentation files in the planned scope.
- [x] Implementation ran targeted text searches proving old current-doc references are gone.
- [x] Implementation ran supported OpenSpec validation; changed specs are valid, while unrelated existing `auth-lock` and `daemon-lifecycle` strict-validation failures remain.

## Open Questions

No blocking repository-answerable question remains.

One user decision remains before implementation: accept the recommended current-truth-only scope, or expand to completed-but-unarchived change history as well.


