# Implementation Plan

## Steps

1. Run baseline targeted tests:
   - `npx vitest run test/runner-contract.unit.test.js test/pbt/ctx-contract.pbt.test.js`
   - Add finalizer test file to this command once created.
2. Add regression tests for the selected audit gaps:
   - live `pageSession.closeAll()` rejection finalizes as one error envelope;
   - aborted `parentSignal` or deadline edge maps through the standard error envelope path without duplicate emit;
   - fixture auth invalid skips `run(ctx)` and returns `E_AUTH_EXPIRED` / auth exit code;
   - `normalizeRunResult()` reserved and non-reserved shapes.
3. Run the focused tests and inspect failures.
4. If all tests pass without code changes, keep the task as a coverage-only commit.
5. If a test fails due to a true contract mismatch, make the smallest runtime fix in the owning module and rerun targeted tests.
6. Run broader validation if runtime code changes:
   - `npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js`
   - `npm test` if a shared runner/envelope path changed.
7. Run `npm run lint` and note that it is currently a no-op if unchanged.
8. Check `git diff` and finish the Trellis task only after tests are green.

## Expected Files

- Likely test edits:
  - `test/runner-contract.unit.test.js`
  - optional `test/envelope-finalizer.unit.test.js`
- Possible runtime edits only if tests expose a real defect:
  - `src/commands/runner/single-lifecycle.js`
  - `src/commands/runner/fixture-runtime.js`
  - `src/commands/runner/envelope-finalizer.js`

## Validation Commands

```bash
npx vitest run test/runner-contract.unit.test.js test/pbt/ctx-contract.pbt.test.js
npx vitest run test/envelope-finalizer.unit.test.js test/runner-contract.unit.test.js test/pbt/ctx-contract.pbt.test.js
npm run lint
```

If runtime code changes:

```bash
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
npm test
```

## Rollback Points

- If mock setup becomes brittle, split finalizer tests into a pure unit file and keep live lifecycle tests in `runner-contract.unit.test.js`.
- If an edge requires behavior change rather than coverage, pause implementation and route through OpenSpec before changing public runtime semantics.
