# Design: Observability logging redaction SCAMPER planning

## Design Direction

This planning task does not change runtime behavior. It selects a cross-cutting surface and defines a safe first implementation slice.

Recommended sequence:

```text
SCAMPER planning
  -> diagnostics / invariants
  -> leak or drift decision
  -> optional compatible cleanup
  -> optional extraction or new observability fields only after OpenSpec check
```

## Boundary Model

The observability/logging/redaction surface spans five owners:

1. `src/infra/logger.js`
   - sensitive key vocabulary;
   - recursive redaction and fingerprinting;
   - pino serializer/formatter behavior;
   - `withOp()` structured context and `mall_id_hash`.
2. `src/infra/output.js`
   - envelope building and raw stripping;
   - JSON stdout writing;
   - human rendering and batch rendering redaction;
   - `PDD_DEBUG_RAW` stderr JSONL channel.
3. `src/infra/errors.js`
   - `PddCliError` mapping;
   - `detail` redaction;
   - exit-code metadata.
4. `src/commands/runner/**`
   - command lifecycle finalization;
   - account/mall/correlation metadata projected into envelopes;
   - operation logs created through logger context.
5. OpenSpec/Trellis contracts
   - `.trellis/spec/infra/logging-redaction.md`;
   - `.trellis/spec/infra/envelope-errors-output.md`;
   - `openspec/specs/observability-logging/spec.md`;
   - `openspec/specs/cli-envelope/spec.md`.

## Recommended First Slice Contract Matrix

| Surface | Expected observable contract | Suggested tests |
| --- | --- | --- |
| Logger redaction | Sensitive key values become `fp:<8-hex>` and raw sentinels do not survive serialization | extend `test/pbt/logger-redaction.pbt.test.js` only if aliases are missing |
| Logger operation context | `withOp({ mall_id })` emits `mall_id_hash`, never raw `mall_id`; command/correlation fields stay structured | focused unit test around logger child bindings or captured pino output |
| JSON envelope | `emit(..., { json: true })` writes one stdout JSON line and redacts data/error | `test/envelope.test.js`, `test/error-envelope.unit.test.js`, or new focused unit |
| Raw stripping | Exact `raw` keys are removed from public data/error; decoys like `rawValue` and `raw_url` survive | existing `test/pbt/raw-strip.pbt.test.js` plus gap-only additions |
| Raw debug | `PDD_DEBUG_RAW=1` emits redacted/capped JSONL on stderr only and leaves stdout byte-identical | existing `test/pbt/raw-debug.pbt.test.js` and `test/e2e/raw-debug.e2e.test.js` |
| Human display | default table, custom renderer, renderError, and batchRenderer receive/display redacted copies | existing `test/pbt/render-redaction.pbt.test.js` |
| Error detail | `PddCliError.detail` is redacted and unknown errors do not leak stack/details to stdout | `test/error-envelope.unit.test.js` |

## OpenSpec Decision

Planning-only and diagnostics-only tasks do not require a new OpenSpec proposal.

A proposal is required before any of the following:

- adding a new user-visible telemetry or observability capability;
- changing envelope top-level shape, error shape, exit-code semantics, or stdout/stderr behavior;
- changing `PDD_DEBUG_RAW` event schema, destination, truncation behavior, or redaction behavior;
- changing redaction hash/fingerprint format or sensitive-field semantics;
- changing log destination rules such as allowing stdout/console destinations;
- adding security-sensitive account/auth/mall/credential fields to logs or envelopes.

## Drift Candidates To Decide Later

- Sensitive field vocabulary appears in code, Trellis specs, and OpenSpec. The first implementation slice should identify missing aliases or stale documentation but should not silently choose a new source of truth.
- `openspec/specs/observability-logging/spec.md` requires richer `EndpointClient.execute` context fields than `logger.withOp()` alone binds today. Diagnostics should distinguish “existing runtime requirement already met elsewhere” from “spec stronger than implementation”.
- Existing raw-debug and redaction tests are strong. The likely value is not broad new behavior, but gap-finding for newly frozen auth/account/mall context fields and operation context.

## Risk Controls

- Keep tests fixture/unit/PBT/subprocess-based; do not use real credentials or live merchant network.
- Assert absence of secret sentinel values and presence of fingerprints instead of exact hashes where possible.
- Assert structured field names and destinations, not log prose.
- Do not loosen JSON purity to improve human diagnostics.
- Stop and create/update OpenSpec if runtime behavior, public schemas, security semantics, or logging destinations need to change.
