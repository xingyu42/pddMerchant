# Design

## Boundary

This is a diagnostics and planning task. The output should be a drift map, not a runtime patch. Any behavior-changing follow-up must be split into a separate Trellis task and, where required, an OpenSpec change.

## Evidence Sources

- Code: `src/infra/config.js`, `src/infra/paths.js`, auth/account registry helpers, daemon helpers, endpoint rate-limit/cooldown helpers.
- Tests: config/path tests, account registry tests, daemon tests, endpoint fixture/rate-limit tests, JSON purity tests where env affects output.
- Docs/specs: `.env.example`, `AGENTS.md`, `.trellis/spec/infra/*`, `.trellis/spec/standards/*`, `openspec/specs/auth-state-store/spec.md`, daemon/auth refresher specs.

## Drift Map Shape

Each finding should include:

- Contract item: env var, path, or validation rule.
- Current code behavior.
- Current test coverage.
- Current doc/spec claim.
- Drift classification.
- User impact and risk.
- Recommended next action.

## OpenSpec Boundary

OpenSpec is required before changing durable capability semantics such as default auth-state location, daemon state location, env precedence, account storage behavior, or security-sensitive validation. Pure diagnostics can stay in Trellis.

## Rollback

No runtime changes are expected. If any docs/spec corrections are made, they should be isolated and reversible.
