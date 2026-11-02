# Cross-cutting fixture live parity optimization

## Goal

Improve the contract between fixture mode and live mode across `pdd-cli`, so offline tests remain fast while still catching behavior drift that would otherwise appear only during real Playwright execution.

In plain terms: keep fixture tests lightweight, but make them harder to accidentally lie about real runtime behavior.

## Background

The previous endpoint execution optimization chain is complete:

- `endpoint-spec-diagnostics` added warning-first endpoint spec validation.
- `endpoint-refactor-invariants` froze endpoint execution invariants before refactoring.
- `endpoint-strategy-resolver` made fetch vs legacy endpoint strategy resolution explicit and compatible.
- `endpoint-attempt-lifecycle-extraction` extracted shared endpoint attempt lifecycle while preserving behavior.

The next cross-cutting risk is fixture/live drift:

- `src/adapter/run-endpoint.js` short-circuits fixture mode directly to `mockRunEndpoint(spec, params, ctx)`.
- `src/adapter/fixtures/endpoint.js` also provides `FixtureEndpointClient.execute()`, which applies `spec.normalize()` and returns `{ data, meta }`.
- `src/commands/runner/fixture-runtime.js` builds `ctx.client = new FixtureEndpointClient()` and `page = null` for fixture command execution.
- `openspec/specs/endpoint-transport/spec.md` currently says `runEndpoint()` fixture mode bypasses the client and returns `mockRunEndpoint()` directly, while `FixtureEndpointClient` is for tests that call the client seam.
- `.trellis/spec/adapter/fixture-mode.md` requires fixture responses to preserve normalized output and envelope semantics.

This means the repo intentionally has two fixture-facing paths:

1. Service-facing `runEndpoint()` fixture short-circuit.
2. Test-helper / ctx client `FixtureEndpointClient.execute()`.

The planning target is not to remove that difference blindly. The target is to make the difference explicit, tested, and safe.

## Decision

First implementation slice: diagnostics-first.

This means the first slice will add fixture/live parity diagnostics and contract tests without changing runtime behavior. It will not route `runEndpoint()` fixture mode through `FixtureEndpointClient`, and it will not change normalization behavior in this task unless diagnostics reveal a defect that is separately documented and approved.

## Requirements

- R1: Document the current fixture/live data flow from CLI runner to service, `runEndpoint()`, endpoint client, fixture dispatcher, normalizer, and envelope finalizer.
- R2: Identify parity-sensitive contracts that must stay aligned between fixture and live mode:
  - normalized command data shape;
  - envelope top-level shape `{ ok, command, data, error, meta }`;
  - `PddCliError` code / exit-code mapping;
  - endpoint name to fixture file naming;
  - pagination fixture behavior through `fixtureListKey`;
  - ctx field availability in fixture vs live mode;
  - endpoint diagnostics / strategy resolution coverage.
- R3: Keep fixture mode lightweight:
  - no browser launch;
  - no real auth state read;
  - no platform backend call;
  - no rate limiter token acquisition.
- R4: Add warning-first diagnostics and contract tests before any runtime behavior change.
- R5: Do not change the public envelope contract or CLI output shape.
- R6: Do not require live Playwright calls for normal unit/e2e verification.
- R7: If the final plan changes endpoint authoring requirements or runtime fixture semantics, create/update an OpenSpec change before implementation.
- R8: Split implementation into independently verifiable slices if the inspected scope grows beyond one small refactor.

## Out of Scope

- Replacing fixture mode with real browser mocks.
- Simulating Anti-Content, cookies, route interception, or Playwright navigation in fixture mode.
- Changing PDD platform endpoint behavior.
- Changing `runEndpoint()` service signatures.
- Changing top-level envelope shape.
- Introducing new npm dependencies.
- Committing changes without explicit user authorization.

## Acceptance Criteria

- [x] Planning records an evidence-backed fixture/live data-flow map with concrete file anchors.
- [x] Planning names which fixture/live differences are intentional and which are drift risks.
- [x] Planning decides whether the first implementation slice is diagnostics-only, tests-only, or a small compatibility refactor.
- [x] For the chosen first slice, `design.md` describes boundaries, compatibility, risks, and rollback.
- [x] For the chosen first slice, `implement.md` lists ordered steps and validation commands.
- [x] No implementation starts until the planning artifacts are reviewed and the task is explicitly started.

## Implementation Findings

The first diagnostics-only implementation keeps runtime behavior unchanged and makes these fixture/live differences explicit:

- Intentional: `runEndpoint()` fixture mode still short-circuits directly to `mockRunEndpoint()` and does not acquire limiter tokens.
- Intentional: `FixtureEndpointClient.execute()` remains a separate client-contract seam for direct tests and applies `spec.normalize()`.
- Drift warning: `goods.adStrategy` and `promo.hourlyReport` currently have endpoint specs but no base `test/fixtures/endpoints/<name>.json`.
- Drift warning: service-facing normalized endpoint fixtures such as `orders.list` are not always accepted by the live `isSuccess` raw-response contract, so `FixtureEndpointClient` can produce different data than the direct `runEndpoint()` fixture short-circuit.
- Drift warning: `goods.list` has page-specific fixture coverage but no `fixtureListKey`; page 2 is covered by a checked-in fixture, while page >= 3 synthesis would still need an explicit list key.
