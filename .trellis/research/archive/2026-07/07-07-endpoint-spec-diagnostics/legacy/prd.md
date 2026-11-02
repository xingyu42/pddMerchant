# Endpoint spec diagnostics

## Goal

Introduce a warning-first endpoint spec diagnostics plan that catches endpoint authoring mistakes before live Playwright execution, without changing current runtime behavior.

This is the first follow-up from the SCAMPER endpoint execution optimization map and combines candidates E1 and P1.

## Requirements

- Add or plan a `validateEndpointSpec(spec)` capability as a diagnostics/test-helper first, not as production hard-fail enforcement.
- Detect endpoint spec shapes that currently fail only during live runtime, including:
  - ambiguous transport inference such as `buildPayload` without the expected fetch-path companions;
  - missing or unusable `urlPattern`;
  - incomplete `buildPayload` / `apiUrl` combinations;
  - `requiredTrigger` without a usable `trigger`;
  - unclear `isSuccess` / `errorMapper` / `normalize` combinations.
- Keep existing `PlaywrightEndpointClient.execute()` behavior stable for this task.
- Report diagnostics in a warning-first format suitable for tests or developer review.
- Use the parent SCAMPER task order: this task precedes endpoint refactor invariant tests, strategy resolver work, and lifecycle extraction.

## Constraints

- Do not make diagnostics a runtime hard fail in the first iteration.
- Do not change endpoint transport behavior or response normalization in this task.
- Do not commit changes without explicit user authorization.

## Acceptance Criteria

- [x] Existing endpoint specs can be checked by the diagnostics helper or plan.
- [x] Diagnostics classify ambiguous or invalid spec shapes with stable warning codes/messages.
- [x] No live endpoint execution behavior changes are required for this task.
- [x] Follow-up findings can feed the compatible strategy resolver task.
- [x] Targeted tests or a clear validation plan cover the diagnostic rules.

## Sequencing

1. Implement or plan warning-first endpoint spec diagnostics.
2. Use findings to inform refactor invariants and strategy resolver scope.
3. Only later consider promoting stable warnings to stricter enforcement.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
