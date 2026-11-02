# Observability logging redaction SCAMPER planning

## Goal

Use SCAMPER to choose and plan the next cross-cutting optimization surface after endpoint execution, fixture/live parity, command runtime, and auth/account/mall lifecycle work. The selected surface is observability, logging, redaction, raw-debug, and JSON/stdout purity.

User value: future debugging and diagnostics can become more useful without leaking cookies, Anti-Content, authorization, QR content, credentials, mobile/phone, receiver/address, image, encrypted credential data, raw platform payloads, or breaking machine-readable `--json` envelopes.

## Background

- Previous cross-cutting lines are complete through auth/account/mall lifecycle diagnostics and invariants; the current Trellis context at creation on 2026-07-08 had a clean git working tree and this task in `planning` status.
- `src/infra/logger.js:4` defines the shared sensitive key list, including cookies, auth token/session fields, Anti-Content variants, authorization, goods image, phone/mobile, receiver/address, password, credential, encrypted credential, and QR content variants.
- `src/infra/logger.js:57` fingerprints sensitive values as `fp:<8-hex>` via SHA256, rather than printing raw values.
- `src/infra/logger.js:77` recursively redacts objects; `src/infra/logger.js:83` and `src/infra/logger.js:91` include Map and Set handling; `src/infra/logger.js:101` handles Error objects.
- `src/infra/logger.js:143` provides `logger.withOp(ctx)` for structured operation context; `src/infra/logger.js:149` binds `mall_id_hash` as a fingerprint instead of raw mall id.
- `src/infra/output.js:41` recursively strips properties named exactly `raw` at envelope boundaries.
- `src/infra/output.js:70` gates raw debug on `PDD_DEBUG_RAW === '1'`.
- `src/infra/output.js:124` serializes raw-debug values only after `redactRecursive(value)`.
- `src/infra/output.js:131` writes `raw_debug` JSONL events to stderr; `src/infra/output.js:145` returns redacted copies for account envelopes.
- `src/infra/output.js:260` is the public `emit()` entry; `src/infra/output.js:270` redacts JSON-mode envelope data/error before writing stdout; `src/infra/output.js:345` redacts batch renderer account envelopes.
- `src/infra/errors.js:181` converts thrown errors to envelopes; `src/infra/errors.js:190` redacts `PddCliError.detail`.
- `openspec/specs/observability-logging/spec.md:40` requires `logger.withOp(...)` operation context including `mall_id_hash`, attempt/status/limiter/cooldown/correlation metadata, and no raw mall id.
- `openspec/specs/cli-envelope/spec.md:73` requires `PDD_DEBUG_RAW=1` to emit redacted, size-limited JSONL to stderr only without changing stdout or exit semantics.
- Existing tests already cover key parts of this contract: logger redaction PBT (`test/pbt/logger-redaction.pbt.test.js:6`), raw strip PBT (`test/pbt/raw-strip.pbt.test.js:113`), raw debug PBT (`test/pbt/raw-debug.pbt.test.js:52`), render redaction PBT (`test/pbt/render-redaction.pbt.test.js:48`), raw debug e2e (`test/e2e/raw-debug.e2e.test.js:24`), stdout one-line behavior (`test/error-envelope.unit.test.js:62`), and error detail redaction (`test/error-envelope.unit.test.js:8`).
- OpenSpec validation scope is available: `openspec list --specs` reports existing `observability-logging` and `cli-envelope` specs; active changes listed as complete at planning time.

## Requirements

- R1: Use SCAMPER lenses to map observability/logging/redaction optimization candidates before implementation.
- R2: Prefer diagnostics and executable invariants as the first implementation slice; do not start by changing runtime logging or redaction behavior.
- R3: Preserve envelope top-level shape `{ ok, command, data, error, meta }` and `--json` stdout as exactly one JSON line.
- R4: Preserve stderr/file-only diagnostics: pino logs, raw-debug events, human error hints, and debug output must not pollute JSON stdout.
- R5: Preserve recursive redaction and fingerprint semantics for sensitive fields across logger, envelope output, human rendering, batch rendering, raw debug, and `PddCliError.detail`.
- R6: Treat new observability fields, changed redaction behavior, changed raw-debug format, changed envelope/error shape, or changed logging destinations as OpenSpec-sensitive before runtime implementation.
- R7: Avoid tests that require real merchant credentials, real auth state, or live PDD network; use unit/PBT/e2e fixture or subprocess seams.
- R8: Use current tests as a drift detector; only add or tighten invariants where coverage is missing or recently frozen auth/account/mall context fields could introduce leak risk.

## SCAMPER Map

### Substitute

- Candidate S1: Substitute implicit sensitive-field assumptions with an executable redaction matrix.
  - Evidence: `REDACT_KEYS` exists in code, while Trellis/OpenSpec specs also name sensitive families; future additions can drift.
  - Expected value: new auth/account/mall/log fields are checked against one observable matrix.
  - Risk: over-testing private implementation details if assertions only mirror `REDACT_KEYS` internals.
  - Suggested first action: test public surfaces with representative sensitive aliases, not only the constant itself.

### Combine

- Candidate C1: Combine logger redaction, output redaction, error envelope redaction, human rendering, batch rendering, and raw-debug assertions under one shared vocabulary.
  - Evidence: all public output surfaces currently call `redactRecursive()` at different boundaries.
  - Expected value: catches leaks when one path is updated and another path is forgotten.
  - Risk: a single giant test file can become hard to diagnose.
  - Suggested first action: create/extend focused invariant tests grouped by surface.

### Adapt

- Candidate A1: Adapt the previous successful sequence: diagnostics -> invariants -> compatible cleanup -> optional extraction.
  - Evidence: endpoint, runner, and auth/account/mall work stayed safe by freezing behavior before refactor.
  - Expected value: minimizes security and JSON-contract risk.
  - Risk: first task may look like “only tests” even when no runtime defect is found.
  - Suggested first action: coverage-only diagnostics first.

### Modify / Magnify / Minify

- Candidate M1: Magnify stdout/stderr and raw-debug boundary tests before changing logging detail.
  - Evidence: `--json` purity and `PDD_DEBUG_RAW=1` are explicit OpenSpec contracts.
  - Expected value: protects machine consumers and prevents accidental secret leakage.
  - Risk: subprocess/e2e tests can be slower than unit tests.
  - Suggested first action: keep the first slice targeted to the smallest unit/PBT/subprocess commands.

### Put to another use

- Candidate P1: Use redaction tests as a drift detector for auth/account/mall lifecycle fields now that those boundaries are frozen.
  - Evidence: `logger.withOp()` can bind command/correlation/mall context, and recent auth/account/mall work clarified account/mall metadata expectations.
  - Expected value: future observability additions become safer.
  - Risk: logging assertions can over-constrain message wording.
  - Suggested first action: assert structured fields and absence of raw secrets, not exact log message prose.

### Eliminate

- Candidate E1: Eliminate duplicated or stale sensitive-field vocabulary where possible.
  - Evidence: code, Trellis specs, and OpenSpec all describe overlapping sensitive fields.
  - Expected value: lower chance of missing a new alias.
  - Risk: changing the source of truth or key list could be a behavior change.
  - Suggested first action: diagnostics first; only consolidate after tests prove compatibility and OpenSpec impact is checked.

### Reverse / Rearrange

- Candidate R1: Rearrange implementation order so observability/logging comes after auth/account/mall invariants.
  - Evidence: the previous task froze account/auth/mall lifecycle behavior first, reducing uncertainty in context fields.
  - Expected value: logging can add or verify operation context with less risk of selecting the wrong identifiers.
  - Risk: delayed logging improvements.
  - Suggested first action: start with observability diagnostics now; postpone runtime additions until invariants pass.

## Recommended First Implementation Slice

**Observability logging redaction diagnostics and invariants**.

Scope:

- Add or tighten contract coverage for representative sensitive aliases across:
  - `redactRecursive()` / logger serialization;
  - `emit(..., { json: true })` envelope output;
  - human renderer and batch renderer display copies;
  - `PDD_DEBUG_RAW=1` stderr JSONL;
  - `errorToEnvelope()` / `PddCliError.detail`;
  - `logger.withOp()` operation context, especially `mall_id_hash` instead of raw mall id.
- Confirm stdout remains exactly one JSON line in JSON mode and raw debug only goes to stderr.
- Confirm raw platform payloads do not appear in public envelope data/error, while `rawValue` and `raw_url` decoys remain unaffected.
- Keep the task coverage-only unless a real leak or contract mismatch is found.

Do not start with:

- Adding new telemetry schemas or log event formats.
- Changing the redaction fingerprint format.
- Changing envelope top-level fields or exit-code semantics.
- Sending logs to stdout.
- Real browser/network/credential tests.
- Refactoring logger/output/error modules before invariants are stable.

## Acceptance Criteria

- [x] The recommended next cross-cutting surface is selected: observability/logging/redaction/raw-debug/stdout purity.
- [x] SCAMPER candidates are mapped with evidence, expected value, risk, and suggested action.
- [x] The first implementation slice is diagnostics/invariants first, not behavior change.
- [x] OpenSpec proposal trigger is documented for future observability, envelope, raw-debug, destination, or security-sensitive behavior changes.
- [x] Existing coverage and likely gaps are recorded with file/line evidence.
- [x] No blocking repository-answerable question remains.

## Out Of Scope

- Runtime implementation in this planning task.
- New public telemetry/observability capability.
- Envelope schema changes.
- Redaction hash/fingerprint format changes.
- Real merchant backend, real account credentials, QR login, or auth-state files under `data/`.
- Secret-bearing debug dumps or unredacted raw platform payloads.

## Open Questions

None blocking. The recommended next gate is user approval to create/start the first implementation task: `Observability logging redaction diagnostics and invariants`.
