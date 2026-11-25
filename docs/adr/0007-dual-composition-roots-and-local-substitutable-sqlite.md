# ADR 0007: Dual Composition Roots and Local-Substitutable SQLite Seam

## Status

Accepted — 2026-11-25

## Context

`pdd-cli` serves two distinct runtime lifecycles: short-lived single/batch CLI commands (`pdd <domain> <cmd>`) and an explicitly started resident daemon/console process (`pdd daemon run`). Previously, adapter factories read environment flags globally (`isMockEnabled()`), held module-level singletons, and mixed browser/network concerns with local SQLite state. When replacing mocks with explicit dependency injection, two irreversible boundary questions arose: whether to share a single runtime container across CLI and daemon, and whether to wrap local SQLite storage behind domain repository ports.

## Decision

- **Two dedicated composition roots**: Separate `composeCommandRuntime` (short-lived CLI commands) and `composeDaemonRuntime` (resident console/patrol daemon), backed by explicit whitelisted environment parsing (`parseRuntimeEnv`), injected clocks, output sinks, and process cleanup hooks. Neither root reintroduces module-level fixture flags or shared global test singletons.
- **Ports only on true multi-adapter external boundaries**: Define explicit runtime ports only where at least two concrete implementations exist (Live Patchright/HTTP/process vs. Fixture or InMemory): BrowserRuntime, Mall, Auth, EndpointTransport, GoodsPublish (`SourceProductFetcher` + `CategoryResolver` + `MerchantDraftEditor`), ConsoleLoginDriver, and DaemonProcess.
- **SQLite remains a local-substitutable internal seam**: Direct SQLite stores (`account-store`, `goods-cost-store`, `daemon-state`, `leases`) stay concrete infrastructure modules backed by per-process or per-test temporary database paths (`PDD_DB_PATH`) instead of introducing single-implementation repository port wrappers.

## Considered Options

- **Unified monolithic runtime container**: Rejected because short-lived CLI commands never require console HTTP routes/SSE/takeover sessions, while daemon processes require distinct signal ownership, logging destinations, and fatal browser cleanup registration.
- **Full hexagonal repository ports over SQLite**: Rejected because SQLite is local, synchronous, atomic, and fast to isolate via temporary database files; wrapping every SQL query in a single-implementation port adds shallow boilerplate without unlocking a second storage engine.

## Consequences

- Tests run cleanly without process-wide `PDD_TEST_*` leakage or cross-layer `vi.mock`, substituting ports directly via runtime `overrides` and isolating SQLite via temporary `PDD_DB_PATH`.
- New external boundaries with two real implementations follow the composition-root port pattern; new SQLite tables or stores remain direct infra helpers unless a second storage backend is actually introduced.
