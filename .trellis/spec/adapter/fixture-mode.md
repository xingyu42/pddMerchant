# Fixture Mode Contract

## 1. Scope / Trigger

适用于修改 fixture adapter、fixture bundle、endpoint fixtures、测试数据目录、composition root `mode: 'fixture'` 路由，以及任何需要跳过真实浏览器/平台调用的测试 seam。

## 2. Signatures

Fixture 相关路径与 env：

```text
PDD_TEST_ADAPTER=fixture                 enable fixture mode
PDD_TEST_FIXTURE_DIR=<path>              override fixture root
src/adapter/fixtures/core.js             owns instance-level FixtureStore
src/adapter/fixtures/endpoint.js         createFixtureEndpointTransport (EndpointTransportPort)
src/runtime/bundles/fixture-bundle.js    composition-root fixture bundle (composeCommandRuntime / composeDaemonRuntime)
test/fixtures/test-data.js               synthetic fixture builders (no checked-in endpoint JSON)
test/helpers/isolated-cli.js             createCliSandbox / runCli：写入临时 fixture 目录
PDD_TEST_PASSWORD_LOGIN=<outcome>        mockPasswordLogin 结果，默认 success；可取 challenge:<sms|slider|click|risk_confirm|unknown>、
                                         wrong_password、account_locked、form_changed、network_error；其他值 E_USAGE
PDD_TEST_PASSWORD_LOGIN_DELAY_MS=<ms>    每次尝试的人为延迟（并发测试），受重登预算与 signal 约束
PDD_TEST_PASSWORD_LOGIN_TRACE=<file>     每次尝试追加一行结果（0600），用于断言登录次数；不写凭据
```

Fixture 数据来源：仓库内**没有** `test/fixtures/endpoints/*.json` 文件。测试通过 `createCliSandbox(fixtures)` 把
`{ 'endpoints/<spec.name>.json': payload, ... }` 写入临时目录（`PDD_TEST_FIXTURE_DIR`），默认附带
`shops.current.json` / `shops.list.json`。`createFactResponses()` 按 research 记录的真实上游字段结构生成合成原始响应
（`createUpstreamOrder` / `createUpstreamOrderDetail` / `createUpstreamGoods` 含噪声与 PII 字段），
`createFactFixtures()` 直接保存原始响应体；执行命令时，共享 endpoint client 先判定响应，再调用 `spec.normalize()`。

Endpoint 执行链路：

```text
runEndpoint(page, spec, params, ctx)
  -> EndpointClient.call/execute(spec, params, ctx)
  -> send(spec, params, ctx) -> EndpointTransportPort.send -> { status, raw, response }
  -> interpretResponse(spec, { status, raw, response, url, retries })
  -> spec.normalize(raw, params) 或 { raw }
```

## 3. Contracts

- Endpoint fixture transport MUST work with `page: null` and skip browser/network/backend calls; existing merchant auth fixture branches retain their own lifecycle。
- Fixture responses MUST preserve the same normalized output and envelope semantics as real mode。
- `src/runtime/bundles/fixture-bundle.js` wires fixture providers when `mode === 'fixture'`; `FixtureStore` in `src/adapter/fixtures/core.js` holds per-instance fixture caches.
- New endpoint fixtures MUST be named/aligned with `spec.name`。
- Tests MUST NOT rely on fixture cache mutation leaking across test cases。
- Fixture runtime resolves the mock shop context through the adapter's `buildMallContext` (`normalizeMallRecord`), so fixture and live shop records share one shape (`{ id, name, is_current }`)。
- Fixture auth validity for needsAuth commands: invalid when `PDD_TEST_AUTH_INVALID=1` AND the account state lacks the `PDD_FIXTURE_RELOGIN=1` cookie. Runner preflight reads `AuthPort.checkMerchant` without a lease; on `rejected`, `withMerchantAuthUpdate` re-checks inside the lease and reuses a marker written by another process (one attempt for concurrent processes).
- Fixture relogin runs through the unified `auto-relogin.recover` entry using `createFixtureAuthPort` (`authoritative: false`), `createFixtureBrowserRuntime` (zero Patchright), and `fixturePasswordLogin` (`mockPasswordLogin()`). `verifyStoredMerchant` marks cached `known_rejected` hits with `authoritative: false`, and `recordMerchantCheck` skips SQLite rewrites whenever `authoritative === false` or `reason === 'known_rejected'` (keeping `revision` unchanged when patrol hits cached rejections); on success, `verifyAndSeal` creates a branded candidate and writes `{ cookies: [PDD_FIXTURE_RELOGIN=1], origins: [], merchant_auth: { verified … } }` through `beginReloginAttempt().succeed` + `commitMerchantCandidate` under lease + CAS. Snapshot, metadata, corrupt bookkeeping and outcome follow the shared commit path, so fixture relogin needs a temporary `PDD_DB_PATH` with a seeded credential.
- Fixture `goods publish` (`createFixtureSourceFetcher` in `src/runtime/bundles/fixture-bundle.js`) forces `sourceProxyEnv: {}`, ensuring offline fixture runs never call `acquireQingguoProxyLease` even when Qingguo proxy environment variables are present on the host.
- Console sessions run through `FixtureConsoleLoginDriver` (`ConsoleLoginDriverPort`) using `mockPasswordLogin()` without opening a browser, sharing the account lease, registry limits and state machine. Takeover emits a fixed decodable 1x1 JPEG; QR emits a fixed PNG data URL. Only fixture composition (`composeDaemonRuntime` `consoleExtraRoutes`) registers `POST /api/sessions/:id/fixture-complete { outcome: 'success' | 'timeout' }` backed by the driver's per-session completion latch; live composition omits it and returns 404. Success drains in-flight QR refreshes, verifies a branded candidate via `AuthPort.verifyAndSeal`, and uses the shared attempt handle for the snapshot/manual reset/password outcome in one short transaction. Cancel and QR timeout do not increment takeover counters. See `services/domain-service-contracts.md` P4 for the full route/state contract.
- Fixture payloads for orders / goods SHOULD use the real upstream field structure with synthetic values (money in fen, unix-second times) so service views are exercised exactly as in live mode。

## 4. Validation & Error Matrix

| 条件                                     | 行为                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `PDD_TEST_ADAPTER` not `fixture`         | real adapter path may launch browser                              |
| fixture file missing for endpoint        | deterministic fixture error; no browser fallback in fixture tests |
| alternate `PDD_TEST_FIXTURE_DIR` set     | load fixtures from override directory                             |
| fixture payload simulates business error | same `PddCliError` mapping as real adapter                        |
| fixture cache stale across tests         | instantiate a fresh `FixtureStore` per runtime/test; no global cache |
| `PDD_TEST_PASSWORD_LOGIN` unknown value  | `E_USAGE`（"PDD_TEST_PASSWORD_LOGIN 配置无效"）                     |
| `PDD_TEST_AUTH_INVALID=1`, no credential | original `E_AUTH_EXPIRED`; no trace line                          |

## 5. Good/Base/Bad Cases

- Good：new endpoint ships with real spec, fixture payload, and test asserting command envelope。
- Base：unit tests call normalizer directly; e2e tests use fixture adapter subprocess。
- Bad：test stubs service return value directly, bypassing adapter mock and missing envelope/exit-code behavior。

## 6. Tests Required

- E2E subprocess with `PDD_TEST_ADAPTER=fixture` for command behavior。
- Fixture dispatcher unit tests for new endpoint/error scenario。
- Regression tests for custom `PDD_TEST_FIXTURE_DIR` when adding fixture directory semantics。
- JSON purity assertions for fixture e2e stdout。

## 7. Wrong vs Correct

### Wrong

```js
if (process.env.PDD_TEST_ADAPTER) {
  return { ok: true, data: [] }; // fake envelope shape inside adapter
}
```

### Correct

```js
// Fixture 与 live 在同一个 client 中执行响应判定和归一化。
const { data } = await client.execute(spec, params, { ...ctx, page });
return data;
```

## 8. Real Code Examples

### FixtureStore (`src/adapter/fixtures/core.js`)

```js
export class FixtureStore {
  constructor({ fixtureDir, env } = {}) { /* resolves dir and creates per-instance Map cache */ }
  load(relPath) { /* reads JSON once per store instance or throws E_FIXTURE_MISSING */ }
}
```

### Composition-root env whitelist (`src/runtime/env.js`)

```js
// parseRuntimeEnv(env, { mode }) resolves mode ('live' | 'fixture') from explicit mode or
// env.PDD_TEST_ADAPTER === 'fixture' and freezes whitelisted PDD_TEST_* seams (live mode ignores them).
// FixtureStore in src/adapter/fixtures/core.js reads PDD_TEST_FIXTURE_DIR via injected fixtureDir/env.
```

## 9. Endpoint Transport Parity

- `EndpointClient.send(spec, params, ctx)` delegates to the injected `EndpointTransportPort` (`createFixtureEndpointTransport` in fixture mode; `createLiveEndpointTransport` keeps page-api/fetch/legacy attempts and body parsing)。
- Fixture transport returns HTTP status 200, a cloned upstream body and a minimal response object with `status()`; business failures should use raw error bodies to exercise `successRule`, `errorMap`/`errorMapper` and rate-limit classification。
- Both transports share HTTP 429 retry handling, `interpretResponse()`, normalization and cooldown accounting. Fixture requests skip token waiting。
- Specs without `normalize` return `{ raw }` through both transports。
- `{ __throws: true, __error: { code, message, hint, detail, exitCode } }` remains available for transport failures and explicit injected errors。
- Fixtures are named `endpoints/<spec.name>.json`; `<spec.name>.page<N>.json` takes precedence. Missing page 1 falls back to the base fixture。
- A spec MAY declare `fixtureVariantKey: '<param>'`（例如 `'goods_id'`）; the key MUST name a scalar request param (string / number), never an array or object. When the request param is present, `<spec.name>.<param value>.json` is loaded first; a missing variant file falls back to the normal page/base lookup. `__throws` in a variant fixture applies as usual. Specs without the key ignore variant files。
- Missing later pages clone the base body and empty the array at the dotted upstream `spec.fixtureListKey` (for example `result.pageItems`), preserving envelope, totals and aggregates. Invalid list paths fail with `E_FIXTURE_SHAPE`。
- `fixtures/core.js` provides `FixtureStore` for per-instance caching; endpoint fixture reads return isolated clones. Missing fixtures fail with `E_FIXTURE_MISSING` without browser fallback。
- Regression coverage: `test/adapter/fixture-transport.test.js` compares raw 40002/54001 failures with live transport, proves normalization with a null page, raw-wrapper parity, pagination/cache isolation and cooldown accounting。
