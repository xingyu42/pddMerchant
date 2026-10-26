# OpenSpec strict validation cleanup

## Goal

Fix existing OpenSpec strict-validation format failures in the current specs so `openspec validate --specs --strict --no-interactive` can pass for specs.

This is a documentation-format cleanup only. It must not change runtime behavior, public CLI contracts, envelope shape, or implementation files.

## Background

The previous spec synchronization task ran `openspec validate --specs --strict --no-interactive` and found 12 specs valid, with 2 existing failures:

- `auth-lock`
- `daemon-lifecycle`

The changed specs from the previous task (`cli-runtime`, `endpoint-transport`, `batch-command`) validate individually. The remaining failures are unrelated existing OpenSpec format issues.

## Confirmed Facts

### `auth-lock` failures

`openspec validate auth-lock --strict --no-interactive` reports:

- `requirements.2.scenarios`: Requirement must have at least one scenario.
- `requirements.3.text`: Requirement must contain SHALL or MUST keyword.
- `requirements.3.scenarios`: Requirement must have at least one scenario.

Evidence in `openspec/specs/auth-lock/spec.md`:

- `### Requirement: PID Liveness Check` has normative text but no `#### Scenario:` block.
- `### Defaults` is under `## Requirements`, so OpenSpec parses it as a requirement; it lacks `Requirement:` naming, lacks SHALL/MUST wording, and has no scenario.

### `daemon-lifecycle` failures

`openspec validate daemon-lifecycle --strict --no-interactive` reports:

- `requirements.4.text`: Requirement must contain SHALL or MUST keyword.
- `requirements.4.scenarios`: Requirement must have at least one scenario.
- `requirements.5.scenarios`: Requirement must have at least one scenario.
- `requirements.6.scenarios`: Requirement must have at least one scenario.
- `requirements.7.scenarios`: Requirement must have at least one scenario.

Evidence in `openspec/specs/daemon-lifecycle/spec.md`:

- `### Requirement: daemon-state.json Format` has schema text and atomic-write text but needs explicit SHALL/MUST wording and a scenario.
- `### Requirement: Doctor Integration` has SHALL text but no scenario.
- `### Requirement: Foreground Mode` has SHALL text but no scenario.
- `### Requirement: Not Using withCommand` has SHALL text but no scenario.

## Requirements

- R1: Keep this task in planning until artifacts are reviewed and the user approves `task.py start`.
- R2: This slice MUST be documentation-format-only.
- R3: Do not change source code, tests, fixtures, package scripts, behavior requirements, or runtime semantics.
- R4: Only edit current failing specs:
  - `openspec/specs/auth-lock/spec.md`
  - `openspec/specs/daemon-lifecycle/spec.md`
- R5: Preserve existing meaning; only add/reshape requirement headers, SHALL/MUST wording, and `#### Scenario:` blocks needed by OpenSpec strict validation.
- R6: No OpenSpec proposal is required because this is documentation-only format repair of existing current specs.
- R7: Remember `openspec/` is ignored by `.gitignore`; unless the user explicitly chooses targeted `git add -f`, changes remain local-only.

## Recommended Slice

Choose **minimal strict-validation repair**.

Planned edits:

1. `auth-lock`:
   - Add at least one scenario to `PID Liveness Check`.
   - Convert `### Defaults` into `### Requirement: Lock Timing Defaults` with explicit SHALL wording and a scenario.
2. `daemon-lifecycle`:
   - Add explicit SHALL wording and a scenario to `daemon-state.json Format`.
   - Add scenarios to `Doctor Integration`, `Foreground Mode`, and `Not Using withCommand`.

## Out of Scope

- Changing spec behavior.
- Updating implementation code.
- Editing unrelated specs.
- Editing archived OpenSpec changes.
- Force-adding ignored `openspec/` files to Git unless explicitly approved later.

## Acceptance Criteria

- [x] `design.md` and `implement.md` exist before `task.py start`.
- [x] `openspec validate auth-lock --strict --no-interactive` passes.
- [x] `openspec validate daemon-lifecycle --strict --no-interactive` passes.
- [x] `openspec validate --specs --strict --no-interactive` passes for all specs.
- [x] `git status` handling is explicit: OpenSpec docs remain local-only ignored changes per prior user preference.

## Open Questions

No blocking repository-answerable question remains. The next gate is user approval to start implementation.


