# Endpoint attempt lifecycle extraction

## Goal

Extract shared endpoint attempt lifecycle only after diagnostics, invariant tests, and compatible strategy resolution are in place.

This is the highest-risk follow-up from the parent SCAMPER map and combines candidates C1, M1, E3, and A1.

## Requirements

- Keep `PlaywrightEndpointClient.execute()` as the stable public coordinator/facade while extracting internal responsibilities.
- Combine duplicated `_attemptFetch()` and `_attemptLegacy()` lifecycle concerns without changing behavior:
  - timeout calculation;
  - XHR collector creation/waiting;
  - pageSession/page navigation;
  - optional `readyEl` wait;
  - trigger execution;
  - navigation error wrapping;
  - collector disposal and route cleanup where applicable.
- Let transport-specific strategies provide only minimal request preparation/cleanup differences, such as route payload merge for intercepted fetch paths.
- Consider endpoint-client decomposition following the runner lifecycle split pattern, while avoiding unnecessary indirection.
- Preserve invariants from the endpoint refactor invariant task.

## Constraints

- Do not start this task before diagnostics, invariant tests, and compatible strategy resolver planning are reviewed.
- Do not change public endpoint client behavior, envelope shape, or service-layer call sites unless separately approved.
- Do not combine retry/cooldown into strategy-specific lifecycle implementations.
- Do not commit changes without explicit user authorization.

## Acceptance Criteria

- [ ] Shared lifecycle boundaries are documented before code movement.
- [ ] `_attemptFetch()` and `_attemptLegacy()` duplication is reduced only where behavior is protected by tests.
- [ ] Route cleanup, abort, retries, collector waits, and nav URL resolution invariants remain intact.
- [ ] `PlaywrightEndpointClient.execute()` remains the stable public entry point.
- [ ] Targeted tests validate no behavior regression.

## Sequencing

1. Complete endpoint spec diagnostics.
2. Complete endpoint refactor invariant tests.
3. Complete compatible strategy resolver.
4. Extract shared lifecycle in small no-behavior-change steps.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
