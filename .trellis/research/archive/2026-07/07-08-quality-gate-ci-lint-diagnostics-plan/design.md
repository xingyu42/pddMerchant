# Design: Quality gate CI lint diagnostics and plan

## Direction

This child task is diagnostics-first. It should verify the current quality gate reality and propose the smallest safe improvement before changing project tooling.

## Boundary Model

### Current hard gate

- Owner: `package.json` and `vitest.config.js`.
- Current command: `npm test` -> `vitest run`.
- Risk: full test suite may be slower, but it is the only real broad automated gate today.

### Placeholder lint

- Owner: `package.json`.
- Current command: `npm run lint` -> `echo no-lint`.
- Risk: humans/agents may report “lint passed” as if static analysis ran.

### CI

- Owner: future `.github/workflows/**` if introduced.
- Current state: missing in this checkout.
- Risk: adding CI prematurely can create a false sense of protection if it runs the wrong commands or ignores fixture/env needs.

## Enforcement Options To Evaluate

1. No-dependency documentation/script honesty
   - Example: rename or document placeholder behavior; add a `check` script that runs existing gates.
   - Lowest risk and compatible with no-new-dependency constraint.
2. CI around existing gates
   - Example: GitHub Actions runs `npm ci` and `npm test`.
   - Requires deciding environment assumptions and whether Playwright browser install is needed for current fixture-backed tests.
3. Real lint tooling
   - Example: ESLint/Biome/Prettier.
   - Higher risk because it likely adds dependencies and can produce broad style churn.

## OpenSpec Boundary

Diagnostics-only work does not require OpenSpec.

OpenSpec or explicit approval may be required before:

- adding normative CI policy;
- adding new npm dependencies for lint/format tooling;
- changing contributor workflow or repository gate semantics;
- changing test suite inclusion or command meaning in a breaking way.

## Risk Controls

- Prefer no-dependency options first.
- Do not claim lint is real until it is real.
- Keep `npm test` as the hard gate unless a stronger replacement exists.
- Do not reformat the repo as part of diagnostics.
- Do not weaken any existing tests.
