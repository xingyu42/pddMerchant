# Removal Execution

## Gates

- [x] User approved independent task creation.
- [x] User approved removal of advice plus scores/tiers/classifications and associated output changes.
- [x] Call sites and data/presentation boundaries inspected; PRD converged.
- [x] Activated with `task.py start --allow-empty-context`; degraded mode has no persisted active-session pointer.

## Work

1. Record current baseline; preserve staged `.gitattributes` and parent-task files.
2. Delete advice-only action command, registry and generator; unregister it.
3. Strip goods/promo assessment calculations and flags while retaining factual data and partial-source semantics.
4. Replace diagnosis scoring and score comparisons with factual summaries/comparisons; update every caller and renderer.
5. Update current user documentation and factual service/command specs, with reverse searches for orphan references. Do not edit archive/task-history documents.
6. Add fresh, isolated Vitest tests for removal and retained metrics. Recreate only the required minimal test/setup.js; no old suite restoration.
7. Run targeted tests and npm test, a shuffled repeat, syntax checks for touched JavaScript, and git diff --check. Recheck scope and exact absence of advice generators/registrations.
8. Record actual results and remaining risks; do not commit/archive or update the main thread's task.

## Planned Verification

```bash
npm test -- --reporter=dot
npm test -- --reporter=dot --sequence.shuffle --sequence.seed=20260905
git diff --check
git diff --name-status
```

Use fixture mode with synthetic temp fixtures for subprocess tests; pure service/render tests require no browser. Inspect current Vitest options before the seeded repeat. There are currently no test files, so the pre-change baseline cannot establish historical regression coverage. `npm run lint` is a no-op and there is no build command. Report these limitations rather than claiming those checks passed.

Rollback, if requested, is limited to this task's files; never restore unrelated old tests or reset the worktree.

## Results (2026-09-05)

- Removed advice-only action command/registry/service, scores/tiers/promo classifications, threshold flags, and assessment renderers. Retained factual queries, missing-source warnings, numerical comparisons and write confirmation.
- Updated README, public CLI skill and local factual command/service specs. Follow-up authorization allowed clearing stale action references in both protected project skills, AGENTS.md and CLAUDE.md.
- Fresh targeted tests: 2 files, 30 tests passed. Initial CLI attempts failed only because Windows Node preloading needed a file URL; fixed test helper and reran all 12 CLI tests successfully.
- `npm test -- --reporter=dot`: 2 files, 30 tests passed.
- `npm test -- --reporter=dot --sequence.shuffle --sequence.seed=20260905`: 30 tests passed.
- `node --check` on 25 changed/new JavaScript files passed. `git diff --check` passed with only Git LF/CRLF conversion warnings.
- `npm run lint` executed but is only `echo no-lint`; no genuine lint/type/build gate exists.
- Source reverse search found no old scoring exports, action-plan calls, break-even fields or advice output keys.
- No historical tests restored or inspected; baseline had no tests, so the available full suite is only these new tests. Real browser/platform data, production accounts and broad unrelated workflows remain unverified.
- Parent test-task artifacts and staged `.gitattributes` untouched. No dependency install. Removed payload fields are an approved compatibility break; parent test planning needs separate alignment.
- Follow-up: user authorized scoped commit and archival, excluding all `test/` paths (manually deleted tests must not be restored). The 30-test results above describe the earlier verification, not tests included in the final commit. Remaining untracked test files are untouched.
