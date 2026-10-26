# 审查问题修复

## Goal

修复代码质量审查的 F1-F9 九项功能问题，以本地隔离回归测试验证；维护去重另行处理，不接触真实账号、不提交。

## Requirements

- F1: Keep the live command deadline armed until the operation settles; deadline-driven cancellation must work in both live and fixture paths.
- F2: Determine refresh validity from the existing natural merchant checkLogin contract, not HTTP-only heartbeat/homepage success. Save auth state only on conclusive validity; preserve expired versus inconclusive outcomes through daemon reporting.
- F3: Reject stale running state when confirming daemon startup. Confirm the launched daemon instance, accounting for the Windows launcher PID differing from the daemon PID.
- F4: Report daemon stop failure when the target remains alive, preserving its state rather than claiming it stopped.
- F5: Never classify ROI below the configured break-even threshold as an opportunity to increase budget.
- F6: Preserve goods-scan truncation/rate-limit status through inventory scoring, segmentation, and action-plan output. Partial data must not be labelled full.
- F7: Reject missing or invalid required goods/promo response fields without manufacturing zero results. Preserve valid explicit zero/empty results.
- F8: Incomplete order scans must not be treated as proof of zero sales. Omit recommendations requiring complete sales data, rather than retaining them with a warning. Keep observed facts and independently supported recommendations, with explicit incompleteness.
- F9: Preserve the complete runtime context through all four standalone diagnosis commands, including cancellation, deadline, client, and page session.
- Preserve the top-level envelope contract and existing valid-data behavior unless a listed defect requires change. Make uncertainty observable without exposing sensitive data.
- Verify using local isolated tests only. Do not access real accounts, merchant endpoints, or existing account/session state; do not start a real persistent daemon.
- Preserve unrelated WIP, do not commit, push, or archive. Approval to plan is not activation approval.

## Confirmed Facts

- Source audit: ../09-05-code-quality-audit/report.md, findings F1-F9. M1/M2 are explicitly deferred.
- The user requested fixes and approved creating this planning task for the nine functional findings.
- Current branch main, previously verified HEAD 03c53f7b3ef3532409558d92d43c530a7970a9bb.
- Existing WIP remains: staged .gitattributes; modified src/infra/daemon-launcher.js and src/infra/paths.js; untracked VMProtect handoff document. The daemon-launcher edit must use the current working copy, not restored HEAD content.
- Audit evidence includes 13 local observation tests and 107 passing existing targeted tests. Observation tests assert buggy behavior; they are not fix acceptance tests.
- The original audit task remains unarchived. This task owns remediation; preserve the historical audit evidence.

## Acceptance Criteria

- [x] F1/F9: A simulated live deadline produces E_TIMEOUT, cleans resources, and is propagated by every standalone diagnosis command; envelopes remain emitted once.
- [x] F2: Natural checkLogin true/false and missing/malformed/non-2xx cases are distinct; only valid saves; expiry/inconclusive do not overwrite state; observer resources are cleaned.
- [x] F3/F4: Stale/dead startup state cannot confirm launch; matching live startup can; denied or ineffective stop returns failure and preserves state; confirmed stop retains existing success behavior.
- [x] F5: ROI 2.5 with break-even 3 cannot produce scale/increase_budget; normal default threshold cases remain covered.
- [x] F6/F8: Independently incomplete goods/orders scans retain their status in final outputs; unknown sales cannot become an evidence-backed clearance recommendation.
- [x] F7: Malformed-success goods and entity/hourly promotion responses fail explicitly; legitimate zeros and empty collections still work.
- [x] Each finding has a permanent regression test asserting corrected behavior, with cross-layer coverage where needed.
- [x] Run relevant isolated regressions, then expand shared-contract checks only after verifying filesystem/network/process isolation; report skipped checks.
- [x] Final diff is limited to fixes, necessary tests/spec updates, and task artifacts; no unrelated WIP is reverted and nothing is committed.

## Out of Scope

- M1 duplicate acquisition and M2 matching-rule refactoring; general architecture cleanup; unconfirmed audit leads.
- Live auth-survival claims, real account login/refresh, production endpoint experiments, dependency upgrades, and automatic business writes.

## Planning Gate

- The user approved omission of unsupported recommendations and approved execution with "执行". The task was activated and F1-F9 implemented. See verification.md for the local gate and remaining validation limits; no commit or archive performed.
