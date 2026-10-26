# Design: Auth/account/mall lifecycle diagnostics and invariants

## Strategy

Coverage-first. The safest initial implementation is to extend existing unit/PBT tests around the stable seams rather than refactor runtime code.

## Target Seams

1. `resolveAccountContext()` and `accountMetaForEnvelope()`
   - Pure-ish decision point for auth path/account source/meta.
   - Existing tests cover basics; this task should add missing matrix scenarios if needed.

2. `executeSingle()` fixture path
   - Observable ctx and envelope behavior without real browser/network.
   - Useful for proving account source/meta reaches command ctx and envelope.

3. `withCommand()` batch path
   - Existing batch tests assert per-account option shaping.
   - Add only missing assertions for context pollution if needed.

4. Mall reader/writer/id tests
   - Existing mall tests are broad; avoid duplicating unless a gap is found during baseline.

## Test Design

Prefer explicit small scenarios over broad new abstractions:

- Use temp `PDD_ACCOUNT_REGISTRY_PATH` and `PDD_ACCOUNTS_DIR` where filesystem-backed registry behavior is needed.
- Use `PDD_TEST_ADAPTER=fixture` for command runner behavior.
- Use `emitResult: false` where stdout emit is not under test.
- Assert observable fields: `ctx.authPath`, `ctx.accountSlug`, `ctx.account`, envelope `meta.account`, `meta.account_source`, `ctx.mallCtx`, `ctx.mallId`, batch per-account opts.

## Stop Conditions

Stop before code edits if any red test implies:

- changing default auth path;
- changing account registry schema;
- changing auth/security behavior;
- changing mall id error code;
- changing mall probe/switch semantics;
- changing envelope fields.

Those require OpenSpec decision first.
