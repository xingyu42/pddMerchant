---
name: pdd-adapter-auth-integration
description: Change pdd-cli high-risk integration paths safely. Use for Patchright browser automation, merchant/consumer auth and QR/password login, account storage and leases, mall context, endpoint transport (page-api, XHR/fetch capture), rate limits, log redaction, or external PDD/third-party boundaries.
---

# PDD Adapter Auth Integration

Make narrow, well-tested changes on integration paths. Storage, credential and redaction baselines are in `AGENTS.md`; this skill adds the integration-specific rules.

## Must Read

- `src/commands/_runner.js` (facade) and `src/commands/runner/` (notably `src/commands/runner/single-lifecycle.js`) for command execution, auth validation, mall context, account batch mode, timeout/abort, and fixture branches.
- `src/adapter/browser.js` for browser launch/context behavior.
- `src/adapter/auth-state.js`, `src/adapter/merchant-auth-storage.js`, `src/infra/leases.js`, and `src/infra/paths.js` for auth-state storage, account leases, and revision CAS.
- `src/infra/account-store.js`, `src/infra/account-resolver.js`, `src/infra/consumer-account-resolver.js`, and `src/infra/master-key.js` for multi-account storage and encryption keys.
- `src/adapter/mall-reader.js`, `src/adapter/mall-writer.js`, `src/adapter/mall-id.js`, and `src/adapter/mall-xhr-probe.js` for mall context.
- `src/adapter/run-endpoint.js`, `src/adapter/endpoint-client.js`, `src/adapter/rate-limiter.js`, and `src/adapter/xhr-collector.js` for endpoint transport.
- `src/adapter/mock-dispatcher.js` before changing test seams.
- `src/infra/logger.js` before adding fields to logs or envelopes.

## External Boundaries

- Merchant backend: `https://mms.pinduoduo.com`.
- Promo reports: `https://yingxiao.pinduoduo.com`.
- Consumer login/source goods pages: `https://mobile.yangkeduo.com`.
- Goods publish category resolver: `PDD_CATEGORY_API_BASE` defaults to `https://api.gj.dangxun.com`.

Automated tests reach these boundaries through fixtures.

## Auth And Account Rules

- Resolve accounts through the database using a flag, default account, or sole account. Login creates account records; consumer slugs remain stable by uid.
- Auth state shape requires Playwright `cookies` and `origins` arrays.
- Auth writes go through the storage helpers in short transactions; keep browser/network awaits outside database transactions.
- Auth state is decrypted in memory for browser contexts; the master key uses POSIX mode `0600` and best-effort current-user Windows ACLs.
- `--all-accounts` enumerates merchant accounts in SQLite.
- Legacy JSON data is left untouched and reported by `doctor` without paths or contents; upgrading requires re-login of every account.

## Transport Rules

- Use `runEndpoint(page, spec, params, ctx)` for business APIs.
- Keep endpoint specs in `src/adapter/endpoints/` and fixture names aligned with `spec.name`.
- `EndpointClient` handles instance rate limiting, per-endpoint cooldowns, `EndpointTransportPort` dispatch (`page-api`, XHR capture, fixture), and 429 retries; consecutive-429 cooldown is shared across `--all-accounts` batches.
- Dispose XHR collectors and page sessions on every path.

## Redaction

Before logging or emitting a field that may carry a sensitive value, confirm `src/infra/logger.js` redacts it (it hashes sensitive fields; JSON emit redacts `data`/`error` recursively).

## Validation

Choose tests by affected surface:

```bash
npx vitest run test/adapter/            # transport, auth lifecycle/storage/probe, per-domain endpoint contracts
npx vitest run test/e2e/merchant-auth.e2e.test.js test/e2e/sqlite-auth-storage.e2e.test.js
npx vitest run test/services/merchant-account-storage.test.js test/infra/leases.test.js test/infra/logger-redaction.test.js
```

The rate limiter, mall switching, and XHR collector (including disposal) have no dedicated tests; add targeted tests in the same change that modifies them.

Run command-level e2e tests with the fixture adapter and a temporary `PDD_DB_PATH`.
