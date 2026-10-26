# Endpoint refactor invariant tests

## Goal

Freeze endpoint execution behavior before strategy/lifecycle refactors, using PBT where appropriate and focused unit tests for concrete edge cases.

This task follows endpoint spec diagnostics and prepares the safety net for strategy resolver and lifecycle extraction work.

## Requirements

- Identify refactor-sensitive endpoint execution invariants from existing behavior.
- Preserve known invariants already covered by `test/pbt/run-endpoint.pbt.test.js`, including one-time `nav.url` evaluation, 429 retry count, and business-error naming compatibility.
- Add or plan additional invariant coverage for:
  - abort/timeout behavior during endpoint attempts;
  - route setup and cleanup for intercepted fetch paths;
  - collector wait behavior and empty/unparsable body handling;
  - stable error-code mapping for auth, network, rate-limit, and business errors;
  - fixture/live differences that must remain explicit rather than accidental.
- Keep tests targeted and fast; use PBT for broad invariants and unit tests for edge-specific behavior.
- Do not refactor production endpoint lifecycle code in this task unless explicitly approved later.

## Constraints

- Do not change endpoint runtime behavior as part of invariant capture.
- Do not make PBT coverage so broad that normal targeted validation becomes slow.
- Do not commit changes without explicit user authorization.

## Acceptance Criteria

- [ ] A documented invariant list exists for endpoint strategy/lifecycle refactors.
- [ ] Existing PBT coverage is preserved and extended only where it adds contract value.
- [ ] Route cleanup, abort/timeout, and error mapping have targeted validation coverage or a clear validation plan.
- [ ] The strategy resolver and lifecycle extraction tasks can reference these invariants as preconditions.
- [ ] No production behavior changes are required for this task.

## Sequencing

1. Read findings from endpoint spec diagnostics.
2. Freeze key endpoint behavior with PBT/unit tests.
3. Use this safety net before strategy resolver or lifecycle extraction.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
