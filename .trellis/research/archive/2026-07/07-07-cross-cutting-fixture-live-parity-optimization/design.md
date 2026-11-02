# Design: Cross-cutting fixture live parity optimization

## Context

Fixture mode is a deliberate test seam, not a full browser simulation. The current code keeps fixture tests fast by bypassing browser, auth, backend, limiter, and Playwright endpoint lifecycle. That is good and should stay.

The risk is that fixture mode may pass tests while live mode would fail due to differences in normalization, error mapping, endpoint strategy assumptions, or command context shape.

## Data Flow Map

### Live mode

```text
bin/pdd.js
  -> command registrar
  -> withCommand()
  -> live runner context with page/context/pageSession
  -> service
  -> runEndpoint(page, spec, params, ctx)
  -> getSharedClient().execute(spec, params, {...ctx, page})
  -> PlaywrightEndpointClient
  -> resolveEndpointStrategy()
  -> executeAttempt()
  -> parse/classify/map/normalize
  -> service result
  -> envelope finalizer
```

### Fixture mode

```text
bin/pdd.js
  -> command registrar
  -> withCommand()
  -> executeFixture()
  -> buildCommandCtx({ client: FixtureEndpointClient, page: null, mallCtx: mock })
  -> service
  -> runEndpoint(null, spec, params, ctx)
  -> mockRunEndpoint(spec, params, ctx)
  -> service result
  -> envelope finalizer
```

### Fixture client seam

```text
test helper / ctx.client user
  -> FixtureEndpointClient.execute(spec, params, ctx)
  -> mockRunEndpoint(spec, params)
  -> spec.normalize(raw)
  -> { data, meta }
```

## Key Existing Contracts

- `runEndpoint()` fixture mode bypasses `PlaywrightEndpointClient`, `FixtureEndpointClient`, and limiter.
- `FixtureEndpointClient.execute()` exists for tests that want the endpoint-client contract directly.
- Fixture mode must not launch browser or read real auth/platform state.
- Command envelope semantics must remain the same between fixture and live paths.
- Endpoint specs and fixture files are linked by `spec.name`.

## Chosen First Slice

The first slice is diagnostics-first: add a warning-first fixture/live parity diagnostic layer and tests, without changing runtime behavior.

Possible diagnostic checks:

- Every endpoint spec used by services has a matching base fixture unless explicitly out of scope.
- Paginated endpoint specs that rely on synthesized page end have `fixtureListKey`.
- Fixture payload can be normalized by `spec.normalize()` without throwing.
- `mockRunEndpoint()` business-error fixtures map to stable `PddCliError` codes.
- `runEndpoint()` fixture short-circuit behavior is explicitly covered so future refactors do not accidentally route through limiter/client.
- `FixtureEndpointClient.execute()` meta/data shape remains compatible with endpoint-client tests.

## Non-Goals

- Do not make fixture mode perform Playwright navigation.
- Do not force `runEndpoint()` fixture path through `FixtureEndpointClient` in the first slice.
- Do not change endpoint spec authoring rules until diagnostics show which rules are safe.
- Do not change service signatures.

## Compatibility

The first slice should be additive:

- New helper/test files are acceptable.
- Existing runtime behavior should stay unchanged.
- Any stricter rules should start as test-time warnings or targeted contract assertions.
- `runEndpoint()` fixture mode should keep its current direct `mockRunEndpoint()` short-circuit in this slice.
- `FixtureEndpointClient.execute()` should keep serving direct endpoint-client contract tests in this slice.

If later work chooses to unify fixture normalization behavior, that should be treated as a separate slice and may require an OpenSpec delta because the current endpoint-transport spec explicitly documents the direct `mockRunEndpoint()` short-circuit.

## Risks And Mitigations

- Risk: Diagnostics duplicate `validateEndpointSpec()`.
  - Mitigation: Compose with existing endpoint validation instead of reimplementing strategy checks.
- Risk: Fixture parity checks become too broad or slow.
  - Mitigation: Keep checks static or fixture-file based; avoid browser and network.
- Risk: Tests overfit current fixture quirks.
  - Mitigation: Label intentional differences separately from drift risks.
- Risk: Runtime behavior changes accidentally.
  - Mitigation: First slice should add diagnostics/tests only; run targeted endpoint and fixture tests.

## Rollback

Because the recommended first slice is additive diagnostics/tests, rollback should be simple:

- Remove the new diagnostic helper/tests.
- Leave `runEndpoint()`, `FixtureEndpointClient`, and endpoint specs untouched.
