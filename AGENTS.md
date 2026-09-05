# pdd-cli Agent Context

This repository is `pdd-cli`, a Node.js ESM CLI for Pinduoduo merchant operations. It drives Chromium with Patchright's Playwright-compatible API, reuses the merchant frontend runtime, captures XHR/fetch business responses, and emits AI-friendly envelopes shaped as `{ ok, command, data, error, meta }`.

## Use Project Skills First

Project-specific skills live under `.agents/skills/`. Use the smallest matching skill before editing:

- `$pdd-architecture-navigation`: trace layers, runtime flow, envelope/errors, and high-risk modules.
- `$pdd-local-development`: local setup, env vars, auth-state paths, logs, daemon, scripts, and no-build ESM execution.
- `$pdd-testing-troubleshooting`: Vitest, smoke/unit/e2e/PBT, fixture adapter, JSON purity, and validation selection.
- `$pdd-command-feature-development`: commands, services, endpoint specs, domain behavior, dry-run/write flow.
- `$pdd-adapter-auth-integration`: Playwright, auth, mall context, account storage, endpoint transport, rate limit, redaction, external integration.

## Tech Stack

- Runtime: Node.js `>=18`, pure JavaScript ESM (`"type": "module"`), no TypeScript and no build step.
- CLI: Commander via `bin/pdd.js`.
- Browser/integration: `patchright`, Chromium, XHR/fetch interception.
- Output/logging/errors: `src/infra/output.js`, `src/infra/errors.js`, `src/infra/logger.js`.
- Tests: Vitest with `test/**/*.test.js`, fixture adapter, subprocess e2e tests, and PBT coverage using the project harness plus `fast-check`.

## Key Paths

- `bin/pdd.js`: Commander command tree, global flags, option merge, signal handlers, top-level error envelopes.
- `bin/pdd-daemon.js`: daemon process entry.
- `src/commands/_runner.js`: `withCommand()`, auth/account resolution, mall switching, timeout/abort, batch mode, fixture mode, envelope emission.
- `src/commands/`: command handlers for `init`, `login`, `doctor`, `config`, `shops`, `orders`, `goods`, `promo`, `diagnose`, `account`, and `daemon`.
- `src/services/`: reusable domain logic for orders, goods, promo, diagnose, goods publish, auth, pricing, and image helpers. Diagnostic reports contain factual metrics and data availability, not operating advice or scores.
- `src/adapter/`: Playwright/browser/auth/mall/endpoint/XHR/mock/rate-limit integration.
- `src/adapter/endpoints/`: business endpoint specs consumed by `runEndpoint()`.
- `src/infra/`: cross-cutting config, paths, output, errors, logger, timeouts, abort, account registry, auth lock, daemon helpers.
- `test/`: Vitest unit, smoke, e2e, PBT, fixtures, and helper harnesses.
- `.trellis/`: current task artifacts, workflow, package/layer specs, and workspace journals.
- `docs/`: architecture, ADRs, endpoint/recon notes, form analysis, and dated research.

The intended dependency flow is `commands -> services -> adapter -> infra`. Avoid reverse imports and avoid moving domain logic into `bin/pdd.js`.

## Commands

```bash
npm install
npx patchright install chromium
node bin/pdd.js doctor --json
node bin/pdd.js orders list --size 20 --json
npm test
npx vitest run test/<file>.test.js
npx vitest
npm run lint
```

`npm run lint` is currently `echo no-lint`. There is no repo build command.

## Runtime And Env

- `PDD_TEST_ADAPTER=fixture` enables the mock adapter and avoids real browser/backend calls in tests.
- `PDD_TEST_FIXTURE_DIR=<path>` points to alternate fixtures.
- `PDD_TEST_AUTH_INVALID=1` and `PDD_TEST_CONSUMER_AUTH_INVALID=1` simulate auth failures.
- `PDD_AUTH_STATE_PATH` explicitly overrides merchant auth state; without a registry the fallback is `data/merchant/stores/default/auth-state.json`, while registered accounts use registry slugs.
- `PDD_CONSUMER_AUTH_STATE_PATH` explicitly overrides consumer auth state; without a registry the fallback is `data/consumer/accounts/default/auth-state.json`, while registered accounts use registry slugs.
- `PDD_ACCOUNTS_DIR` / `PDD_ACCOUNT_REGISTRY_PATH` and their `PDD_CONSUMER_*` counterparts override merchant and consumer storage independently.
- CLI and daemon logs use fixed daily files under `log/cli/` and `log/daemon/`; foreground/bootstrap logs use stderr. `PDD_LOG_DESTINATION` is unsupported.
- `PDD_RATE_LIMIT_QPS`, `PDD_RATE_LIMIT_BURST`, `PDD_COOLDOWN_THRESHOLD`, and `PDD_COOLDOWN_MS` affect shared endpoint rate limiting.
- `PLAYWRIGHT_DOWNLOAD_HOST` can configure Chromium download mirrors.

Do not commit or expose files under `data/` that contain auth state, account registry, credentials, daemon state, or logs.

## Core Contracts

- Preserve the envelope top-level shape `{ ok, command, data, error, meta }`.
- Use `PddCliError` and `ExitCodes` from `src/infra/errors.js`; do not invent ad-hoc error shapes.
- Keep `--json` stdout to one JSON line; human diagnostics can go to stderr.
- Use `src/infra/logger.js` or `ctx.log` for logs; do not add runtime `console.log`.
- Sensitive values are fingerprint-redacted by logger/output. Do not print raw cookies, Anti-Content, authorization, QR content, credentials, mobile/phone, address/receiver, goods images, or encrypted credential data.
- Goods write commands require `--confirm`; without it they return dry-run data.
- Endpoint specs should keep fixture names aligned with `spec.name` under `test/fixtures/endpoints/`.

## Common Task Routes

- New or changed command: start at `bin/pdd.js`, then `src/commands/<domain>/...`, `src/services/...`, endpoint specs, and matching tests.
- Endpoint behavior: inspect `src/adapter/run-endpoint.js`, `src/adapter/endpoint-client.js`, `src/adapter/xhr-collector.js`, then the domain spec in `src/adapter/endpoints/`.
- Auth/account/login: inspect `src/commands/_runner.js`, `src/commands/login.js`, `src/services/auth.js`, `src/adapter/auth-state.js`, and `src/infra/account-*`.
- Mall context: inspect `src/adapter/mall-reader.js`, `mall-writer.js`, `mall-switcher.js`, `mall-id.js`, and mall tests.
- Goods publish: inspect `src/services/goods-publish.js`, `src/adapter/goods-publish/`, `src/adapter/endpoints/goods-publish.js`, `docs/goods-publish-api-recon.md`, and goods-publish tests.
- Proposal-level changes: use the active Trellis task artifacts and read the relevant `.trellis/spec/` layer before implementation.

## Verification Checklist

- Run targeted Vitest files for the touched domain.
- Run `npm test` for shared contracts, `_runner.js`, adapter transport, auth/mall, envelope/errors, or cross-domain changes.
- For project-harness PBT failures, rerun with the emitted `PBT_SEED=<n>`; for fast-check, use its reported seed/path.
- Check `git diff` before finishing and confirm changes stay within the requested scope.
- Do not claim CI coverage unless a repo-root CI workflow exists; none is currently present in this checkout.

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
