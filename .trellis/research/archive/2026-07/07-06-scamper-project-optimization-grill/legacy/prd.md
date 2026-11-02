# SCAMPER project optimization grill

## Goal

Use SCAMPER as the interview frame to identify and prioritize project optimization opportunities for `pdd-cli`, while preserving repository contracts and capturing durable planning artifacts before any implementation.

The session should produce a small, explicit optimization backlog rather than immediately changing code.

## Requirements

- Run the optimization discussion as a `/grill-with-docs` style interview: one high-value question at a time, with a recommended answer and trade-off.
- Optimize for the user's stated objective set: reliability, runtime performance, maintainability, CLI UX, and architecture convergence.
- Resolve objective conflicts using this priority order: reliability > architecture convergence > maintainability > CLI UX > runtime performance.
- Limit the first SCAMPER pass to cross-cutting runtime contracts rather than a single business domain.
- Use endpoint execution contract as the first deep SCAMPER target.
- Use the SCAMPER lenses as the primary exploration structure:
  - Substitute: what implementations, flows, or dependencies might be replaceable.
  - Combine: what duplicated or parallel concepts might be unified.
  - Adapt: what successful internal or external patterns could be reused.
  - Modify / Magnify / Minify: what should be reshaped, strengthened, or reduced.
  - Put to another use: what existing components could serve additional scenarios.
  - Eliminate: what code, config, tests, or process steps might be removed.
  - Reverse / Rearrange: what ordering, ownership, or flow boundaries might be inverted or reorganized.
- Before asking repository-answerable questions, inspect available code, tests, docs, specs, or existing Trellis state.
- Keep the conversation in planning until the optimization scope, priorities, and acceptance criteria are reviewed.
- Do not commit changes without explicit user authorization.

## Confirmed Facts

- Repository: `pdd-cli`, a Node.js ESM CLI that drives Playwright/Chromium, captures Pinduoduo merchant XHR/fetch responses, and emits `{ ok, command, data, error, meta }` envelopes.
- Architecture contract: dependency flow is `commands -> services -> adapter -> infra`; envelope shape and exit-code mapping are high-risk shared contracts.
- Current git status at task creation included uncommitted promo-related changes:
  - `src/adapter/endpoint-client.js`
  - `src/adapter/endpoints/promo.js`
  - `test/endpoint-client-merge.unit.test.js`
  - `test/promo-endpoint.unit.test.js`
- Active Trellis tasks already existed for promo review findings and promo regression tests; this optimization grill is a separate planning task.
- No root `CONTEXT.md` or `CONTEXT-MAP.md` existed when checked; domain glossary docs should be created lazily only when terms are resolved.
- First-pass scope: cross-cutting runtime contracts, especially command runner lifecycle, fixture/live execution contract, envelope finalization, endpoint execution, auth/mall context, page session handling, timeout/abort, and rate-limit behavior.
- Evidence inspected for this scope includes `src/commands/_runner.js`, `src/commands/runner/single-lifecycle.js`, `src/commands/runner/fixture-runtime.js`, `src/commands/runner/envelope-finalizer.js`, `src/adapter/endpoint-client.js`, `src/adapter/run-endpoint.js`, `test/pbt/ctx-contract.pbt.test.js`, and `test/limiter-in-services.unit.test.js` snippets/results.
- Endpoint execution evidence: `PlaywrightEndpointClient.execute()` owns cooldown checks, limiter acquisition, retry execution, success metadata, and rate-limit failure attribution; `_executeWithRetry()` owns nav URL resolution, HTTP status handling, parse/body validation, business error mapping, rate-limit classification, normalization, and attempt accounting.
- Endpoint path evidence: `_attemptFetch()` and `_attemptLegacy()` duplicate navigation, ready element, trigger, collector, timeout, pageSession, and error-wrapping concerns while differing in route/payload merge behavior; fixture execution currently normalizes fixture data through `FixtureEndpointClient`/`mockRunEndpoint` without live navigation/collector behavior.

## SCAMPER Candidate Map

### S — Substitute

- Candidate S1: Substitute the current implicit fetch/legacy branch detection with an explicit endpoint execution strategy contract.
  - Evidence source: `src/adapter/endpoint-client.js` currently chooses fetch path when `typeof meta.buildPayload === 'function' && meta.apiUrl`, otherwise legacy path.
  - Expected value: improves reliability by making endpoint transport semantics explicit; supports architecture convergence by centralizing execution mode decisions; improves maintainability by reducing hidden coupling between endpoint spec fields and execution behavior.
  - Risk: may touch endpoint spec semantics and therefore should be planned as a follow-up task or OpenSpec proposal if it changes external behavior or authoring contracts.
  - Suggested next action: define the smallest non-breaking strategy resolver first, then evaluate whether `_attemptFetch()` and `_attemptLegacy()` lifecycle code can be shared.

### C — Combine

- Candidate C1: Combine duplicated endpoint attempt lifecycle shared by `_attemptFetch()` and `_attemptLegacy()`.
  - Evidence source: both paths in `src/adapter/endpoint-client.js` calculate timeouts, create an XHR collector, navigate through `pageSession` or `page`, wait for optional `readyEl`, run endpoint triggers, wrap navigation errors, and wait for collector responses.
  - Expected value: improves reliability by making navigation/collector/trigger behavior single-source; supports architecture convergence by naming the endpoint attempt lifecycle; improves maintainability by reducing duplicated changes across transport paths.
  - Risk: an over-general callback abstraction could hide fetch/legacy differences; refactoring must preserve existing invariants such as nav URL resolution once per call, 429 retry count, abort handling, and route cleanup.
  - Suggested next action: first extract only the common lifecycle shell with no behavior change, then let fetch/legacy provide minimal request preparation and cleanup hooks.

### A — Adapt

- Candidate A1: Adapt the existing runner lifecycle split pattern to endpoint execution.
  - Evidence source: `src/commands/_runner.js` is already a stable facade over `runner/envelope-finalizer.js`, `runner/fixture-runtime.js`, `runner/single-lifecycle.js`, and `runner/batch-executor.js`; `src/adapter/endpoint-client.js` currently concentrates strategy selection, attempt lifecycle, retry, error mapping, payload merge, and cooldown behavior in one file.
  - Expected value: supports architecture convergence by applying an already accepted internal decomposition pattern; improves maintainability by giving endpoint strategy, attempt lifecycle, payload merge, and error mapping clearer homes while preserving the public client/facade contract.
  - Risk: premature file splitting could add indirection without reducing risk; any split must preserve existing exports used by tests and services.
  - Suggested next action: model a no-behavior-change endpoint split plan before implementation, keeping `endpoint-client.js` as the compatibility facade until call sites and tests are stable.

- Candidate A2: Adapt the existing PBT contract-test style to freeze endpoint refactor invariants.
  - Evidence source: `test/pbt/run-endpoint.pbt.test.js` already captures endpoint invariants such as one-time `nav.url` evaluation, 429 retry count, and business-error naming compatibility; `test/pbt/ctx-contract.pbt.test.js` similarly freezes command context shape.
  - Expected value: improves reliability by turning refactor-sensitive behavior into executable contracts before extraction; gives architecture changes a safety net.
  - Risk: PBT can become overly broad or slow if used for all cases; keep PBT for invariants and use focused unit tests for concrete edge cases like route cleanup or abort.
  - Suggested next action: define a small invariant list for endpoint strategy/lifecycle before any code movement.

### M — Modify / Magnify / Minify

- Candidate M1: Minify `PlaywrightEndpointClient` into a coordinator by extracting endpoint strategy, attempt lifecycle, payload merge, and error classification responsibilities.
  - Evidence source: `src/adapter/endpoint-client.js` currently owns cooldown checks, limiter acquisition, retry execution, nav URL resolution, fetch/legacy path selection, route setup/cleanup, collector lifecycle, trigger behavior, body parsing, rate-limit classification, business error mapping, normalization, payload merge, and success metadata.
  - Expected value: supports architecture convergence by assigning each endpoint execution concern a clear home; improves maintainability by reducing the blast radius of endpoint changes; improves reliability by enabling smaller contract tests around each extracted responsibility.
  - Risk: splitting too aggressively may create indirection without reducing failure modes; the public `PlaywrightEndpointClient.execute()` behavior and existing exports must remain stable during any no-behavior-change refactor.
  - Suggested next action: first draft a responsibility boundary map, then split only the highest-duplication / highest-risk seams after PBT and unit invariants are in place.

### P — Put to another use

- Candidate P1: Reuse the endpoint strategy/lifecycle contract for endpoint authoring diagnostics.
  - Evidence source: endpoint execution mode is currently inferred from field combinations such as `buildPayload` plus `apiUrl`, while endpoint specs also rely on related fields like `urlPattern`, `trigger`, `requiredTrigger`, `normalize`, `isSuccess`, and `errorMapper`.
  - Expected value: improves reliability by catching invalid or ambiguous endpoint specs before live Playwright execution; supports architecture convergence by making endpoint authoring rules explicit; improves maintainability for future endpoint additions.
  - Risk: strict validation could break existing specs if introduced as hard errors too early; diagnostics should start as warnings or test helpers before becoming runtime enforcement.
  - Suggested next action: define `validateEndpointSpec(spec)` as a planning candidate with warning-first rules for ambiguous transport, missing `urlPattern`, missing payload dependencies, or incomplete trigger/error mapping combinations.

- Candidate P2: Reuse the same endpoint strategy/lifecycle contract for lightweight fixture/live parity checks.
  - Evidence source: fixture execution currently normalizes fixture data through `FixtureEndpointClient`/`mockRunEndpoint`, while live execution goes through navigation, collector, trigger, route, payload merge, and response parsing semantics.
  - Expected value: improves reliability by exposing fixture/live semantic gaps without making fixture mode simulate a browser; helps ensure endpoint fixtures match the strategy and response shape expected by live execution.
  - Risk: fixture mode must remain lightweight; parity checks should validate declarations and fixture shape rather than reproducing Playwright transport behavior.
  - Suggested next action: define a small static parity checklist tied to endpoint strategy and fixture response shape.

### E — Eliminate

- Candidate E1: Eliminate runtime-only endpoint spec failures through warning-first endpoint spec diagnostics.
  - Evidence source: endpoint execution currently discovers many spec-shape mistakes only during live Playwright execution, including ambiguous transport field combinations, missing or mismatched `urlPattern`, incomplete `buildPayload`/`apiUrl` combinations, `requiredTrigger` without a usable trigger, and unclear `isSuccess`/`errorMapper` combinations.
  - Expected value: improves reliability by shifting endpoint authoring failures from runtime to test/diagnostic time; supports architecture convergence by making endpoint spec rules explicit; improves maintainability by giving future endpoints a shared validation path.
  - Risk: strict runtime enforcement could break existing endpoint specs; introduce diagnostics as warnings or test helpers first, then only promote stable rules to enforcement after affected specs are audited.
  - Suggested next action: define a warning-first `validateEndpointSpec(spec)` candidate and run it against existing endpoint specs to classify ambiguous rules before changing execution behavior.

- Candidate E2: Gradually eliminate implicit strategy inference after diagnostics expose ambiguous endpoint specs.
  - Evidence source: fetch execution is currently inferred from `typeof meta.buildPayload === 'function' && meta.apiUrl`, while legacy execution is the fallback; this hides transport semantics inside `PlaywrightEndpointClient` rather than endpoint declarations.
  - Expected value: improves reliability by making endpoint transport semantics explicit; supports architecture convergence with S1; reduces accidental endpoint misconfiguration.
  - Risk: requiring explicit strategy immediately would be a contract change and may require OpenSpec if it changes endpoint authoring requirements.
  - Suggested next action: keep compatibility inference initially, but have diagnostics recommend explicit strategy declarations for newly touched or ambiguous endpoints.

- Candidate E3: Eliminate duplicated lifecycle code only after diagnostics and refactor invariants are in place.
  - Evidence source: `_attemptFetch()` and `_attemptLegacy()` duplicate navigation, collector, readyEl, trigger, timeout, and error wrapping behavior.
  - Expected value: improves maintainability by reducing duplicated lifecycle edits; supports C1 and M1.
  - Risk: lifecycle extraction touches live execution behavior and must be protected by PBT/focused unit tests for nav resolution, retries, abort, collector behavior, and route cleanup.
  - Suggested next action: sequence this behind E1 and A2 rather than making it the first implementation task.

### R — Reverse / Rearrange

- Candidate R1: Rearrange endpoint execution so validation and strategy resolution happen before cooldown, limiter acquisition, and retry execution.
  - Evidence source: `PlaywrightEndpointClient.execute()` currently checks cooldown and acquires the limiter before `_executeWithRetry()` resolves `nav.url` and before the implementation-specific fetch/legacy path is selected; endpoint spec-shape failures can therefore surface late in live execution.
  - Expected value: improves reliability and CLI UX by surfacing usage/spec-shape problems before network-like runtime work; supports architecture convergence by making execution order explicit: validate spec, resolve strategy, plan attempt, then apply shared cooldown/limiter/retry policies.
  - Risk: moving validation or strategy resolution earlier must preserve current invariants, especially one-time `nav.url` evaluation, retry attempt accounting, abort behavior, and existing error-code mapping.
  - Suggested next action: define a non-breaking execution-order plan where diagnostics start warning-first and strategy resolution initially remains compatible with legacy inference.

- Candidate R2: Keep retry and cooldown outside endpoint strategy lifecycle.
  - Evidence source: retry/cooldown behavior is currently shared in `PlaywrightEndpointClient.execute()` and `_executeWithRetry()`, while fetch/legacy differences live inside attempt execution.
  - Expected value: prevents strategy-specific duplication of retry/rate-limit policy; keeps strategy focused on a single attempt's transport semantics; supports future strategies without multiplying retry/cooldown implementations.
  - Risk: some future endpoint strategies may need custom retry behavior; exceptions should be explicit policy overrides rather than moving all retry/cooldown concerns inside strategies.
  - Suggested next action: document the boundary as `strategy = single-attempt transport semantics`, `client = shared policies such as cooldown, limiter, retry, parse/classify/normalize orchestration`.

## Follow-up Task Order

This SCAMPER planning task is the parent for four independently verifiable follow-up tasks. The order is risk-first rather than SCAMPER-letter order:

1. `07-07-endpoint-spec-diagnostics` — warning-first endpoint spec diagnostics; addresses E1 and P1.
2. `07-07-endpoint-refactor-invariants` — endpoint PBT/unit invariant safety net; addresses A2 and prepares S1/C1/M1/R1.
3. `07-07-endpoint-strategy-resolver` — compatible endpoint strategy resolver and execution-order clarification; addresses S1, E2, R1, and R2.
4. `07-07-endpoint-attempt-lifecycle-extraction` — shared lifecycle extraction after diagnostics, invariants, and resolver planning; addresses C1, M1, E3, and A1.

Execution principle: diagnose first, freeze behavior second, make strategy explicit third, and only then refactor lifecycle code.

## Acceptance Criteria

- [x] A SCAMPER-based optimization map is produced with candidates classified by lens.
- [x] Each candidate includes evidence source, expected value, risk, and suggested next action.
- [x] The session identifies what is explicitly out of scope for this optimization pass.
- [x] If implementation is proposed, follow-up work is split into independently verifiable Trellis tasks or an OpenSpec proposal where required.
- [ ] Any resolved domain terminology or hard-to-reverse decision is documented in the appropriate glossary/ADR artifact only when it meets the documentation threshold.

## Open Questions

- No blocking open question remains for the first SCAMPER pass. The first concrete follow-up task is `07-07-endpoint-spec-diagnostics`.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
