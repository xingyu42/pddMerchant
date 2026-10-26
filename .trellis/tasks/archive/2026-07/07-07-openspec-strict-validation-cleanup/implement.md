# Implementation Plan: OpenSpec strict validation cleanup

## Phase 1: Planning Gate

- [x] Create Trellis task.
- [x] Read `trellis-brainstorm`.
- [x] Read `pdd-openspec-change-flow`.
- [x] Inspect `openspec validate auth-lock --strict --no-interactive` failure output.
- [x] Inspect `openspec validate daemon-lifecycle --strict --no-interactive` failure output.
- [x] Read `openspec/specs/auth-lock/spec.md`.
- [x] Read `openspec/specs/daemon-lifecycle/spec.md`.
- [x] Decide recommended first slice: minimal format repair only.

## Phase 2: Implementation Steps

After user review and `task.py start`:

1. Load `trellis-before-dev`.
2. Re-read current task artifacts and relevant OpenSpec instructions.
3. Edit only:
   - `openspec/specs/auth-lock/spec.md`
   - `openspec/specs/daemon-lifecycle/spec.md`
4. Add missing `#### Scenario:` blocks.
5. Add SHALL/MUST wording only where validation requires it.
6. Do not modify behavior semantics.
7. Do not edit source code or tests.

## Phase 3: Validation Commands

```bash
openspec validate auth-lock --strict --no-interactive
openspec validate daemon-lifecycle --strict --no-interactive
openspec validate --specs --strict --no-interactive
```

Also inspect:

```bash
git status --short --ignored openspec/specs/auth-lock/spec.md openspec/specs/daemon-lifecycle/spec.md
```

No `npm test` is required for docs-only changes.

## Phase 4: Finish Gate

- [ ] Run validation commands.
- [ ] Review docs diff/content.
- [ ] Ask whether to keep ignored docs local-only or targeted force-add to Git.
- [ ] Archive task and record journal.

## Rollback Points

- If individual spec validation still fails, use validator messages to add only the missing scenario/SHALL wording.
- If full spec validation reveals unrelated failures, record them and do not expand scope without user approval.

## Phase 2 Progress: Strict validation format repair

- [x] Updated `openspec/specs/auth-lock/spec.md` with missing scenarios for PID liveness and lock timing defaults.
- [x] Converted `auth-lock` `### Defaults` into `### Requirement: Lock Timing Defaults` with explicit SHALL wording.
- [x] Updated `openspec/specs/daemon-lifecycle/spec.md` with explicit SHALL wording and missing scenarios for daemon state format, doctor integration, foreground mode, and daemon commands bypassing `withCommand`.
- [x] Did not modify runtime source, tests, fixtures, package scripts, or behavior semantics.

## Phase 3 Validation Results

- [x] `openspec validate auth-lock --strict --no-interactive` — valid.
- [x] `openspec validate daemon-lifecycle --strict --no-interactive` — valid.
- [x] `openspec validate --specs --strict --no-interactive` — passed, 14 specs / 0 failed.
- [x] `git status --short` — clean for tracked files.
- [x] `git status --short --ignored ...` — `openspec/` remains ignored; changes are local-only per prior user preference unless targeted `git add -f` is explicitly requested.
