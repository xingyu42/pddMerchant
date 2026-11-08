---
name: pdd-adapter-auth-integration
description: Work safely on pdd-cli adapter, auth, mall context, account storage, Playwright browser automation, XHR/fetch endpoint transport, rate limits, logging redaction, QR/password login, consumer login, or external PDD/third-party integration behavior.
---

# PDD Adapter Auth Integration

Use this skill for high-risk integration paths. Prefer narrow, well-tested changes.

## Must Read

- `src/commands/_runner.js` for command execution, auth validation, mall context, account batch mode, timeout/abort, and fixture branches.
- `src/adapter/browser.js` for Playwright launch/context behavior.
- `src/adapter/auth-state.js`, `src/adapter/merchant-auth-storage.js`, `src/infra/leases.js`, and `src/infra/paths.js` for auth-state storage, account leases, and revision CAS.
- `src/infra/account-store.js`, `src/infra/account-resolver.js`, `src/infra/consumer-account-resolver.js`, and `src/infra/master-key.js` for multi-account storage and encryption keys.
- `src/adapter/mall-reader.js`, `src/adapter/mall-writer.js`, `src/adapter/mall-id.js`, and `src/adapter/mall-xhr-probe.js` for mall context.
- `src/adapter/run-endpoint.js`, `src/adapter/endpoint-client.js`, `src/adapter/xhr-collector.js`, and `src/adapter/rate-limiter-singleton.js` for endpoint transport.
- `src/adapter/mock-dispatcher.js` before changing test seams.
- `src/infra/logger.js` before adding fields to logs or envelopes.

## External Boundaries

- Merchant backend: `https://mms.pinduoduo.com`.
- Promo reports: `https://yingxiao.pinduoduo.com`.
- Consumer login/source goods pages: `https://mobile.yangkeduo.com`.
- Goods publish category resolver: `PDD_CATEGORY_API_BASE` defaults to `https://api.gj.dangxun.com`.

Treat these as integration boundaries. Tests should normally use fixtures instead of real network.

## Auth And Account Rules

- Node.js >= 24 is required. Merchant/consumer accounts and encrypted auth state share SQLite (`data/pdd.db`); `PDD_DB_PATH` overrides the database path.
- The generated `master.key` lives beside the database (default `data/master.key`). Both are sensitive: never commit them, and back up/restore them together.
- Resolve accounts through the database using a flag, default account, or sole account. Login creates account records; consumer slugs remain stable by uid.
- Auth state shape requires Playwright `cookies` and `origins` arrays.
- Auth writes use account leases + revision CAS (compare-and-swap) in short transactions through the storage helpers. Keep browser/network awaits outside database transactions.
- Auth state is decrypted in memory for browser contexts; the master key uses POSIX mode `0600` and best-effort current-user Windows ACLs.
- `--all-accounts` enumerates merchant accounts in SQLite; removal always cascades to related account data. Legacy JSON data is left untouched and reported by `doctor`; upgrading requires re-login.

## Transport Rules

- Use `runEndpoint(page, spec, params, ctx)` for business APIs.
- Keep endpoint specs in `src/adapter/endpoints/` and fixture names aligned with `spec.name`.
- `EndpointClient` handles shared rate limiting, cooldowns, trigger execution, legacy XHR collection, and fetch-path execution.
- Consecutive 429 behavior and cooldown are shared; there is no dedicated rate-limiter test, so add one before changing it.
- Dispose XHR collectors and page sessions correctly; there is currently no dedicated leak test, so verify disposal by review.

## Logging And Secrets

Never log raw cookies, Anti-Content, authorization, QR content, credentials, phone/mobile, receiver/address fields, goods images, or encrypted credential data. Existing redaction hashes sensitive fields in `src/infra/logger.js`, and JSON emit redacts data/error recursively.

## Validation

Choose tests by affected surface:

```bash
npx vitest run test/adapter/            # auth lifecycle/storage/probe/snapshot, orders contract, promo money
npx vitest run test/e2e/merchant-auth.e2e.test.js
npx vitest run test/services/merchant-account-storage.test.js
```

Rate limiter, mall switching, `run-endpoint`, and XHR collector currently have no dedicated tests; when changing them, add targeted tests in the same change.

Run relevant e2e tests with the fixture adapter and a temporary `PDD_DB_PATH` for command-level coverage.
