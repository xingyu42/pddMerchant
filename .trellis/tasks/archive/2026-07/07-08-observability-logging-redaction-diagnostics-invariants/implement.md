# Implementation Plan

## Baseline

Run:

```bash
npx vitest run test/pbt/logger-redaction.pbt.test.js test/pbt/raw-strip.pbt.test.js test/pbt/raw-debug.pbt.test.js test/pbt/render-redaction.pbt.test.js
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/e2e/raw-debug.e2e.test.js
```

## Implementation Steps

1. Run baseline targeted tests.
2. Inspect current focused tests for coverage gaps.
3. Add the smallest missing invariant, likely around `logger.withOp()` operation context and raw mall id absence.
4. If adding tests exposes a runtime bug, classify it before fixing:
   - bug fix restoring existing contract: make smallest owning-layer change;
   - behavior/schema/security change: stop and create/update OpenSpec first.
5. Rerun targeted tests.
6. Run `npm run lint`.
7. Check `git diff` to confirm scope is limited to tests unless a real bug required runtime fix.

## Likely Files

Test files:

- `test/pbt/logger-redaction.pbt.test.js`
- optional new `test/observability-logging-redaction.unit.test.js`
- possibly `test/envelope.test.js` or `test/error-envelope.unit.test.js` if stdout/error gaps are found

Runtime files only if a real defect is proven:

- `src/infra/logger.js`
- `src/infra/output.js`
- `src/infra/errors.js`

## Validation Commands

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

## Stop Conditions

- Do not edit runtime logging/redaction behavior without first proving a contract mismatch.
- Do not use real credentials, auth-state files under `data/`, QR content, or live merchant network.
- Do not change public schemas or security-sensitive semantics without OpenSpec.
- Do not broaden scope into new telemetry features.
