# Execution Plan

1. Review the PRD/design with the user, then activate the task.
2. Add an offline regression at the real collector -> orders service -> endpoint client seam. Simulate a fresh page whose runtime only becomes available after navigation. Run the test and capture runtime-not-found.
3. Test wrong-origin navigation, repeated same-origin pagination, navigation failure, cancellation, expired budgets and unchanged endpoints without nav.
4. Add ORDER_LIST navigation metadata and deadline-aware page-api preparation. Leave commands, collectors, XHR and page-session behavior unchanged.
5. Run temporary tests with npx vitest run --config page-api-navigation.tmp.config.js, then targeted tests: npx vitest run test/adapter/orders-contract.test.js test/services/goods-segmentation-contract.test.js test/e2e/business-contract.e2e.test.js
6. Run npm test for the shared adapter change. Check git diff for scope and secrets.
7. Delete the temporary regression test as requested by the user. Re-run the remaining suite.
8. Update adapter transport documentation to distinguish initialization navigation from prohibited XHR fallback; record verification and remaining live-platform limitations.

## Completion Gate

- Before/after regression demonstrated, relevant checks passed, no raw account material or temporary debug files added.
- User approval precedes activation. No commit without explicit user request.
- The user approved this plan and implementation on 2026-10-07, with the constraint that temporary tests must not remain.

## Verification Results (2026-10-07)

- Temporary tests lived in the repository root because writing a new file under test/adapter failed in this environment. No file or permission changes were made to work around that folder.
- Before fix: 10 of 14 tests failed, including the real collector -> service -> endpoint client path with orders.list: page API client unavailable / runtime-not-found.
- After fix: all 17 temporary tests passed, including three additional deadline/cancellation budget checks.
- Both page-api-navigation.tmp.test.js and page-api-navigation.tmp.config.js were deleted with apply_patch.
- Targeted existing tests: 3 files, 69 tests passed.
- Full npm test after temporary file deletion: 19 files, 246 tests passed (exit 0).
- git diff --check passed. Only endpoint-client.js and endpoints/orders.js have tracked code changes; no credentials or auth-state writes occurred.
- Adapter transport spec updated in place. No lint/type-check/build gate exists; lint is a no-op and the runtime is plain ESM.
- Live authenticated merchant readiness was not tested. Code is verified locally but not committed; task archival is deferred until an explicitly requested commit.
