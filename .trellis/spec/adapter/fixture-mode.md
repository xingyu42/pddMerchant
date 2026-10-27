# Fixture Mode Contract

## 1. Scope / Trigger

适用于修改 fixture adapter、mock dispatcher、endpoint fixtures、测试数据目录、`isMockEnabled()` guard，以及任何需要跳过真实浏览器/平台调用的测试 seam。

## 2. Signatures

Fixture 相关路径与 env：

```text
PDD_TEST_ADAPTER=fixture                 enable fixture mode
PDD_TEST_FIXTURE_DIR=<path>              override fixture root
src/adapter/fixtures/core.js             owns single fixture cache
src/adapter/fixtures/mock-dispatcher.js  facade for mock payload routing
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
`createFactFixtures()` 先跑真实 `spec.normalize()` 再写入，因此 fixture 即 service-facing 形状。

典型 fixture branch：

```js
if (isMockEnabled()) {
  return dispatchMockEndpoint(spec.name, params);
}
return runRealEndpoint(ctx, spec, params);
```

## 3. Contracts

- Fixture mode MUST skip real browser, network, auth state and platform backend calls。
- Fixture responses MUST preserve the same normalized output and envelope semantics as real mode。
- `mock-dispatcher.js` is a facade; shared cache ownership stays in `fixtures/core.js`。
- New endpoint fixtures MUST be named/aligned with `spec.name`。
- Tests MUST NOT rely on fixture cache mutation leaking across test cases。
- Fixture runtime resolves the mock shop context through the adapter's `buildMallContext` (`normalizeMallRecord`), so fixture and live shop records share one shape (`{ id, name, is_current }`)。
- Fixture auth validity for needsAuth commands: invalid when `PDD_TEST_AUTH_INVALID=1` AND the account state lacks the `PDD_FIXTURE_RELOGIN=1` cookie. The read-only check needs no lease; `reloginForFixture` re-checks inside the lease and reuses a marker written by another process (one attempt for concurrent processes).
- Fixture relogin runs the same decision, attempt record, outcome record and warnings as live; only the browser part is `mockPasswordLogin()`. Success writes `{ cookies: [PDD_FIXTURE_RELOGIN=1], origins: [], merchant_auth: { verified … } }` under lease + CAS, so fixture relogin needs a temporary `PDD_DB_PATH` with a seeded credential.
- Console sessions use `mockPasswordLogin()` without opening a browser, sharing the account lease, registry limits and state machine. Takeover emits a fixed decodable 1x1 JPEG; QR emits a fixed PNG data URL. Only fixture dispatch registers `POST /api/sessions/:id/fixture-complete { outcome: 'success' | 'timeout' }`; live dispatch returns 404. Success reuses `commitFixtureRelogin` plus manual-login/outcome helpers in one short transaction. Cancel and QR timeout do not increment takeover counters. See `services/domain-service-contracts.md` P4 for the full route/state contract.
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
if (isMockEnabled()) {
  return dispatchMockEndpoint(spec.name, params);
}
return runRealEndpoint(ctx, spec, params);
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

## 9. Fixture/Live Parity Diagnostics

### 1. Scope / Trigger

适用于新增或修改 endpoint spec、endpoint fixture、`runEndpoint()` fixture branch、`FixtureEndpointClient`，或任何会影响 fixture mode 与 live mode 数据形状一致性的改动。

### 2. Signatures

诊断入口：

```js
validateFixtureParity(spec, {
  fixtureNames,    // Set<string> or string[]
  fixturePayloads, // Map<spec.name, payload> or plain object
});

collectFixtureParityDiagnostics(specs, options);
flattenFixtureParityWarnings(reports);
```

运行时 seam：

```text
runEndpoint(..., spec, ..., ctx) + PDD_TEST_ADAPTER=fixture
  -> mockRunEndpoint(spec, params, ctx) directly

FixtureEndpointClient.execute(spec, params, ctx)
  -> mockRunEndpoint(spec, params)
  -> spec.normalize(raw)
  -> { data, meta }
```

### 3. Contracts

- `runEndpoint()` 的 fixture branch MUST remain a direct `mockRunEndpoint()` short-circuit unless an OpenSpec-backed runtime change says otherwise.
- `runEndpoint()` fixture branch MUST NOT acquire rate-limiter tokens, launch browser, read auth state, or call the platform backend.
- `FixtureEndpointClient.execute()` is a separate client-contract seam and MAY return data after `spec.normalize()`.
- A warning that direct fixture payload differs from client-normalized payload is not automatically a failure only when the endpoint spec explicitly declares `fixtureIsServiceFacing: true`; without that marker, a thrown live normalizer remains a parity error.
- New endpoints SHOULD get a synthetic base fixture builder (written by tests as `endpoints/<spec.name>.json` into the sandbox fixture dir); if intentionally absent, document why in task/spec notes.
- Page-specific endpoint fixtures such as `<spec.name>.page2.json` SHOULD declare `spec.fixtureListKey` when page synthesis beyond checked-in pages is expected.

### 4. Validation & Error Matrix

| 条件 | 诊断行为 |
| --- | --- |
| endpoint spec has hard validation errors | `ENDPOINT_SPEC_ERROR` as error |
| base fixture missing | `MISSING_BASE_FIXTURE` as warning |
| page fixture exists without `fixtureListKey` | `PAGINATED_FIXTURE_WITHOUT_LIST_KEY` as warning |
| `spec.isSuccess()` throws for base fixture | `FIXTURE_IS_SUCCESS_THREW` as error |
| base fixture is not accepted by live raw-response success check | `BASE_FIXTURE_NOT_LIVE_SUCCESS` as warning |
| `spec.normalize()` throws or returns `undefined` | `FIXTURE_NORMALIZE_THREW` / `FIXTURE_NORMALIZE_UNDEFINED` as error |
| direct fixture payload differs from client-normalized payload | `FIXTURE_CLIENT_DATA_DIFFERS` as warning |

### 5. Good/Base/Bad Cases

- Good：endpoint spec、base fixture、page fixture、`fixtureListKey` 与 service normalizer 一起更新，并有 parity diagnostic test。
- Base：legacy fixture stores service-facing normalized data, the spec declares `fixtureIsServiceFacing: true`, diagnostics report warning and runtime behavior remains unchanged。
- Bad：为了消除 warning 直接把 `runEndpoint()` fixture branch 改为走 `FixtureEndpointClient`，导致 limiter/client/browser 相关契约被无意改变。

### 6. Tests Required

- Unit test for `collectFixtureParityDiagnostics()` over all exported endpoint specs。
- Contract test proving `runEndpoint()` fixture mode does not acquire limiter tokens。
- Regression test for expected current drift warnings when intentionally tolerated。
- Existing endpoint validator and strategy resolver tests must keep sharing the same endpoint spec collection list。

### 7. Wrong vs Correct

#### Wrong

```js
// Hides drift by changing runtime behavior inside a diagnostics-only task.
if (isMockEnabled()) {
  return new FixtureEndpointClient().execute(spec, params, ctx);
}
```

#### Correct

```js
// Keep runtime branch stable; add diagnostics/tests around the known seam.
if (isMockEnabled()) {
  return mockRunEndpoint(spec, params, ctx);
}
```
