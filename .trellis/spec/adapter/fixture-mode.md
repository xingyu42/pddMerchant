# Fixture Mode Contract

## 1. Scope / Trigger

适用于修改 fixture adapter、mock dispatcher、endpoint fixtures、测试数据目录、`isMockEnabled()` guard，以及任何需要跳过真实浏览器/平台调用的测试 seam。

## 2. Signatures

Fixture 相关路径与 env：

```text
PDD_TEST_ADAPTER=fixture                 enable fixture mode
PDD_TEST_FIXTURE_DIR=<path>              override fixture root
src/adapter/fixtures/core.js             owns single fixture cache
src/adapter/mock-dispatcher.js           facade for mock payload routing
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
  -> PlaywrightEndpointClient.execute(spec, params, ctx)
  -> send(spec, params, ctx) -> { status, raw, response }
  -> interpretResponse(spec, { status, raw, response, url, retries })
  -> spec.normalize(raw) 或 { raw }
```

## 3. Contracts

- Endpoint fixture transport MUST work with `page: null` and skip browser/network/backend calls; existing merchant auth fixture branches retain their own lifecycle。
- Fixture responses MUST preserve the same normalized output and envelope semantics as real mode。
- `mock-dispatcher.js` is a facade; shared cache ownership stays in `fixtures/core.js`。
- New endpoint fixtures MUST be named/aligned with `spec.name`。
- Tests MUST NOT rely on fixture cache mutation leaking across test cases。
- Fixture runtime resolves the mock shop context through the adapter's `buildMallContext` (`normalizeMallRecord`), so fixture and live shop records share one shape (`{ id, name, is_current }`)。
- Fixture auth validity for needsAuth commands: invalid when `PDD_TEST_AUTH_INVALID=1` AND the account state lacks the `PDD_FIXTURE_RELOGIN=1` cookie. The read-only check needs no lease; `reloginForFixture` re-checks inside the lease and reuses a marker written by another process (one attempt for concurrent processes).
- Fixture relogin runs the same decision, attempt record, outcome record and warnings as live; the browser part remains `mockPasswordLogin()`. Success creates a branded candidate through `verifyMerchantContext` and writes `{ cookies: [PDD_FIXTURE_RELOGIN=1], origins: [], merchant_auth: { verified … } }` through `beginReloginAttempt().succeed` + `commitMerchantCandidate` under lease + CAS. Snapshot, metadata, corrupt bookkeeping and outcome follow the shared commit path, so fixture relogin needs a temporary `PDD_DB_PATH` with a seeded credential. Runner/patrol preflight still uses the shared browser-free `checkFixtureMerchantSession`, retaining its original no-record policy and cross-process recovery marker.
- Console sessions use `mockPasswordLogin()` without opening a browser, sharing the account lease, registry limits and state machine. Takeover emits a fixed decodable 1x1 JPEG; QR emits a fixed PNG data URL. Only fixture dispatch registers `POST /api/sessions/:id/fixture-complete { outcome: 'success' | 'timeout' }`; live dispatch returns 404. Success verifies a branded candidate and uses the shared attempt handle for the snapshot/manual reset/password outcome in one short transaction. Cancel and QR timeout do not increment takeover counters. See `services/domain-service-contracts.md` P4 for the full route/state contract.
- Fixture payloads for orders / goods SHOULD use the real upstream field structure with synthetic values (money in fen, unix-second times) so service views are exercised exactly as in live mode。

## 4. Validation & Error Matrix

| 条件                                     | 行为                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `PDD_TEST_ADAPTER` not `fixture`         | real adapter path may launch browser                              |
| fixture file missing for endpoint        | deterministic fixture error; no browser fallback in fixture tests |
| alternate `PDD_TEST_FIXTURE_DIR` set     | load fixtures from override directory                             |
| fixture payload simulates business error | same `PddCliError` mapping as real adapter                        |
| fixture cache stale across tests         | clear/reset via core owner, not ad-hoc module globals             |
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

### Fixture core (`src/adapter/fixtures/core.js:13-46`)

```js
export function isMockEnabled() {
  return process.env[ENV_ENABLED] === 'fixture';
}

const cache = new Map();

export function loadFixture(relPath) {
  const full = join(fixtureDir(), relPath);
  if (cache.has(full)) return cache.get(full);
  if (!existsSync(full)) {
    throw new PddCliError({
      code: 'E_FIXTURE_MISSING',
      message: `mock adapter: fixture not found at ${full}`,
      hint: `确认 ${ENV_FIXTURE_DIR} 与 fixture 文件名`,
      exitCode: ExitCodes.GENERAL,
    });
  }
  const raw = readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  cache.set(full, parsed);
  return parsed;
}

export function clearFixtureCache() {
  cache.clear();
}
```

### Env seam constants (`src/adapter/fixtures/core.js:8-11`)

```js
export const ENV_ENABLED = 'PDD_TEST_ADAPTER';
export const ENV_FIXTURE_DIR = 'PDD_TEST_FIXTURE_DIR';
export const ENV_AUTH_INVALID = 'PDD_TEST_AUTH_INVALID';
export const ENV_CONSUMER_AUTH_INVALID = 'PDD_TEST_CONSUMER_AUTH_INVALID';
```

## 9. Endpoint Transport Parity

- `PlaywrightEndpointClient.send(spec, params, ctx)` selects fixture transport by `isMockEnabled()`; live transport keeps page-api/fetch/legacy attempts and body parsing。
- Fixture transport returns HTTP status 200, a cloned upstream body and a minimal response object with `status()`; business failures should use raw error bodies to exercise `successRule`, `errorMap`/`errorMapper` and rate-limit classification。
- Both transports share HTTP 429 retry handling, `interpretResponse()`, normalization and cooldown accounting. Fixture requests skip token waiting。
- Specs without `normalize` return `{ raw }` through both transports。
- `{ __throws: true, __error: { code, message, hint, detail, exitCode } }` remains available for transport failures and explicit injected errors。
- Fixtures are named `endpoints/<spec.name>.json`; `<spec.name>.page<N>.json` takes precedence. Missing page 1 falls back to the base fixture。
- Missing later pages clone the base body and empty the array at the dotted upstream `spec.fixtureListKey` (for example `result.pageItems`), preserving envelope, totals and aggregates. Invalid list paths fail with `E_FIXTURE_SHAPE`。
- `fixtures/core.js` owns the cache; endpoint fixture reads return isolated clones. Missing fixtures fail with `E_FIXTURE_MISSING` without browser fallback。
- Regression coverage: `test/adapter/fixture-transport.test.js` compares raw 40002/54001 failures with live transport, proves normalization with a null page, raw-wrapper parity, pagination/cache isolation and cooldown accounting。
