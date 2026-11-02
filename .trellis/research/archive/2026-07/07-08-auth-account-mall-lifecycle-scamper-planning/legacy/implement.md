# Implementation Plan

## Purpose

This file plans the next implementation task, not this planning task's runtime edits.

## Recommended Next Task

Title: `Auth account mall lifecycle diagnostics and invariants`

Recommended slug: `auth-account-mall-lifecycle-diagnostics-invariants`

## Steps For That Next Task

1. Run baseline targeted tests:
   - `npx vitest run test/pbt/account-resolver.pbt.test.js test/batch-orchestration.unit.test.js test/runner-contract.unit.test.js test/e2e/multi-account-switch.e2e.test.js`
   - `npx vitest run test/mall-switcher.unit.test.js test/mall-writer.unit.test.js test/mall-id.unit.test.js test/pbt/mall-switcher.pbt.test.js test/pbt/mall-id.pbt.test.js`
2. Add or extend diagnostics/invariant tests only where coverage is missing:
   - resolver scenario matrix for account source/authPath/meta;
   - runner ctx/envelope assertions for selected fixture/live account/mall combinations;
   - batch isolation assertions for per-account authPath, cleared mall override, and no cross-account context leakage;
   - explicit spec-drift assertions or notes if no test should enforce the drift yet.
3. If tests reveal behavior mismatch, decide whether it is a bug fix or an OpenSpec-sensitive behavior change before editing runtime code.
4. If only tests are added and all pass, keep the task coverage-only.
5. If runtime changes are needed, make the smallest owning-layer fix and run broader checks.

## Likely Files For Next Task

- `test/pbt/account-resolver.pbt.test.js`
- `test/batch-orchestration.unit.test.js`
- `test/runner-contract.unit.test.js`
- optional new focused test file, e.g. `test/auth-account-mall-lifecycle.unit.test.js`
- only if a real defect is found:
  - `src/infra/account-resolver.js`
  - `src/commands/runner/single-lifecycle.js`
  - `src/commands/runner/batch-executor.js`
  - `src/adapter/mall-reader.js`
  - `src/adapter/mall-writer.js`

## Validation Commands For Next Task

```bash
npx vitest run test/pbt/account-resolver.pbt.test.js test/batch-orchestration.unit.test.js test/runner-contract.unit.test.js test/e2e/multi-account-switch.e2e.test.js
npx vitest run test/mall-switcher.unit.test.js test/mall-writer.unit.test.js test/mall-id.unit.test.js test/pbt/mall-switcher.pbt.test.js test/pbt/mall-id.pbt.test.js
npm run lint
```

If runtime behavior changes:

```bash
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
npm test
```

## Rollback / Stop Conditions

- Stop and create/update OpenSpec before changing auth storage default path, account registry schema, mall id error semantics, mall probe order, or security-sensitive logging.
- Stop if a test requires real account credentials or live merchant network; replace with fixture/unit seam.
- Stop if the task expands into observability/redaction; route that as the next SCAMPER surface after auth/account/mall boundaries are frozen.
