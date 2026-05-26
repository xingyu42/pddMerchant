# Plan

## Analysis

- Read existing `AGENTS.md`, `README.md`, `CLAUDE.md`, `.env.example`, package/test config, OpenSpec guidance, `.context` preferences, entrypoints, commands, services, adapter, infra, docs, and tests.
- Attempted parallel subagent research across architecture, local development, testing, adapter/security, services, and history/OpenSpec. Most subagents were blocked by external 429 rate limits, so equivalent scoped analysis was completed locally with parallel file reads and codebase search.

## Implementation

- Create concise, project-specific skills under `.agents/skills/` for the actual high-frequency development scenarios in this repository.
- Update `AGENTS.md` as the project entry context while preserving the OpenSpec managed block.
- Keep runtime code unchanged.

## Validation

- Validate skill structure with `skill-creator` `quick_validate.py`.
- Check for TODO/placeholder text.
- Check referenced paths exist.
- Run `npm run lint`, targeted envelope/json-purity tests, and full `npm test`.
- Attempt CCG external dual-model review; record if blocked by approval policy.
