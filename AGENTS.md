<!-- TRELLIS:START -->
# mini-trellis

This project uses mini-trellis as a memory layer. Working knowledge lives under `.trellis/`:

- `.trellis/spec/` — durable contracts (short markdown; read `index.md` first)
- `.trellis/research/` — topic inbox (`<topic>.md`; `README.md` is not a topic)
- `.trellis/workspace/` — per-developer journals

Record a session with `/mini-trellis:remember` (Claude/OpenCode), `/mini-trellis-remember` (Pi), or `$mini-trellis-remember` (Codex). When earlier decisions or relevant project rules are needed, use `mini-trellis mem recall "<topic or path>"`; expand evidence with `mini-trellis mem read "<ref>"`. No search is required for unrelated work. Promote lasting boundaries into spec with `mini-trellis-update-spec`.

Record only confirmed decisions, reusable research findings, or the session/compact handoff. Skip ordinary turns and unconfirmed guesses. New installs write notes without an automatic git commit; use `mini-trellis doctor` to check host wiring and `mini-trellis refresh --dry-run` before refreshing assets.

Keep confirmed rules short and faithful. Unconfirmed scope, exceptions, and implementation choices stay open or are labeled as inference, not added to the contract.

For a confirmed update, follow this short order: read the existing topic; edit that file; read it back and check the new rule, limits, and negations; run `python3 ./.trellis/scripts/add_session.py --title "..." --summary "..." --topic <actual-topic-path>`; read the journal and check its topic link. Journal-only success is not topic success; report partial writes accurately. New notes follow the requested or discussion language; updates preserve the document language.

When recall excerpts already answer the question with source and qualifiers, cite them and stop. Expand only missing context; do not repeat a lookup or fall back to dialogue-only `search` merely to reconfirm sufficient evidence.

mini-trellis does not create or drive tasks.

Managed by mini-trellis. Edits outside this block are preserved.
<!-- TRELLIS:END -->

# pdd-cli Agent Context

`pdd-cli` is a JavaScript ESM CLI for Pinduoduo merchant operations, requiring Node.js >= 24. It uses Commander and Patchright/Chromium to reuse the merchant frontend runtime, calling business APIs through the page's signed request client (page-api) and capturing XHR/fetch responses for the remaining endpoints. There is no TypeScript or build step; check `package.json` for scripts.

## Use Project Skills First

Project-specific skills live under `.agents/skills/`. Use the smallest matching skill before editing:

- `$pdd-architecture-navigation`: trace layers, runtime flow, envelope/errors, and high-risk modules.
- `$pdd-local-development`: local setup, env vars, SQLite storage paths, logs, scripts, and no-build ESM execution.
- `$pdd-testing-troubleshooting`: Vitest, unit/contract/e2e layers, fixture adapter, JSON purity, and validation selection.
- `$pdd-command-feature-development`: commands, services, endpoint specs, domain behavior, dry-run/write flow.
- `$pdd-adapter-auth-integration`: Playwright, auth, mall context, account storage, endpoint transport, rate limit, redaction, external integration.

## Architecture

- `bin/pdd.js` defines global options and delegates command registration to `src/commands/registry/`; keep domain logic out of it.
- `withCommand()` owns auth/account/mall context, timeout/abort, fixture mode, batch mode, and envelope emission; `src/commands/_runner.js` is a facade over `src/commands/runner/`.
- Keep dependencies flowing `commands -> services -> adapter -> infra`; avoid reverse imports.
- Use the matching project skill for detailed file routes and runtime configuration. Before implementation, read the relevant `.trellis/spec/` guidelines and related `.trellis/research/` topics, if any.

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



禁止在回答中使用“不是A而是B”这种句式，除非有绝对必要。
在回答中，禁止使用“不能/不等于/不把/不是/不能看作”等类似内容进行边界限定，除非我明确关心此处的边界。

