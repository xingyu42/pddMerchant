# Quality gate CI lint diagnostics and plan

## Goal

Diagnose the current quality gate reality for `pdd-cli` and produce the smallest safe plan for real lint/CI enforcement.

User value: future cross-cutting changes should be protected by a clear, honest, automated gate. Today tests are real, but lint is placeholder-only and repo-local CI is absent.

## Parent / Dependency

Parent task: `07-08-cross-cutting-quality-config-daemon-scamper-planning`.

This child implements the first recommended direction from the parent:

1. Quality gate / CI / real lint enforcement.
2. It must run before config/env/path and daemon/auth-refresher follow-up tasks because those future changes need a reliable gate.
3. It starts diagnostics-first and must not add dependencies or CI files unless the diagnostics justify a specific next step.

## Confirmed Facts

- `package.json:15` defines `test` as `vitest run`.
- `package.json:16` defines `test:watch` as `vitest`.
- `package.json:17` defines `test:endpoints` as `vitest run test/validate-existing-endpoints.test.js`.
- `package.json:18` defines `lint` as `echo no-lint`, so `npm run lint` is not a real lint gate.
- `vitest.config.js:5` includes `test/**/*.test.js`.
- `vitest.config.js:6` loads `test/setup.js`.
- `vitest.config.js:8` uses Node environment.
- `vitest.config.js:9` and `vitest.config.js:10` set long test/hook timeouts.
- `vitest.config.js:11` uses `pool: 'forks'`.
- `.github/workflows` is missing in this checkout, so there is no repo-local GitHub Actions workflow.
- Memory confirms the same historical quality weakness: `npm run lint` is placeholder-only, no CI workflow was present, and `npm test` was the hard verified gate.
- `openspec/project.md` records a V0.1 constraint: no new npm dependencies by default.

## Requirements

- R1: Reconfirm current script and CI state from the repository, not memory alone.
- R2: Run and record the current baseline gates:
  - `npm run lint` with explicit note that it is placeholder-only;
  - `npm test` as the current hard gate, unless time/resources force a narrower first pass and that limitation is recorded.
- R3: Produce a minimal enforcement plan with options ranked by safety:
  1. no-dependency diagnostics/check script or documentation cleanup;
  2. CI workflow around existing commands;
  3. dependency-backed lint only if justified.
- R4: Do not add npm dependencies in this child without explicit approval and OpenSpec/tooling-policy consideration.
- R5: Do not add or change CI enforcement until the plan decides the exact commands and failure behavior.
- R6: Avoid overstating lint: reports must say `npm run lint` is placeholder-only until changed.
- R7: Preserve current test behavior and do not weaken Vitest/PBT/e2e coverage.
- R8: If a proposal is needed for normative CI/tooling policy, document the OpenSpec boundary before implementation.

## Acceptance Criteria

- [x] Current scripts and CI presence/absence are verified from disk.
- [x] `npm run lint` result is recorded as placeholder-only.
- [x] `npm test` or a justified targeted substitute is run and recorded.
- [x] A recommended first enforcement step is chosen with rationale and trade-offs.
- [x] No dependencies are added in the diagnostics phase.
- [x] No CI files are added before the enforcement plan is accepted.
- [x] OpenSpec boundary is documented for future CI/lint policy changes.
- [x] Git scope remains clean or limited to planning artifacts until implementation is explicitly approved.

## Out Of Scope

- Installing ESLint, Biome, Prettier, or other new tooling in this child without explicit follow-up approval.
- Adding `.github/workflows/**` before the exact gate commands are agreed.
- Reformatting the codebase.
- Changing tests unrelated to gate diagnostics.
- Modifying runtime behavior.

## Recommended First Implementation Slice

Run diagnostics and write a short gate plan. Recommended output should answer:

1. What currently gates quality?
2. What is misleading today?
3. What is the smallest safe next change?
4. Does that next change require OpenSpec or dependency approval?

## Diagnostics Results

### Verified repository state

- `package.json` scripts are:
  - `test`: `vitest run`
  - `test:watch`: `vitest`
  - `test:endpoints`: `vitest run test/validate-existing-endpoints.test.js`
  - `lint`: `echo no-lint`
- `.github/workflows` is missing, so there is no repo-local CI workflow.
- `vitest.config.js` discovers `test/**/*.test.js`, uses `test/setup.js`, Node environment, long timeouts, and fork workers.
- Node/npm observed during diagnostics: Node `v24.16.0`, npm `11.13.0`.

### Baseline command results

- `npm run lint`: passed, but only printed `no-lint`; this is placeholder-only and provides no static-analysis coverage.
- `npm test`: passed with 121 test files and 971 tests.

### Current quality gate reality

- Real gate today: `npm test`.
- Misleading gate today: `npm run lint`, because it exits 0 without checking code.
- Missing automation today: no repo-local CI workflow enforces `npm test` or any future `check` command.

## Recommended Enforcement Plan

### Recommended first change: add an honest no-dependency `check` gate

Create a follow-up implementation task that adds a no-new-dependency project gate, for example:

```json
{
  "scripts": {
    "check": "npm test"
  }
}
```

Rationale:

- It uses the verified hard gate that already passes: `npm test`.
- It does not add dependencies.
- It avoids pretending `lint` is real.
- It gives future agents and CI one honest command to run before broader tooling exists.

Trade-off:

- It still does not provide static linting; it only makes the current true gate explicit.

### Second change: add CI around the honest gate

After `check` is accepted, add `.github/workflows/ci.yml` that runs the agreed command, preferably:

```bash
npm ci
npm run check
```

Rationale:

- CI should run the exact local gate, not a separate hidden command.
- This keeps workflow behavior simple and avoids duplicating test policy.

Trade-off:

- This introduces contributor workflow policy. It should be reviewed explicitly, though it does not change runtime behavior.

### Third change: evaluate real lint tooling separately

Only after the no-dependency gate and CI path are accepted, evaluate ESLint/Biome/Prettier or a custom no-dependency static check.

Rationale:

- The repo has a no-new-dependency bias in `openspec/project.md`.
- Adding lint tooling can create broad style churn unrelated to behavior.

Trade-off:

- Static-analysis coverage remains absent until that later decision.

## OpenSpec Boundary

- Diagnostics-only work in this child does not require OpenSpec.
- Adding a `check` script that aliases the existing `npm test` gate is likely a non-runtime tooling change and probably does not need OpenSpec, but should be reviewed because it becomes project process.
- Adding CI policy or new lint dependencies should be explicitly approved before implementation.
- Runtime behavior, envelope shape, CLI output, env/path semantics, auth, daemon, and security behavior are untouched by this diagnostics task.
## Implementation Results

- Added `package.json` script `check: npm test` as the first honest no-dependency quality gate.
- No npm dependencies were added.
- No CI files were added.
- Runtime behavior was not changed.
- `npm run check` passed with 121 test files and 971 tests.
- `npm run lint` still passes by printing `no-lint`; it remains placeholder-only and is not static analysis.

## Follow-up Recommendation

The next independently reviewable task should add a repo-local CI workflow around the agreed gate:

```bash
npm ci
npm run check
```

Do not add real lint tooling until dependency approval and style-churn scope are explicitly reviewed.
## Open Questions

None blocking for planning. Ready for review before `task.py start`.


