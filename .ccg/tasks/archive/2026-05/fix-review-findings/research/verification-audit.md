# Verification Audit

Active task: `.ccg/tasks/fix-review-findings`

## Files Found

- `package.json` - Declares the only npm quality scripts: `test`, `test:watch`, and placeholder `lint`.
- `vitest.config.js` - Configures Vitest discovery for `test/**/*.test.js`, Node environment, fork pool, 120s test timeout, and 30s hook timeout.
- `README.md` - Documents test commands and test strata: smoke, unit, e2e, and PBT.
- `openspec/project.md` - Documents the intended test strategy and fixture seam for CLI/e2e/PBT verification.
- `test/` - Current verification suite, including smoke tests, unit tests, e2e tests, PBT tests, adapter/infra/service tests, fixtures, and helpers.
- `test/pbt/README.md` - Documents PBT reproducibility knobs: `PBT_SEED` and `PBT_RUNS`.
- `.ccg/tasks/fix-review-findings/task.json` - Active task has `"gate": null`; no task-local threshold is defined.
- `.ccg/tasks/fix-review-findings/context.jsonl` - Lists review findings being fixed, mostly around goods publish, category resolver, source scraper, and dead code.

## Dependencies

- `npm test` -> `package.json` script `vitest run` -> `vitest.config.js` includes `test/**/*.test.js` -> runs smoke, unit, e2e, adapter/infra/service, and PBT files under `test/`.
- `npm run lint` -> `echo no-lint`; this is a pass/fail placeholder only and does not perform static analysis.
- `npx vitest run test/<file>.test.js` -> documented single-file verification path for targeted fixes.
- `PBT_SEED=<n> npm test` -> full suite with deterministic property-test reproduction.
- `PBT_RUNS=<n> npm test` -> full suite with increased PBT sample count for higher-confidence/nightly verification.
- `npm audit --audit-level=moderate` -> not declared in repo scripts and was not run because it requires external npm registry access and would disclose dependency metadata.

## Commands Run

- `npm run lint`
  - Result: pass.
  - Signal: prints `no-lint`.
  - Interpretation: only proves the placeholder script is wired; it does not prove code quality.
- `npm test`
  - Result: fail.
  - Signal: `1 failed | 88 passed` test files, `1 failed | 672 passed` tests.
  - Failing test: `test/e2e/multi-account-switch.e2e.test.js > e2e: --account flag passes through to command context`.
  - Failure detail: expected exit code `0`, received `2`; the emitted envelope was `E_USAGE` with message `消费端暂不支持密码登录`.
- `npm audit --audit-level=moderate`
  - Result: not run.
  - Signal: command was blocked before execution due external registry data transfer risk.
  - Safer local alternative: inspect `package-lock.json` and declared dependencies manually, or run `npm audit --offline` only if a local cache/advisory source is configured; otherwise require explicit approval for registry access.

## Patterns

- `package.json:13` defines scripts. The real local gate is `npm test`; `lint` is only `echo no-lint`.
- `vitest.config.js:4` sets Vitest include to all `test/**/*.test.js`, so adding or renaming tests under this tree automatically participates in `npm test`.
- `README.md:149` documents `npm test`, single-file Vitest runs, and watch mode.
- `README.md:157` documents smoke tests as command-level envelope contract checks.
- `README.md:158` documents unit tests as module-level checks.
- `README.md:159` documents e2e tests as subprocess plus fixture adapter end-to-end checks.
- `README.md:160` documents PBT tests and `PBT_SEED` reproduction.
- `test/pbt/README.md:19` documents default PBT behavior: full `npm test` includes PBT with default seed and runs.
- `test/pbt/README.md:20` documents deterministic reproduction via `PBT_SEED=<n>`.
- `test/pbt/README.md:21` documents higher sample counts via `PBT_RUNS=1000`.
- `.ccg/tasks/fix-review-findings/task.json:8` has `"gate": null`, confirming no task-local gate is set.

## Explicit 90% Threshold Check

No explicit 90% verification threshold was found in the current quality surface.

Evidence:
- `package.json` has no coverage or quality-threshold script.
- `vitest.config.js` has no `coverage` block and no thresholds.
- `README.md` documents test commands but no pass-rate/coverage percentage gate.
- `.ccg/tasks/fix-review-findings/task.json` has `gate: null`.
- Repository searches for `90`, `coverage`, `threshold`, `gate`, and related terms found only domain thresholds/scores, historical prose, or prior task notes, not an enforceable 90% quality gate.

## Defensible 90% Gate

If no explicit threshold is added to tooling, a defensible read-only 90% gate can be computed from currently available verification items as a weighted checklist, not from line coverage:

1. Full regression suite: `npm test` must pass. Weight: 60 points.
2. Task-targeted tests for each touched finding area must pass with single-file Vitest runs. Weight: 25 points.
3. Review-finding closure audit must show each confirmed P0/P1/P2 finding has either a passing regression test or a documented non-testable verification note. Weight: 10 points.
4. Placeholder lint awareness and dependency audit status must be recorded. Weight: 5 points.

Gate formula:

```text
score =
  60 if npm test passes else 0
+ 25 * (targeted test files passed / targeted test files required)
+ 10 * (review findings with evidence / confirmed review findings)
+  5 if lint/audit status is explicitly recorded else 0

pass if score >= 90 and no Critical blocker remains
```

For this repo, the gate should also include a hard blocker rule:

```text
Any failing `npm test` result blocks release/merge, regardless of computed score.
```

Rationale: A percentage-only gate could claim 99.85% by raw test-case pass rate (`672 / 673`) while still hiding a real e2e regression. The full suite must be all-green, and the 90% score should measure review-finding evidence completeness after that hard blocker is satisfied.

Current computed status:

- Raw test pass rate: `672 / 673 = 99.85%`.
- Hard blocker: present, because `npm test` failed.
- Defensible gate status: fail until `test/e2e/multi-account-switch.e2e.test.js` passes or is proven unrelated/pre-existing and explicitly waived by the main task owner.

## Risks

- `npm run lint` is a false confidence signal because it performs no linting.
- No coverage provider or threshold is configured, so a true line/branch/function 90% coverage gate cannot be computed without adding tooling or scripts.
- README says `npm test` runs 427 tests, but the current run reported 673 tests; docs are stale.
- `openspec/project.md` says `node:test`, while the repo currently uses Vitest; docs are stale.
- A raw pass-rate threshold is unsafe because one failing e2e test can still exceed 90%.
- `npm audit` is not a safe default local verification command in this environment because it requires external network access unless explicitly approved.

## Final Update: 2026-05-26T19:12:48Z

The earlier failing `npm test` state is superseded by the final verification artifact at `../final-verification.md`.

Current final evidence:

- `npm test`: passed, `89 passed` test files and `673 passed` tests.
- `npx vitest run test/e2e/multi-account-switch.e2e.test.js`: passed, `2 passed` tests.
- `npx vitest run test/pbt/account-registry.pbt.test.js`: passed, `15 passed` tests.
- `npx vitest run test/goods-publish.unit.test.js test/goods-publish.e2e.test.js`: passed, `2 passed` files and `64 passed` tests.
- `npm run lint`: passed, but only prints `no-lint`.

Task-local 90% gate: passed at 100/100 with `npm test` as a hard blocker.
