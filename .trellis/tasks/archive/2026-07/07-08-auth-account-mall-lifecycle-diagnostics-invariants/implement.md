# Implementation Plan

## Steps

1. Read task artifacts and required Trellis specs via `trellis-before-dev`.
2. Run baseline targeted tests:
   - `npx vitest run test/pbt/account-resolver.pbt.test.js test/batch-orchestration.unit.test.js test/runner-contract.unit.test.js test/e2e/multi-account-switch.e2e.test.js`
   - `npx vitest run test/mall-switcher.unit.test.js test/mall-writer.unit.test.js test/mall-id.unit.test.js test/pbt/mall-switcher.pbt.test.js test/pbt/mall-id.pbt.test.js`
3. Inspect existing account resolver and runner tests for gaps against the PRD matrix.
4. Add focused tests for missing auth/account/mall lifecycle invariants.
5. Rerun targeted tests.
6. Run `npm run lint`.
7. If only tests changed and pass, commit as coverage-only.
8. If runtime code changes are required, stop for OpenSpec if the change is behavior/security-sensitive; otherwise make the smallest owning-layer fix and run broader tests.

## Likely Files

- `test/pbt/account-resolver.pbt.test.js`
- `test/runner-contract.unit.test.js`
- `test/batch-orchestration.unit.test.js`
- optional new focused test file if combining seams in existing files becomes awkward

## Validation Commands

```bash
npx vitest run test/pbt/account-resolver.pbt.test.js test/batch-orchestration.unit.test.js test/runner-contract.unit.test.js test/e2e/multi-account-switch.e2e.test.js
npx vitest run test/mall-switcher.unit.test.js test/mall-writer.unit.test.js test/mall-id.unit.test.js test/pbt/mall-switcher.pbt.test.js test/pbt/mall-id.pbt.test.js
npm run lint
```

If runtime code changes:

```bash
npx vitest run test/envelope.test.js test/error-envelope.unit.test.js test/command-runner.unit.test.js test/runner-contract.unit.test.js
npm test
```
