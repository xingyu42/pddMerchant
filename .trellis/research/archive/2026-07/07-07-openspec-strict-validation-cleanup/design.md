# Design: OpenSpec strict validation cleanup

## Context

OpenSpec strict validation requires each requirement under `## Requirements` to contain normative SHALL/MUST wording and at least one level-4 scenario header in the form `#### Scenario: ...`.

The current failures are format problems in existing specs, not behavior disputes. The safest fix is to add scenarios that restate existing behavior already present in the spec text.

## Design Decision

Use minimal format repair:

- preserve existing headings and behavior where possible;
- rename only the non-standard `### Defaults` heading because OpenSpec parses it as a requirement;
- add scenarios that match the current text;
- do not introduce new requirements beyond existing documented behavior.

## File-Level Plan

### `openspec/specs/auth-lock/spec.md`

Planned changes:

- Under `### Requirement: PID Liveness Check`, add scenarios for PID liveness behavior.
- Convert `### Defaults` to `### Requirement: Lock Timing Defaults`.
- Add SHALL wording: lock acquisition defaults SHALL be `timeoutMs=30_000`, `staleMs=120_000`, and `retryMs=200` unless overridden.
- Add one scenario for default timing options.

### `openspec/specs/daemon-lifecycle/spec.md`

Planned changes:

- Under `### Requirement: daemon-state.json Format`, add explicit SHALL wording and a scenario for atomic state writes.
- Under `### Requirement: Doctor Integration`, add a scenario for `pdd doctor` including daemon state.
- Under `### Requirement: Foreground Mode`, add a scenario for `bin/pdd-daemon.js --foreground` running attached.
- Under `### Requirement: Not Using withCommand`, add a scenario proving daemon commands bypass browser-launching runner lifecycle while still emitting envelopes.

## OpenSpec Proposal Decision

No OpenSpec proposal is required. The work is documentation-format repair only and does not change any capability or behavior.

## Validation Design

Run:

```bash
openspec validate auth-lock --strict --no-interactive
openspec validate daemon-lifecycle --strict --no-interactive
openspec validate --specs --strict --no-interactive
```

No runtime tests are required unless source/test files change.

## Risks and Mitigations

- Risk: Accidentally changes intended daemon/auth-lock behavior.
  - Mitigation: Use scenarios that restate existing text only.
- Risk: Fixing format in one place exposes another strict-validation issue.
  - Mitigation: Run full specs validation after individual specs pass.
- Risk: The changed docs remain ignored by Git.
  - Mitigation: Record ignored status and ask before targeted force-add if the user wants a commit.

## Rollback

Rollback is documentation-only: revert the two spec files and rerun the same OpenSpec validation commands.
