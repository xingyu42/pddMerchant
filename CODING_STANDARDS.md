# Coding Standards

Review entry point for pdd-cli diffs. The rules live in the files below; this file names them and adds the judgement calls no check enforces.

## Sources

- `CLAUDE.md` (Conventions, Gotchas) and `AGENTS.md` (Core Contracts)
- `.trellis/spec/standards/` — coding style, testing, dependencies
- `.trellis/spec/commands/command-contracts.md` — handler, option and per-command contracts
- `.trellis/spec/infra/envelope-errors-output.md` — envelope, errors, exit codes
- `.trellis/spec/adapter/endpoint-xhr-contracts.md` and `.trellis/spec/adapter/fixture-mode.md` — endpoint specs, normalizers, fixtures
- `.trellis/spec/services/domain-service-contracts.md` and `docs/adr/` — domain semantics

Tooling already enforces these, so skip them in review: unused files, exports and dependencies (`npm run lint`, knip), `data` contract v2 for every registered command (`test/contract/data-contract-v2.test.js`), and every registered command appearing in `skills/pdd-cli/SKILL.md` (`test/contract/command-docs.test.js`).

## Judgement calls

- **Parse-time options.** A CLI option is validated in its registrar through `src/commands/option-parsers.js` or `Option.choices`. Flag a service that re-checks a CLI option's range, enum or format, even when older code does the same.
- **Doc sync.** A diff that adds or changes a command also updates `CHANGELOG.md`, the owning `.trellis/spec/` file, and `README.md` when the command is user-facing.
- **Fixture parity.** A fixture-only key on a production endpoint spec (`fixtureVariantKey`, `fixtureListKey`) keeps fixture output identical to real mode, including pagination. Production comments name behaviour, never test fixture files.
- **Shared-contract drift.** A feature diff that changes a shared contract (endpoint client, `normalize` signature, runner, envelope) is named in the review and lands with its owning spec update.
