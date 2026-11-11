# Endpoint and Browser Transport Contracts

## 1. Scope / Trigger

适用于修改 `src/adapter/run-endpoint.js`、`src/adapter/endpoint-client.js`、`src/adapter/xhr-collector.js`、`src/adapter/endpoints/**`、rate-limit、business error 解析与 endpoint fixture。

## 2. Signatures

Endpoint 访问基本链路：

```text
service -> runEndpoint(page, ENDPOINT_SPEC, params, ctx)
  -> endpoint-client resolves legacy / fetch / page-api strategy
  -> legacy/fetch: navigate or trigger, then xhr-collector captures response
  -> page-api: reuse the merchant webpack signed request client in main world
  -> readBusinessError checks platform payload
  -> adapter returns payload or throws mapped PddCliError
```

Endpoint spec 最小契约 — real example from `src/adapter/endpoints/goods.js`:

```js
export const GOODS_LIST = { name: 'goodsList', match: /goodsList/ };
export const GOODS_UPDATE_STATUS = { name: 'goodsUpdateStatus', match: /goodsUpdateStatus/ };
export const GOODS_UPDATE_PRICE = { name: 'goodsUpdatePrice', match: /goodsUpdatePrice/ };
```

Service call pattern — `src/services/goods.js`:

```js
import { runEndpoint } from '../adapter/run-endpoint.js';
import { GOODS_LIST } from '../adapter/endpoints/goods.js';

export async function listGoods(page, params = {}, ctx = {}) {
  const result = await runEndpoint(page, GOODS_LIST, params, ctx);
  const goods = Array.isArray(result?.goods) ? result.goods.map(toGoodsRecord) : [];
  return { total: Number(result?.total) || 0, goods, sessionId: result?.sessionId ?? null };
}
```

## 3. Contracts

- Endpoint `spec.name` MUST match the fixture file name `endpoints/<spec.name>.json` written into the sandbox fixture dir (`PDD_TEST_FIXTURE_DIR`)。
- Adapter MUST map platform business errors before raw payload reaches service。
- Business error parser MUST support both camelCase (`errorCode`) and snake_case (`error_code`) conventions。
- Same-URL sequential calls across endpoints SHOULD use independent pages because page reuse may not fire XHR。
- Explicit `page-api` endpoints MUST provide `apiUrl` and `buildPayload`, MUST NOT require `urlPattern`, and MUST NOT silently fall back to XHR collection. Optional `nav.url` prepares the runtime, not a different transport.
- `orders.list` and `orders.stats` declare `nav.url: PDD_HOME`. Any page-api endpoint that may run on a freshly opened page (diagnose / segment open sibling pages via `page.context().newPage()`) MUST declare `nav.url`; without it the blank page has no merchant webpack runtime and fails with "page API client unavailable" (the ORDER_STATS bug that made the diagnose orders dimension always partial). Page-api initialization MUST navigate the supplied page only when its current URL is invalid or has a different origin; same-origin pagination MUST NOT reload or use page-session sibling selection.
- `orders.list` filter parameters come only from `ORDER_LIST_SCOPES` (`src/adapter/endpoints/orders.js`); callers pass `params.scope`, never raw `orderType` / `afterSaleType`. Live-verified semantics (`.trellis/tasks/10-08-orders-status-and-refund/research/order-list-filters-2026-10-08.md`): `orderType` 0=全部 1=待发货 2=已发货待收货 3=已收货; `afterSaleType` 0/-1=不过滤 1=仅无售后 2=售后处理中. Scopes: `all` 0/0 (default), `valid` 0/1 (internal sales scope), `pending_ship` 1/1, `shipped` 2/1, `received` 3/1, `after_sales` 0/2. Unknown scope → `E_USAGE`. Only add a scope after a live sample whose counts match an independent source (e.g. `statisticWithType`). `pageSize=100` is rejected upstream (`单页数据量过大或非法`, E_BUSINESS); 50 works; values in between are unverified.
- Page-api initialization MUST check cancellation/deadline before navigation, clamp navigation to `navTimeout` (default `TIMEOUTS.QUICK_NAV`) and the remaining command budget, and recalculate the request budget after navigation. Endpoints without `nav.url` retain direct execution.
- Page request clients MAY resolve to an unwrapped result or a complete business envelope. The adapter MUST produce exactly one envelope layer before endpoint normalization。
- The synthesized envelope is `{ success: true, errorCode: 0, result }`, so the success code a page-api endpoint sees is `0`, not the code captured in the browser (`1000`, `1000000` …). Every page-api `successRule` MUST accept `success: true, errorCode: 0`; prefer the default rule over explicit `codes`, and when listing `codes` include `0`. Guarded by `test/adapter/page-api-success-guard.test.js` (missed twice: #1 traffic, `experiencePlan.*`)。
- Endpoint normalizers MUST reject missing required result fields. A missing field MUST NOT be converted to business zero with `?? 0` or `?? []`。
- Normalizers are called as `spec.normalize(raw, params)` with the request params in both transports; they MAY use params to scope validation. `goodsPrice.list` / `goodsPrice.expand` strictly validate only the requested `scenes.single` / `scenes.multi` (quantity `number` only for multi) and keep other scenes as bare `{ consult_price_scene }`。
- `responseShapeError(endpoint, expected)` from `src/infra/errors.js` returns `E_NETWORK` (exit 5); expected-field descriptions MUST NOT include raw payloads. Goods list requires `result.total`, `goods_list` array and valid quantity on each item; nonnegative finite numeric strings remain accepted.
- Promo entity/hourly reports require their collection, aggregate metrics and per-row metrics (`impression`, `click`, `gmv`, `spend`/`cost`). Supported top-level/reportInfo and MoneyVO aliases remain valid. Explicit zeros and empty collections are valid only with required aggregates present; optional enrichment remains optional.
- Page runtime discovery MUST be bounded. Runtime/client absence maps to a diagnosable `PddCliError`; it is not evidence that the business result is zero。
- Rate limit behavior: 3 consecutive HTTP 429 triggers global cooldown; retry delays are `[1000, 2000, 4000]` ms。
- Business code `40002` means high-frequency or risk-control rejection with ambiguous cause, remains `E_BUSINESS`, and MUST NOT trigger rate-limit cooldown by itself。
- Raw payload debug MAY go to stderr only through `PDD_DEBUG_RAW=1` redacted JSONL; stdout envelope is unaffected。

## 4. Validation & Error Matrix

| 条件                                  | 行为                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| no XHR matched before timeout         | mapped network/timeout `PddCliError`                                     |
| page-api blank/wrong-origin page with nav.url | navigate in place before discovery; navigation failure maps to E_NETWORK |
| page-api endpoint without nav.url on a blank page | runtime/client absent → mapped network error; fix by declaring `nav.url`, never by XHR fallback |
| page-api command budget exhausted or signal aborted | E_TIMEOUT; do not start page API execution                       |
| page runtime/client not ready in bounded wait | mapped network `PddCliError`; no legacy fallback                  |
| page-api complete envelope returned   | preserve the envelope; never create `result.result`                      |
| page-api unwrapped result returned    | wrap exactly once before endpoint normalization                          |
| required order/goods/promo result field missing or invalid | fail response-shape validation; never emit fabricated zero |
| platform business error field present | mapped business/rate-limit/auth error with exit code 3/4/6 as applicable |
| HTTP 429 retryable                    | retry using configured delays; after threshold enter cooldown            |
| endpoint spec name changed            | update fixture file and tests in same change                             |
| raw payload contains sensitive fields | redact before logs/debug output                                          |

## 5. Good/Base/Bad Cases

- Good：new endpoint adds spec, fixture payload, adapter test, and service normalizer in one change。
- Base：service receives platform payload only long enough to normalize it into stable `data` shape。
- Bad：command handler filters `xhr.response.data.list` directly; this duplicates adapter/service contracts。

## 6. Tests Required

- Unit tests for `readBusinessError()` covering camelCase and snake_case。
- Fixture e2e for every new or renamed endpoint `spec.name`。
- Rate-limit tests for retry delays/cooldown without real sleeps where possible。
- XHR matching tests for same-url/sequential calls when endpoint URLs overlap。
- Page-api tests for Webpack 4/5 runtime capture, delayed readiness, bounded failure, envelope shape normalization, and no XHR fallback.
- Page-api initialization tests MUST cover blank/wrong-origin preparation, same-origin pagination without reload, no-nav direct execution, navigation failure and deadline/cancellation checks; preparation time MUST reduce the subsequent request budget.
- Order endpoint tests MUST distinguish a legitimate typed zero from absent fields。
- `orders-contract.test.js` MUST assert the default payload is `orderType: 0, afterSaleType: 0`, every `ORDER_LIST_SCOPES` mapping, unknown scope → `E_USAGE`, and that a stray `params.orderType` is ignored。
- `goods-response-shape.unit.test.js` and `promo-endpoint.unit.test.js` MUST distinguish absent/invalid required metrics from explicit zeros, empty collections and supported numeric aliases.

## 7. Wrong vs Correct

### Wrong

```js
const payload = await page.waitForResponse('/api/foo');
return JSON.parse(await payload.text());
```

### Correct

```js
const payload = await runEndpoint(ctx, fooEndpointSpec, params);
return normalizeFoo(payload);
```
