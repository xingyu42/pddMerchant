# pdd-cli Agent Context

`pdd-cli` is a JavaScript ESM CLI for Pinduoduo merchant operations, requiring Node.js >= 24. It uses Commander and Patchright/Chromium to reuse the merchant frontend runtime and capture XHR/fetch business responses. There is no TypeScript or build step; check `package.json` for scripts.

## Use Project Skills First

Project-specific skills live under `.agents/skills/`. Use the smallest matching skill before editing:

- `$pdd-architecture-navigation`: trace layers, runtime flow, envelope/errors, and high-risk modules.
- `$pdd-local-development`: local setup, env vars, SQLite storage paths, logs, scripts, and no-build ESM execution.
- `$pdd-testing-troubleshooting`: Vitest, smoke/unit/e2e/PBT, fixture adapter, JSON purity, and validation selection.
- `$pdd-command-feature-development`: commands, services, endpoint specs, domain behavior, dry-run/write flow.
- `$pdd-adapter-auth-integration`: Playwright, auth, mall context, account storage, endpoint transport, rate limit, redaction, external integration.

## Architecture

- `bin/pdd.js` defines CLI routing and options; keep domain logic out of it.
- `withCommand()` owns auth/account/mall context, timeout/abort, fixture mode, batch mode, and envelope emission; `src/commands/_runner.js` is a facade over `src/commands/runner/`.
- Keep dependencies flowing `commands -> services -> adapter -> infra`; avoid reverse imports.
- Use the matching project skill for detailed file routes and runtime configuration. Before implementation, read the relevant `.trellis/spec/` guidelines and active task artifacts, if any.

## Core Contracts

- Preserve the envelope top-level shape `{ ok, command, data, error, meta }`.
- Use `PddCliError` and `ExitCodes` from `src/infra/errors.js`; do not invent ad-hoc error shapes.
- Keep `--json` stdout to one JSON line; human diagnostics can go to stderr.
- Use `src/infra/logger.js` or `ctx.log` for logs; do not add runtime `console.log`.
- Sensitive values are fingerprint-redacted by logger/output. Do not print raw cookies, Anti-Content, authorization, QR content, credentials, mobile/phone, address/receiver, goods images, or encrypted credential data.
- Accounts and encrypted auth state use SQLite (`data/pdd.db`, overridden by `PDD_DB_PATH`); the generated `master.key` lives beside the DB (default `data/master.key`). Both are sensitive: never commit or expose them, and back them up together. Auth updates use account leases + revision CAS (compare-and-swap); account removal cascades to related data.
- Do not commit or expose credentials or sensitive runtime data, including files under `data/`, `log/`, and environment-overridden paths.
- Goods write commands require `--confirm`; without it they return dry-run data.
- Diagnostic reports contain factual metrics and data availability, not operating advice or scores.
- Endpoint specs should keep fixture names aligned with `spec.name` under `test/fixtures/endpoints/`.
- Merchant authentication is checked on demand at login, ordinary commands, and doctor; successful commands re-verify before persistence. Ordinary commands, login and doctor never launch or depend on a background process; `pdd daemon` (console, takeover, optional patrol; see `docs/adr/0003-reintroduce-explicit-daemon-console.md`) is started explicitly.

## Verification Checklist

- Run targeted tests with `npx vitest run test/<file>.test.js` for the touched domain.
- Run `npm test` for shared contracts, `_runner.js`, adapter transport, auth/mall, envelope/errors, or cross-domain changes.
- Use `PDD_TEST_ADAPTER=fixture` for ordinary automated integration checks. Confirm scope with the user before verification against real accounts or backends unless already explicitly authorized.
- `npm run lint` is currently `echo no-lint`, not a static check. Do not report it as lint coverage; consult `package.json` if scripts change.
- Check `git diff` before finishing and confirm changes stay within the requested scope.
- Report checks actually performed and any unverified behavior. Claim CI coverage only after inspecting the relevant workflow and results.

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

禁止在回答中使用“不是A而是B”这种句式，除非有绝对必要。
在回答中，禁止使用“不能/不等于/不把/不是/不能看作”等类似内容进行边界限定，除非我明确关心此处的边界。
