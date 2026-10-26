# Functional Fix Verification

## Archive Close-Out

The user subsequently authorized committing and archiving this remediation task. Code and tests were committed as `fd4076f` on 2026-09-05, excluding pre-existing `.gitattributes` and `src/infra/paths.js` work. The uncommitted/unarchived wording below describes the earlier verification checkpoint. Validation limits remain unchanged. Only this remediation task is selected for archival; the source audit task remains separate.

## Result

F1-F9 implemented. On 2026-09-05, the final isolated regression gate passed: 24 files, 271 tests, exit 0. No real account, merchant request, browser or persistent daemon was used. M1/M2 remain deferred. Work is uncommitted and both tasks remain unarchived.

## Command

```bash
node node_modules/vitest/vitest.mjs run test/auth-refresher-lifecycle.unit.test.js test/daemon-launch-confirmation.unit.test.js test/daemon-lifecycle.unit.test.js test/daemon-refresh-outcome.unit.test.js test/pbt/auth-refresher.pbt.test.js test/runner-contract.unit.test.js test/promo-endpoint.unit.test.js test/promo-roi.unit.test.js test/goods-segmentation.unit.test.js test/diagnose-scoring.unit.test.js test/action-plan.unit.test.js test/goods-response-shape.unit.test.js test/diagnosis-data-flow.unit.test.js test/goods-collector.unit.test.js test/layering-guard.unit.test.js test/run-endpoint.unit.test.js test/orders-page-api.unit.test.js test/orders.detail-endpoint.unit.test.js test/envelope.test.js test/error-envelope.unit.test.js test/login-daemon-autostart.unit.test.js test/diagnose-render.unit.test.js test/diagnose-compare.unit.test.js test/pbt/abort-timeout.pbt.test.js --testTimeout 15000
```

`node --check bin/pdd-daemon.js` and `git diff --check` passed. Git reports repository LF/CRLF conversion warnings, not whitespace errors. The Vitest pre-transform strips only the daemon entry's shebang for module mocking; the real executable keeps its shebang. An earlier expanded run failed on that test-transform issue; the final run above includes the corrected tests.

## Coverage

| Findings | Permanent regression evidence |
| --- | --- |
| F1/F9 | runner-contract, abort-timeout, diagnosis-data-flow: live deadline, listener/timer cleanup and complete context forwarding |
| F2 | auth-refresher-lifecycle, auth-refresher PBT, daemon-refresh-outcome: natural response matching, valid/expired/inconclusive distinction, persistence and cleanup |
| F3/F4 | daemon-launch-confirmation, daemon-lifecycle: launch correlation, dead/mismatched state, wrapper PID, denied stop and replacement-state retention |
| F5 | promo-roi: unrounded break-even threshold controls scale |
| F6/F8 | goods-segmentation, action-plan, diagnosis-data-flow, diagnose-scoring: independent scan quality, null unknowns, no unsupported clearance, supported restock |
| F7 | goods-response-shape, promo-endpoint: malformed required fields versus legitimate zero/empty and numeric aliases |

## Compatibility And Limits

- Incomplete segmentation intentionally returns nullable classification/full-period sales fields. `observed_units_sold` and quality flags preserve observed facts. Consumers must not coerce null to zero. Partial inventory scores are excluded from the overall store score.
- Full `npm test` was not run: inspected subprocess tests do not universally isolate account registries/config/daemon state; some can select a real browser path. This remains a full-suite validation gap, not a passing claim.
- Startup/stop tests mock processes and state. Real Windows launch behavior and long-term merchant session survival are not verified.
- `npm run lint` is a no-op and no build script exists; neither is reported as meaningful validation.
- Original staged `.gitattributes`, pre-existing `src/infra/paths.js` working-copy state and VMProtect handoff remain untouched. The launcher fix was applied on the existing working copy, without restoring it.
- Historical audit observation tests were not repurposed as acceptance tests. Executable specs were updated separately.
