# Design: Observability logging redaction diagnostics and invariants

## Direction

This child task implements the first slice selected by the parent SCAMPER planning task: diagnostics and executable invariants before behavior changes.

The expected outcome is mostly tests. Runtime code should change only if a test exposes a real leak or mismatch against existing Trellis/OpenSpec contracts.

## Contract Surfaces

1. Logger redaction
   - Owner: `src/infra/logger.js`
   - Contract: sensitive values become `fp:<8-hex>`; raw sentinels do not survive serialized output.
2. Logger operation context
   - Owner: `logger.withOp(ctx)`
   - Contract: command/endpoint/correlation context is structured; raw `mall_id` is not emitted; `mall_id_hash` is emitted.
3. JSON envelope output
   - Owner: `src/infra/output.js`
   - Contract: `--json` stdout is exactly one JSON envelope line; data/error are redacted.
4. Raw stripping
   - Owner: `buildEnvelope()` and `buildBatchEnvelope()`
   - Contract: exact `raw` keys are removed from public data/error surfaces; decoy names survive.
5. Raw debug
   - Owner: `PDD_DEBUG_RAW` path in `src/infra/output.js`
   - Contract: redacted/capped JSONL to stderr only; stdout unchanged.
6. Human and batch display
   - Owner: output renderers
   - Contract: renderers receive redacted display copies.
7. Error detail
   - Owner: `src/infra/errors.js`
   - Contract: `PddCliError.detail` is redacted; unknown errors do not expose private detail on stdout.

## Test Strategy

Run existing focused tests first. Then add the smallest missing invariant.

Likely high-value gap: `logger.withOp()` operation context because specs require `mall_id_hash`, and current test evidence mostly covers redaction/raw/debug/rendering.

Preferred test shape:

- use a local writable temp log destination or captured stream;
- create a logger with `withOp({ command, endpoint, correlation_id, mall_id })`;
- emit a simple log containing an additional sensitive key sentinel;
- parse the log JSON;
- assert:
  - `mall_id_hash` starts with `fp:`;
  - raw mall id string is absent from serialized log;
  - command/endpoint/correlation id survive;
  - sensitive sentinel is fingerprinted;
  - stdout remains untouched if relevant.

## Compatibility

No intended runtime behavior change.

If runtime behavior changes are needed, apply the smallest fix in the owning layer and rerun broader checks.

## OpenSpec Boundary

No proposal is needed for diagnostics-only tests or bug fixes that restore existing contracts.

Create/update OpenSpec before changing:

- public envelope/error schemas;
- raw-debug event shape, destination, truncation, or redaction semantics;
- redaction fingerprint format or sensitive-field semantics;
- log destination rules;
- new user-visible observability/telemetry behavior;
- security-sensitive account/auth/mall/credential fields.

## Rollback

If test additions become too broad, rollback to the smallest operation-context invariant and existing PBT/e2e baseline. Do not weaken existing redaction, raw-strip, raw-debug, render, or envelope tests.
