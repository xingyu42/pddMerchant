# Implementation Plan: Command runtime spec synchronization

## Phase 1: Planning Gate

- [x] Create Trellis task.
- [x] Confirm no active task and clean git state.
- [x] Read `trellis-brainstorm`.
- [x] Read `pdd-openspec-change-flow`.
- [x] Read `openspec/AGENTS.md` and `openspec/project.md`.
- [x] Run `openspec list` and `openspec list --specs`.
- [x] Read current candidate specs:
  - `openspec/specs/cli-runtime/spec.md`
  - `openspec/specs/endpoint-transport/spec.md`
  - `openspec/specs/batch-command/spec.md`
- [x] Inspect actual code truth:
  - `src/commands/_runner.js`
  - `src/commands/runner/**`
  - `package.json`
  - `rg "withCommand(" src/commands -g "*.js"`
- [x] Decide recommended first slice: current truth docs only.

## Phase 2: Implementation Steps

After user review and `task.py start`:

1. Load `trellis-before-dev`.
2. Read applicable docs/spec guidance:
   - `openspec/AGENTS.md`
   - `openspec/project.md`
   - `.trellis/spec/architecture/dependency-flow.md` if code paths are referenced
   - `.trellis/spec/standards/testing.md` for current test wording
3. Edit only the planned current-doc files unless a blocker is discovered:
   - `openspec/project.md`
   - `openspec/specs/cli-runtime/spec.md`
   - `openspec/specs/endpoint-transport/spec.md`
   - `openspec/specs/batch-command/spec.md`
4. Keep the changes semantic-preserving:
   - update old paths;
   - update stale test framework wording;
   - update stale hard-coded counts;
   - do not add or remove behavior requirements.
5. Do not edit archives in this slice.

## Phase 3: Validation Commands

Planned validation:

```bash
rg -n "src/infra/command-runner\.js|all 427 existing tests|node:test|All 13 commands" openspec/project.md openspec/specs
rg -n "command-runner\.js" openspec/specs/cli-runtime/spec.md openspec/specs/endpoint-transport/spec.md openspec/specs/batch-command/spec.md
openspec validate --strict --no-interactive
```

If full OpenSpec validation is unsupported, run the supported strict validation variant and record exact output.

No `npm test` is required for docs-only changes. If any source/test file changes, stop and re-plan validation.

## Phase 4: Finish Gate

- [ ] Run validation commands.
- [ ] Review `git diff` to confirm docs-only scope.
- [ ] Request commit authorization with file list.
- [ ] Archive task and record journal after commit.

## Rollback Points

- If validation fails because the markdown structure breaks OpenSpec parsing, revert the affected spec and reapply smaller wording-only edits.
- If scope expands to active change history, pause and ask the user before editing `openspec/changes/**`.

## Phase 2 Progress: Current-doc synchronization

- [x] Updated `openspec/project.md` from stale `node:test` wording to current Vitest wording.
- [x] Updated `openspec/specs/cli-runtime/spec.md` from old `src/infra/command-runner.js` wording to current `src/commands/_runner.js` facade plus `src/commands/runner/**` internals.
- [x] Updated `openspec/specs/endpoint-transport/spec.md` from generic `command-runner.js` wording to current command runner live lifecycle path.
- [x] Updated `openspec/specs/batch-command/spec.md` from stale `427` test count to count-free compatibility wording.
- [x] Left `openspec/changes/archive/**` and completed change history untouched.

## Phase 3 Validation Results

- [x] `rg -n "src/infra/command-runner\\.js|all 427 existing tests|node:test|All 13 commands" openspec/project.md openspec/specs` — no stale current-doc references.
- [x] `rg -n "command-runner\\.js" openspec/specs/cli-runtime/spec.md openspec/specs/endpoint-transport/spec.md openspec/specs/batch-command/spec.md` — no old `command-runner.js` references in changed specs.
- [x] `openspec validate cli-runtime --strict --no-interactive` — valid.
- [x] `openspec validate endpoint-transport --strict --no-interactive` — valid.
- [x] `openspec validate batch-command --strict --no-interactive` — valid.
- [x] `openspec validate --specs --strict --no-interactive` — changed specs passed; existing unrelated failures remain in `auth-lock` and `daemon-lifecycle` due missing/invalid scenario formatting.
- [x] `git check-ignore -v ...` — `openspec/` is ignored by `.gitignore`, so these docs require targeted `git add -f` if they should be committed.

## Commit Note

Because `.gitignore` ignores `openspec/`, normal `git status` is clean even after this docs update. A durable repository commit requires targeted force-add of only the four changed docs, not the whole `openspec/` directory.
