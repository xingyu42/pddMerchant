# Observability logging redaction diagnostics and invariants

## Goal

Freeze the observable contracts for observability, logging, redaction, raw-debug, and JSON/stdout purity before any runtime logging or telemetry change.

User value: future diagnostics can become more useful without leaking cookies, Anti-Content, authorization, QR content, credentials, mobile/phone, receiver/address, goods images, encrypted credential data, raw platform payloads, or breaking machine-readable `--json` consumers.

## Parent / Dependency

Parent planning task: `07-08-observability-logging-redaction-scamper-planning`.

This child depends on the parent SCAMPER decision:

- first slice must be diagnostics/invariants first;
- no runtime behavior change unless tests reveal a real defect;
- OpenSpec proposal is required before changing public observability behavior, envelope/error shape, raw-debug schema, stdout/stderr behavior, log destination semantics, redaction semantics, or security-sensitive fields.

## Confirmed Facts

- `src/infra/logger.js:4` defines the shared sensitive key list.
- `src/infra/logger.js:57` fingerprints sensitive values as `fp:<8-hex>`.
- `src/infra/logger.js:77` recursively redacts objects.
- `src/infra/logger.js:83` and `src/infra/logger.js:91` handle Map and Set.
- `src/infra/logger.js:101` handles Error objects.
- `src/infra/logger.js:143` defines `logger.withOp(ctx)`.
- `src/infra/logger.js:149` binds `mall_id_hash` instead of raw `mall_id`.
- `src/infra/output.js:41` recursively strips exact `raw` keys from envelope surfaces.
- `src/infra/output.js:70` enables raw debug only when `PDD_DEBUG_RAW === '1'`.
- `src/infra/output.js:124` redacts raw-debug values before serialization.
- `src/infra/output.js:131` writes `raw_debug` JSONL to stderr.
- `src/infra/output.js:260` is the public `emit()` entry.
- `src/infra/output.js:270` redacts JSON-mode data/error before stdout.
- `src/infra/output.js:345` redacts batch-renderer account envelopes.
- `src/infra/errors.js:181` converts errors to envelopes.
- `src/infra/errors.js:190` redacts `PddCliError.detail`.
- Existing coverage includes logger redaction PBT (`test/pbt/logger-redaction.pbt.test.js:6`), raw strip PBT (`test/pbt/raw-strip.pbt.test.js:113`), raw debug PBT (`test/pbt/raw-debug.pbt.test.js:52`), render redaction PBT (`test/pbt/render-redaction.pbt.test.js:48`), raw debug e2e (`test/e2e/raw-debug.e2e.test.js:24`), stdout one-line behavior (`test/error-envelope.unit.test.js:62`), and error detail redaction (`test/error-envelope.unit.test.js:8`).
- `openspec/specs/observability-logging/spec.md:40` requires operation context with `mall_id_hash` and no raw mall id.
- `openspec/specs/cli-envelope/spec.md:73` requires `PDD_DEBUG_RAW=1` redacted stderr JSONL without changing stdout or exit semantics.

## Requirements

- R1: Run baseline targeted tests before edits and record failures if any.
- R2: Identify missing invariant coverage for sensitive aliases, operation context, stdout/stderr purity, raw-debug, raw stripping, human rendering, batch rendering, and error detail.
- R3: Add or tighten tests only where coverage is missing or where current tests do not protect a public contract.
- R4: Keep assertions focused on observable contracts: no secret sentinel leakage, fingerprint markers, destination separation, raw-key stripping, and structured operation fields.
- R5: Do not assert exact log prose or implementation-private helper order.
- R6: Keep runtime behavior unchanged unless a failing test proves an actual contract bug.
- R7: If runtime change is needed, stop and classify it as either a bug fix or OpenSpec-sensitive behavior change before editing runtime code.
- R8: Use fixture/unit/PBT/subprocess seams only; no real account credentials, auth-state files from `data/`, QR login, or live merchant network.

## Acceptance Criteria

- [x] Baseline targeted tests are run and results are recorded.
- [x] Coverage gap analysis is completed against the parent contract matrix.
- [x] Any added tests fail for a real missing invariant before the fix, or are clearly documented as coverage-only reinforcement.
- [x] `logger.withOp()` operation context is covered enough to prove raw `mall_id` is not emitted and `mall_id_hash` is used.
- [x] JSON mode remains one stdout JSON line; diagnostics/raw-debug stay on stderr or configured file destinations.
- [x] Sensitive sentinel values do not appear in stdout, stderr debug events, human rendering, batch rendering, or error details.
- [x] Raw platform payloads do not appear under public envelope `data`/`error` as exact `raw` keys; decoys such as `rawValue` and `raw_url` remain unaffected.
- [x] Targeted tests and `npm run lint` pass before finishing.
- [x] No OpenSpec-sensitive runtime behavior is changed without a proposal.

## Out Of Scope

- New telemetry features or public observability schema.
- Envelope top-level shape changes.
- Exit-code semantics changes.
- Redaction fingerprint format changes.
- Logging to stdout.
- Real PDD network, real credentials, QR content, or auth state under `data/`.
- Broad refactor of logger/output/errors before diagnostics prove the seam.

## Implementation Results

- Baseline PBT before edits: `npx vitest run test/pbt/logger-redaction.pbt.test.js test/pbt/raw-strip.pbt.test.js test/pbt/raw-debug.pbt.test.js test/pbt/render-redaction.pbt.test.js` passed: 4 files, 29 tests.
- Baseline envelope/error/raw-debug before edits: `npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/e2e/raw-debug.e2e.test.js` passed: 3 files, 14 tests.
- Coverage gap found: existing tests did not directly assert `logger.withOp()` operation context serializes `mall_id_hash` while omitting raw `mall_id`.
- Added one coverage-only invariant in `test/pbt/logger-redaction.pbt.test.js`; current implementation already passed, so no runtime code changed.
- Post-edit logger PBT passed: 1 file, 6 tests.
- Full PBT target passed: 4 files, 30 tests.
- Envelope/error/raw-debug target passed: 3 files, 14 tests.
- `npm run lint` passed; script currently prints `no-lint`.
## Open Questions

None blocking. Ready for review before `task.py start`.

