# Implementation Plan

## Purpose

This file plans the next implementation task, not this planning task's runtime edits.

## Recommended Next Task

Title: `Observability logging redaction diagnostics and invariants`

Recommended slug: `observability-logging-redaction-diagnostics-invariants`

## Steps For That Next Task

1. Run baseline targeted tests:
   - `npx vitest run test/pbt/logger-redaction.pbt.test.js test/pbt/raw-strip.pbt.test.js test/pbt/raw-debug.pbt.test.js test/pbt/render-redaction.pbt.test.js`
   - `npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/e2e/raw-debug.e2e.test.js`
2. Inspect current coverage for gaps before editing:
   - sensitive aliases from `REDACT_KEYS` vs Trellis/OpenSpec lists;
   - `withOp()` operation context and raw mall id absence;
   - JSON stdout one-line behavior with stderr diagnostics;
   - `PDD_DEBUG_RAW=1` stderr-only behavior;
   - batch/human/error detail display redaction.
3. Add or extend diagnostics/invariant tests only where coverage is missing.
4. If tests reveal a real leak or contract mismatch, decide whether it is a bug fix or OpenSpec-sensitive behavior change before editing runtime code.
5. If only tests are added and all pass, keep the task coverage-only.
6. If runtime changes are needed, make the smallest owning-layer fix and rerun broader envelope/logger tests.

## Likely Files For Next Task

- `test/pbt/logger-redaction.pbt.test.js`
- `test/pbt/raw-strip.pbt.test.js`
- `test/pbt/raw-debug.pbt.test.js`
- `test/pbt/render-redaction.pbt.test.js`
- `test/envelope.test.js`
- `test/error-envelope.unit.test.js`
- optional new focused test file, e.g. `test/observability-logging-redaction.unit.test.js`
- only if a real defect is found:
  - `src/infra/logger.js`
  - `src/infra/output.js`
  - `src/infra/errors.js`
  - `src/commands/runner/envelope-finalizer.js`
  - `src/commands/runner/single-lifecycle.js`
  - `src/commands/runner/batch-executor.js`

## Validation Commands For Next Task

```bash
npx vitest run test/pbt/logger-redaction.pbt.test.js test/pbt/raw-strip.pbt.test.js test/pbt/raw-debug.pbt.test.js test/pbt/render-redaction.pbt.test.js
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/e2e/raw-debug.e2e.test.js
npm run lint
```

If runtime behavior changes:

```bash
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
npm test
```

## Rollback / Stop Conditions

- Stop and create/update OpenSpec before changing envelope schema, stdout/stderr behavior, raw-debug event schema, redaction semantics, fingerprint format, logging destinations, or security-sensitive context fields.
- Stop if a test requires real account credentials, QR content, auth state from `data/`, or live merchant network; replace with fixture/unit/subprocess seam.
- Stop if the task expands into new telemetry features; route that through OpenSpec before implementation.
- Stop if a proposed cleanup weakens existing PBT/e2e redaction, raw-strip, raw-debug, or JSON-purity coverage.
