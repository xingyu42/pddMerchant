# Compatible endpoint strategy resolver

## Goal

Introduce a compatible endpoint strategy resolution plan that makes endpoint transport semantics explicit while preserving existing inferred behavior.

This task follows endpoint diagnostics and invariant capture, and combines candidates S1, E2, R1, and R2 from the parent SCAMPER map.

## Requirements

- Add or plan `resolveEndpointStrategy(meta)` as a compatibility layer over the current implicit fetch/legacy inference.
- Preserve existing behavior where fetch path is inferred from `typeof meta.buildPayload === 'function' && meta.apiUrl` and legacy path remains the fallback.
- Allow diagnostics to recommend explicit strategy declarations for new, touched, or ambiguous endpoint specs.
- Ensure validation and strategy resolution can conceptually happen before cooldown, limiter acquisition, and retry execution.
- Keep retry, limiter, and cooldown policy outside the strategy lifecycle; strategies should describe single-attempt transport semantics.
- Preserve current endpoint public contracts and error-code mapping unless an OpenSpec proposal is explicitly created and approved.

## Constraints

- Do not require every existing endpoint spec to declare a strategy in the first iteration.
- Do not move retry/cooldown into strategy implementations.
- Do not alter endpoint response normalization or envelope shape.
- Do not commit changes without explicit user authorization.

## Acceptance Criteria

- [ ] Existing endpoint behavior remains compatible under the resolver plan.
- [ ] Strategy resolution distinguishes intercepted-fetch-like and passive-xhr-like execution without breaking legacy specs.
- [ ] Diagnostics can surface ambiguous or inferred strategy cases.
- [ ] Retry/cooldown/limiter boundary is documented as outside strategy lifecycle.
- [ ] If endpoint authoring requirements change, an OpenSpec proposal is identified before implementation.

## Sequencing

1. Consume warning findings from endpoint spec diagnostics.
2. Confirm invariant coverage from endpoint refactor invariant tests.
3. Introduce compatible strategy resolution before lifecycle extraction.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
