# Goods Publish Contract

## 1. Scope / Trigger

适用于修改商品发布与选品链路：`src/services/goods-publish.js`、`src/services/goods-publish-source-cache.js`、`src/adapter/goods-publish/**`、`src/adapter/endpoints/goods-publish.js`、`docs/goods-publish-api-recon.md` 相关实现。

## 2. Signatures

典型流程：

```text
goods publish command
  -> resolve cost template and source cache
  -> scrape/normalize source only on cache miss
  -> validate source evidence and resolve category
  -> create merchant draft, load property template, fill and verify form
  -> save verified draft
  -> draftOnly returns OR --confirm calls submit endpoint
  -> stable publish result
```

重要 env：

```text
PDD_SCRAPE_SIMULATE=0                  disable human-behavior simulation
PDD_SCRAPE_SOFTBLOCK_THRESHOLD=<n>     consecutive soft-block hits before cooldown; default 2
PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS=<ms>  cooldown duration; default 7200000
```

冷却状态：`data/scrape-cooldown.json`。

## 3. Contracts

- `draftOnly: true` MUST still create and verify the merchant draft; it skips only the final submit endpoint。
- Without explicit cost-template selection, the service MAY use `templates[0]` only after verifying the normalized template list is present and non-empty。
- Normalizers MUST strip raw platform-only keys and return stable schema for envelope `data`。
- When no valid temporary source cache exists, source-scrape IP soft-block cooldown MUST short-circuit before issuing the source request。
- Logs/output MUST redact sensitive media/contact fields such as `goods_image`、`phone`、`addr`、receiver fields。
- Source empty-shell (`_fiberFound === false && _appWall === true`) MUST be classified before missing price/SKU. It is an IP/page degradation signal, not consumer-account degradation, and MUST NOT delete consumer auth.
- Multi-SKU form fill MUST fail before any page mutation unless source data provides per-SKU price/stock plus a verified dimension-to-row mapping. Never silently fall back to single-SKU fields.
- Detail-image upload MUST verify the detail input exists, match one distinct completion response per file, warn on partial completion, and stop the save flow when every image fails.
- Platform business/rate-limit errors MUST map to existing `PddCliError` / `ExitCodes` rather than new ad-hoc codes。

## 4. Validation & Error Matrix

| 条件                                    | 行为                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| no cost templates available             | business error with hint, no draft/save/submit                        |
| `draftOnly: true`                       | create and verify draft, return `status: draft`, no submit endpoint   |
| source scrape hits soft-block threshold | enter cooldown and return mapped soft-block/rate-limit/business error |
| cooldown active                         | short-circuit before request, include retry/cooldown hint             |
| platform code is rate limiting          | map to `ExitCodes.RATE_LIMIT` where applicable                        |
| malformed source/product input          | usage/business error before endpoint writes                           |
| source empty shell                      | `E_RATE_LIMIT`, record soft-block cooldown, keep consumer auth         |
| multi-SKU without verified row mapping  | `E_BUSINESS` before any form mutation                                 |
| detail image partial/all failure        | warning on partial; `E_BUSINESS` when none complete                   |

## 5. Good/Base/Bad Cases

- Good：assemble and verify a draft from normalized source data, return draft status by default, and submit only when the caller explicitly requested `--confirm`。
- Base：cost-template fallback uses the first normalized template after validating the list。
- Bad：always calling submit and then labeling response as dry-run; this violates write safety。

## 6. Tests Required

- Unit tests for payload normalizers, template fallback, cooldown state handling。
- Fixture tests proving draft-only saves/verifies a draft but does not call submit。
- Regression tests for soft-block threshold/cooldown env defaults and overrides。
- Redaction tests ensuring media/contact fields do not appear raw in logs/debug output。
- Regression tests asserting empty shell cannot become `E_RISK_CONTROL_SOFT`, multi-SKU stops before page access, and detail uploads consume distinct responses.

## 7. Wrong vs Correct

### Wrong

```js
if (options.draftOnly) return { source, status: 'draft' }; // no merchant draft was saved
return submitGoods(ctx, source);
```

### Correct

```js
const draft = await createAndFillDraft(normalizeSource(rawSource));
await saveAndVerifyDraft(draft);
if (options.draftOnly) return { goods_id: draft.goodsId, status: 'draft' };
await submitGoods(ctx, draft);
return { goods_id: draft.goodsId, status: 'submitted' };
```

## 8. Scenario: Qingguo Short-Lived Proxy For Source Fetch

### 8.1 Scope / Trigger

Use this contract when changing `goods publish --url` consumer-side source scraping, `src/adapter/goods-publish/qingguo-proxy.js`, consumer context proxy options, or source-scrape retry/cooldown behavior. The proxy boundary MUST NOT spread to merchant draft, form-fill, save, submit, or unrelated commands.

### 8.2 Signatures

```text
PDD_SOURCE_PROXY_PROVIDER=qingguo
PDD_QINGGUO_AUTH_KEY=<extraction-auth-key>
PDD_QINGGUO_AREA=<optional-six-digit-area-codes>
```

```js
const lease = await acquireQingguoProxyLease(config, { signal: ctx.signal });
await createConsumerContext(browser, {
  storageStatePath,
  proxy: { server: lease.server },
});
```

Consumer login and source fetching inherit the same host-platform browser RuntimeProfile by default. The flow MUST NOT save a desktop login snapshot and then reuse it under an iPhone UA, mobile viewport, or caller-defined fingerprint profile.

### 8.3 Contracts

- Default is direct source scraping; only provider value `qingguo` enables proxy mode.
- A valid temporary source cache is resolved before proxy configuration. Cache hits MUST bypass provider validation, lease acquisition, consumer Context creation, and source-page requests because no live source fetch is needed.
- `PDD_QINGGUO_AREA` optionally filters extraction by one or more comma-separated six-digit area codes. When unset, extraction remains random-area.
- Proxy mode is fail-closed. Configuration, acquisition, or connection failure MUST NOT retry through direct networking.
- Each attempt acquires one lease and creates one fresh consumer context. Leases and contexts MUST NOT be reused across attempts or products.
- The shared consumer auth snapshot is read-only; proxy attempts MUST NOT persist storage state.
- Maximum attempts are 3, but only proxy infrastructure failures consume retry attempts. Infrastructure failures back off 500ms then 1000ms using the command abort signal.
- `captcha`, `slider`, `risk-modal`, `E_AUTH_EXPIRED`, proxy auth/quota/rate-limit, abort, and unknown program errors stop immediately.
- Missing price or SKU confirms consumer-account degradation on the first occurrence. The fetch MUST stop, permanently remove the current consumer auth snapshot, and MUST NOT update the global scrape cooldown. Recovery requires another consumer account login.
- A successful consumer login clears any previous source-scrape cooldown so the replacement account may make one immediate fetch attempt.
- Empty-shell failures stop immediately and do not rotate to another proxy. Successful scraping keeps the existing `recordSuccess()` behavior.
- Chromium may surface an upstream Qingguo HTTP 407 as `ERR_TUNNEL_CONNECTION_FAILED`; for this provider it maps to `E_PROXY_AUTH` and stops after one lease.
- Retry recovery adds `source_proxy_retry_recovered` through the command reserved `warnings` channel so it reaches `meta.warnings`.
- Proxy node, port, extraction AuthKey, and raw provider response MUST NOT enter envelope data/errors or logs. Proxy node username/password authentication is not configured in the first version. Verbose logs may contain provider, attempt, area, ISP, remaining milliseconds, result code, and hashed request ID.

### 8.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| provider missing | direct path unchanged |
| provider unsupported or credentials incomplete on cache miss | `E_USAGE`, before cost-template, proxy, or PDD live requests |
| invalid key, permissions, HTTP 401/403/407 | `E_PROXY_AUTH`, exit 3, no retry |
| balance or extraction quota exhausted | `E_PROXY_QUOTA`, exit 6, no retry |
| provider rate limit | `E_PROXY_RATE_LIMIT`, exit 4, no retry |
| no resource, provider 5xx, acquisition timeout | `E_PROXY_UNAVAILABLE`, exit 5, retry within budget |
| proxy tunnel/connection timeout or refusal | `E_PROXY_NETWORK`, exit 5, retry within budget |
| `ERR_TUNNEL_CONNECTION_FAILED` from Qingguo | `E_PROXY_AUTH`, exit 3, no retry |
| missing price/SKU or `E_RISK_CONTROL_SOFT` | remove consumer auth snapshot and stop immediately; no global cooldown update |
| empty-shell | stop immediately; no proxy rotation |
| retry succeeds on attempt 2 or 3 | success envelope plus `meta.warnings += source_proxy_retry_recovered` |

### 8.5 Good / Base / Bad Cases

- Good: proxy mode acquires a fresh lease for each consumer context, succeeds on attempt 2, closes both contexts, and emits only a recovery warning.
- Base: provider is unset and the original single direct consumer context path runs unchanged.
- Bad: proxy acquisition fails and code silently calls the direct scraper; this violates fail-closed behavior and can burn the blocked local exit.

### 8.6 Tests Required

- Adapter unit: disabled/complete/incomplete config, optional area normalization/validation, provider error mapping, fixed `num=1&distinct=true`, deadline protection, abort propagation, and no raw request ID.
- Browser unit: optional proxy reaches only `browser.newContext()` and partial initialization closes the context.
- Service unit: fresh contexts across infrastructure retries, recovery warning, first degradation stops, auth snapshot removal, and cleanup failure is fail-closed.
- Service unit: empty shell keeps consumer auth, and tunnel-auth classification acquires only one lease.
- Command fixture e2e: publish warnings live in `meta.warnings`, JSON stdout remains one envelope, and `data` does not own the warnings channel.
- Full `npm test` is required because this changes adapter, service, command, envelope warnings, and shared browser context code.

### 8.7 Wrong vs Correct

#### Wrong

```js
try {
  return await scrapeWithProxy();
} catch {
  return scrapeDirect(); // leaks out of the fail-closed boundary
}
```

#### Correct

```js
const source = proxyConfig.enabled
  ? await scrapeWithFreshProxyContexts(ctx, goodsId, proxyConfig)
  : await scrapeDirect(ctx, goodsId);
```

## 9. Scenario: Temporary Source Cache For Failed Publish Retries

### 9.1 Scope / Trigger

Use this contract when changing `publishGoodsFromLink()`, source-scrape ordering, goods-publish retry behavior, or files under `tmp/goods-publish-source-cache/`. The cache is a short-lived retry aid, not a durable product catalog.

### 9.2 Signatures

```js
const cache = createSourceGoodsCache({
  cacheDir: GOODS_PUBLISH_SOURCE_CACHE_DIR,
});

await cache.read(goodsId);          // valid source object or null
await cache.write(goodsId, source); // atomic versioned JSON write
await cache.remove(goodsId);        // true when removed, false when absent
```

```text
tmp/goods-publish-source-cache/<numeric-goods-id>.json
```

### 9.3 Contracts

- Cache keys MUST be normalized numeric `goods_id` values; URL form and plain-ID form share one file.
- Cache reads MUST happen before source cooldown and Qingguo configuration checks. A hit skips consumer Context creation, proxy acquisition, and source-page requests, but merchant auth, mall context, cost template, category, draft, and optional submit still run.
- Only a successful, validated live scrape may be cached. Cache version `4` persists the stable projection including `goodsID`, title, category IDs, carousel/detail image URLs, positive integer `sourceReferencePriceCents`, bounded `goodsProperties`, `skuDimensions`, and normalized `skus[]` (`sourceSkuId`, `specValues`, positive group/single price cents, non-negative stock, `thumbUrl`). Old cache versions, including v3 without properties/SKU previews, are misses. Diagnostic `_` fields, cookies, AuthKey, proxy data, and request IDs MUST NOT be written.
- Writes MUST use a same-directory temporary file plus `rename`. Read/write failures are optimization failures and MUST fall back or continue without changing the publish result.
- Any failure after a successful scrape keeps the cache for the next retry.
- Draft mode removes the cache only after verified draft save. `--confirm` mode removes it only after submit succeeds.
- Cleanup failure after platform success MUST NOT turn success into failure or trigger another write. Add `source_cache_cleanup_failed` through the reserved warnings channel.
- Fixture mode MUST NOT read or write this real cache directory.

### 9.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| cache file missing | live source scrape |
| invalid key, JSON, version, goods ID, reference price, properties, SKU preview, SKU, or required fields | treat as miss; live scrape may replace it |
| cache read filesystem error | redacted warning, then live scrape |
| live source scrape fails | no cache write |
| cache write fails after valid scrape | continue current publish with live data |
| category/form/draft/submit fails | keep cache for retry |
| verified draft save succeeds | remove cache before returning draft success |
| confirmed submit succeeds | remove cache before returning submitted success |
| cache cleanup fails after success | return success plus `source_cache_cleanup_failed` |

### 9.5 Good / Base / Bad Cases

- Good: scrape succeeds, form save fails, retry reuses the cache without cooldown/proxy/browser work, then verified draft save removes the file.
- Base: cache is absent, live scrape and publish succeed, and the just-written cache is removed in the same command.
- Bad: delete the cache immediately after scrape; a later image/form/save failure then forces the retry to scrape again and defeats the feature.

### 9.6 Tests Required

- Cache unit: missing file, v4 round-trip, v3 rejection, numeric key safety, whitelist projection, corrupt payload, missing/non-strict reference price/properties/SKU preview rejection, masked price/missing SKU rejection, overwrite, and per-goods removal.
- Service unit: cache hit occurs before cooldown/proxy/consumer Context; downstream failure keeps data; retry reads once and does not scrape twice; draft and submit success remove data.
- Failure unit: read/write failures do not block publish; cleanup failure preserves success and emits only `source_cache_cleanup_failed`.
- Fixture/contract regression: fixture mode and single-line JSON envelope remain unchanged.

### 9.7 Wrong vs Correct

#### Wrong

```js
const source = await scrapeSourceGoods(page, goodsId, ctx);
await sourceCache.remove(goodsId); // removes retry data before the publish outcome is known
await fillAndSaveDraft(source);
```

#### Correct

```js
const source = await sourceCache.read(goodsId) ?? await scrapeAndCache(goodsId);
const result = await fillAndSaveOrSubmit(source);
await clearCacheWithoutReversingSuccess(goodsId, result.warnings);
return result;
```

## 10. Scenario: Structured SKU Fill And Draft Verification

### 10.1 Scope / Trigger

Use this contract when changing source-page SKU extraction, per-SKU pricing, merchant specification selection/table filling, the draft edit route, or post-save draft-detail verification. These layers form one write-safety boundary and MUST be changed together when their schema changes.

### 10.2 Signatures

```js
normalizeSourceSkuSnapshot(rawSource) -> {
  complete,
  issues,
  sourceReferencePriceCents,
  skuDimensions: [{ name, values: [{ id, text }] }],
  skus: [{ sourceSkuId, specValues, sourcePriceCents, sourceNormalPriceCents, stock, thumbUrl }],
}

raw PDD SKU price fields:
  groupPrice: yuan decimal -> sourcePriceCents
  normalPrice: yuan decimal -> sourceNormalPriceCents

raw PDD goods reference-price field:
  linePrice: yuan decimal -> sourceReferencePriceCents

buildPricingPlan(source) -> {
  marketPrice,
  skuPricing: [{ sourceSkuId, specValues, groupPrice, singlePrice, stock }],
}

validateDraftEditPayload(body, {
  expectedCostTemplateId,
  expectedSkuPricing,
  expectedPropertyPlan,
  expectedSkuPreviewPlan,
}) -> { ok, issues, summary: {
  gallery_count, goods_property_count, sku_count, sku_thumb_count
} }

normalizeDraftDetailResponse(response) -> {
  available,
  data,
  observation,
}
```

### 10.3 Contracts

- Runtime source traversal MUST be bounded (depth, visited objects, dimension/value/SKU counts), require the requested `goods_id`, and prefer an exact target candidate with a non-empty SKU array. A recommendation product or array position is never a valid substitute.
- Runtime extraction MUST run in the page main world and inspect both `window.rawData` and bounded React expando roots. Recognized MobX observable-value wrappers may be unwrapped through `.value`; MobX observable arrays must be copied through their iterator instead of relying only on `Array.isArray()`.
- PDD SKU specifications may arrive as `specs[].spec_key/spec_value`. When the parent dimension arrays contain only numeric IDs, dimensions MUST be derived from the complete per-SKU specification records. A detached exact-target SKU set may replace the parent array only when its unique SKU count exactly covers the non-empty parent SKU count.
- Raw PDD `groupPrice` and `normalPrice` are yuan values, whether encoded as strings or numbers. Normalization MUST accept only unsigned decimal values with at most two fractional digits and convert them exactly to integer cents; raw integer `15` means 15 yuan / 1500 cents. Already-normalized `sourcePriceCents` and `sourceNormalPriceCents` remain integer-cent fields and MUST NOT be multiplied again.
- Every source SKU requires both a positive `sourcePriceCents` and a positive `sourceNormalPriceCents`. Draft group price MUST equal `sourcePriceCents / 100`, and draft single price MUST equal `sourceNormalPriceCents / 100`; neither sale price may receive a markup multiplier.
- The source goods top-level `linePrice` is a yuan value and MUST be normalized exactly to the stable integer-cent field `sourceReferencePriceCents`. Draft reference/market price MUST equal `sourceReferencePriceCents / 100`. Per-SKU `marketPrice` is not this contract (the observed target value was `0`) and MUST NOT be used as a fallback.
- `sourceReferencePriceCents` MUST be positive and strictly greater than every SKU `sourceNormalPriceCents`. Missing, non-positive, malformed, or non-strict values make the source snapshot incomplete before merchant draft creation. The previous `group price * 1.8` derivation MUST NOT be restored.
- Multi-SKU completeness requires explicit, unique `specValues`, a positive integer price in cents, and non-negative integer stock for every SKU. Stock `0` is valid and MUST NOT become missing/default stock.
- A generic “open in app” banner is only supporting evidence of masking when the structured SKU snapshot is incomplete. It MUST NOT override an exact-target snapshot that already passes price, stock, dimension, and combination validation.
- Missing structured SKU evidence MUST fail before `selectCategory()` with `E_SOURCE_SKU_UNAVAILABLE`; no unified minimum price, guessed Cartesian order, or magic inventory is allowed.
- Merchant dimensions MAY be selected only through verified standard color/size controls. SKU table rows MUST be matched by normalized visible specification values, including safe unit normalization such as `110cm` to `110`; index order is not a fallback.
- Standard-color search MUST dispatch real keyboard events and use a bounded retry because `fill()` alone does not open the live suggestion menu and the menu data may load after the input appears. Only one exact normalized color match may be selected.
- The live merchant SKU grid may render its header and body as sibling tables. Semantic headers and body rows MUST be located through their shared `TB_outerWrapper`; whole-page table or input indexes are not stable contracts.
- Stock, group price, and single price MUST be filled sequentially inside the matched row by semantic table columns using Playwright `fill()`, then read back. Parallel writes race with React row re-rendering and can concatenate one field into another. Decimal formatting differences such as `14.70` and `14.7` MAY compare numerically, but an empty or non-numeric readback MUST fail. Reference price uses its dedicated selector.
- The detail-image input MUST be the unique input under the `quick_decoration` region. Never select it by its whole-page ordinal because per-SKU preview inputs change that ordinal. Upload completion accepts only successful 2xx responses from the legacy `upload_complete` path or the current `file.pinduoduo.com/v3/store_image` endpoint, with one distinct response per file.
- Before `route.continue()`, the draft edit JSON MUST contain title, non-empty `gallery`, the selected cost template, the exact SKU count/combinations, positive prices, and non-negative stock. Failure aborts the route and exposes only issue codes plus counts.
- Draft-detail HTTP/business failure, `result=null`, or an unavailable result produces `draft_verification_unavailable`; it MUST NOT produce `title_empty`, `no_images`, or `no_cost_template`. A successful normalized detail object with genuinely missing fields still fails strict verification.
- `draftOnly` remains the default. Submit may run only after source, form, edit-payload, save-response, and any available strict detail validation have passed.
- Source diagnostic errors/logs may expose counts and stable issue codes, but MUST strip query parameters such as consumer `uin`; record only a non-sensitive pathname when page location is needed.

### 10.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| target source has no complete structured SKU snapshot | `E_SOURCE_SKU_UNAVAILABLE` before merchant draft creation |
| source `groupPrice`/`normalPrice` is missing, non-positive, currency-formatted, or has more than two decimals | issue `sku_price_invalid` / `sku_normal_price_invalid`; fail before merchant draft creation |
| source `linePrice` is missing, non-positive, currency-formatted, or has more than two decimals | issue `source_reference_price_invalid`; fail before merchant draft creation |
| normalized reference price is not strictly greater than the maximum SKU single-buy price | issue `source_reference_price_not_above_single`; fail before merchant draft creation |
| React state only exposes an empty/reduced parent SKU array | fail closed unless a complete exact-target detached set covers the same SKU count |
| SKU dimensions/count/combination duplicate or mismatch | fail closed; no guessed ordering/defaults |
| unsupported merchant specification type or non-unique color/size match | `E_BUSINESS` before draft save |
| color suggestion data remains absent or does not have one exact match after bounded retries | `E_BUSINESS` before draft save |
| detail-image input is missing/non-unique, or every upload completion response fails/times out | `E_BUSINESS`, do not save |
| SKU row/value readback mismatch | `E_BUSINESS`, do not click/save |
| draft edit payload title/gallery/template/SKU invalid | abort request before `route.continue()` |
| platform save response unsuccessful | `E_BUSINESS`, never submit |
| detail query business/transport/result unavailable | warning `draft_verification_unavailable`, no false field-empty issues |
| detail query succeeds and confirms a required field missing | strict `E_BUSINESS`, never submit |

### 10.5 Good / Base / Bad Cases

- Good: exact target source has `linePrice="59"`; each SKU has `groupPrice="14.7"`, `normalPrice="25.8"`, and stock `0` or greater. Normalization produces reference/group/single prices 5900/1470/2580 cents, and the draft writes `59.00`/`14.70`/`25.80` without a multiplier.
- Base: a true single-SKU source has `specValues: {}` plus a positive `linePrice` strictly above its `normalPrice`, and still fills/read-backs stock, group price, single price, and reference price through the same row contract.
- Bad: derive reference price as group price times `1.8`, use per-SKU `marketPrice=0`, use the DOM minimum price for every SKU, or assign inventory `999`.

### 10.6 Tests Required

- Normalizer unit: yuan decimals and raw integer yuan to exact cents, explicit cent fields without reconversion, `linePrice -> sourceReferencePriceCents`, missing/non-positive/non-strict reference price, invalid fractional/currency values, required normal price, explicit multi-SKU mapping, stock zero, missing mapping/stock, duplicate combinations, and traversal/size limits.
- Runtime adapter unit: MobX wrapper/iterable arrays, `spec_key/spec_value`, exact-target detached SKU coverage, recommendation exclusion, generic APP banner with complete structured data, and query-parameter redaction.
- Pricing unit: exact source group/single/reference price propagation without markup, reference price strictly above every single price, different per-SKU prices, stock zero, invalid price/normal-price/reference-price/stock, duplicate and missing specification mappings.
- Form unit: semantic column lookup, split header/body wrapper, out-of-order row matching, `cm` normalization, sequential row writes, numeric decimal readback, single-SKU fill/readback, and fail-closed ambiguous mapping.
- Image unit: unique semantic detail input, legacy/current completion paths, 2xx-only completion, distinct response consumption, partial completion, and all-failed stop.
- Route unit: invalid outgoing SKU payload calls `abort`, never `continue`, and always removes the handler.
- Detail regression: nested success, flat success, business failure, `result=null`, transport failure, true missing fields, and cost-template mismatch.
- Fixture: structured multi-SKU fixture, draft-only never submits, JSON envelope remains one line.
- Real verification: one non-`--confirm` run, then read-only browser cross-check of title, images, template, every specification combination, prices, and stock.

### 10.7 Wrong vs Correct

#### Wrong

```js
const price = readDisplayedMinimumPrice(page);
for (const row of skuRows) {
  await row.inputs[0].fill(price);
  await row.inputs[1].fill(price);
}
const groupPrice = sourcePrice * 1.02;
const singlePrice = sourcePrice * 1.15;
collectDraftIssues(detailResponse.result); // even when success=false/result=null
```

#### Correct

```js
const projected = projectBoundedMainWorldState({
  roots: [window.rawData, ...reactExpandoRoots],
  unwrapRecognizedMobxValues: true,
  requireExactGoodsId: true,
});
const source = normalizeSourceSkuSnapshot(projected);
if (!source.complete) throw sourceSkuUnavailable(source.issues);

const pricing = buildPricingPlan(source);
// groupPrice === sourcePriceCents / 100
// singlePrice === sourceNormalPriceCents / 100
// marketPrice === sourceReferencePriceCents / 100
// sourceReferencePriceCents came from top-level linePrice, never SKU marketPrice or a multiplier
await fillRowsBySpecificationValue(page, pricing.skuPricing);

const checked = validateDraftEditPayload(outgoingBody, {
  expectedCostTemplateId,
  expectedSkuPricing: pricing.skuPricing,
  expectedPropertyPlan,
  expectedSkuPreviewPlan,
});
if (!checked.ok) await route.abort('failed');

const detail = normalizeDraftDetailResponse(detailResponse);
if (!detail.available) warnings.push('draft_verification_unavailable');
```

## 11. Scenario: Structured Properties And SKU Color Preview Images

### 11.1 Scope / Trigger

Use this contract when changing consumer `goodsProperty` projection, merchant property-template matching, property controls, SKU `thumbUrl`, color preview upload, size-chart state, or the draft edit payload. These fields form one cross-layer write-safety boundary.

### 11.2 Signatures

```js
normalizeSourceGoodsProperties(raw) -> [{
  name, values, refPid, referenceId,
}]

buildPropertyPlan(goodsProperties, merchantTemplate) -> {
  ok, issues, warnings, skippedCount, propertysTid,
  plan: [{
    templateModuleId, templatePid, pid, refPid, name,
    required, important, controlType, valueType, chooseMaxNum,
    values: [{ vid, value }],
  }],
}

buildSkuPreviewPlan({ skuDimensions, skus }) -> {
  ok, issues,
  plan: [{ merchantColor, sourceImageUrl }],
}

readDynamicPropertyTemplate(page, baseTemplate) -> {
  ok, issues, propertysTid,
  properties: [...baseProperties, ...visibleDynamicProperties],
}

disableSizeChart(page) -> {
  changed: boolean,
  disabled: true,
}

validateDraftEditPayload(body, {
  expectedPropertyPlan,
  expectedSkuPreviewPlan,
}) -> { ok, issues, summary }
```

The merchant template source is the same-origin internal endpoint
`GET /draco-ms/mms/template/mall`; it is not a public stable Open API.

### 11.3 Contracts

- Consumer traversal MUST project bounded structured `goodsProperty` and per-SKU `thumbUrl` only from the exact target goods object. Detail text is diagnostic and MUST NOT become an attribute fallback.
- Missing structured properties or a complete one-image-per-color preview plan MUST fail before `selectCategory()`.
- The merchant template normalizer MUST accept both the direct template object and the live success envelope `{ success: true, error_code: 1000000, result: template }`. A failed envelope or missing `result.modules` remains invalid. `propertysTid` comes from the template root `id`, not a module ID.
- A `control_type=0` free-input property MAY omit its candidate `values`; enumerated `control_type=1` properties still require candidate values. The plan MUST retain `controlType`, `valueType`, and `chooseMaxNum` so form fill and payload validation use the same machine contract.
- Template `required` comes only from `required === true`; `important` comes only from `is_important === true`. Display DOM text such as `<span>重要</span>` is readback evidence, not the machine contract.
- Property matching order is unique non-empty `refPid`, then unique exact normalized full name. The only production one-to-many alias is `面料/材质 -> [面料俗称, 材质]`; each target and its candidate value MUST still be unique in the current category form model. If the initial template exposes only one target, map only that target until the official UI reveals another row. No contains/edit-distance/pinyin/index/first-option fallback is allowed.
- Values match unique exact normalized template candidates. `棉/棉` may collapse to `棉` only when every non-empty slash segment is identical. A property is atomic: no partial value fill.
- Unmapped `required` or `important` properties stop before form fill. Optional failures add one `property_mapping_partial` warning and skip the whole property.
- Merchant attributes MAY be dependency-driven: selecting `面料俗称=棉` can reveal `材质` and required `成分含量` immediately on the same page. This dependency MUST be triggered by Playwright's trusted locator pointer click. A scripted `element.click()` can change the visible selection without firing the merchant form's dependent-property chain and is forbidden for property options.
- The initial `GET /draco-ms/mms/template/mall` response does not contain these later dynamic definitions, and the trusted selection does not produce another template response. Do not save/reload a staging draft and do not send an explicit same-page template request. The service MUST read only newly visible `.property-list` rows from the current official React form model in the main world, merge them into the initial normalized template, fill newly discovered template PIDs, and repeat until stable (maximum five rounds).
- Dynamic React projection MUST be bounded by visible row count, traversed object count, depth, and candidate count. It MUST inspect only visible row labels absent from the known template and project only `templateModuleId/id/pid/ref_pid/name_alias/required/is_important/control_type/value_type/choose_max_num/values[{vid,value}]`. The projected model name MUST exactly equal the row label. A missing/ambiguous module ID may fall back only when the base template has exactly one module. Shape drift, conflicting definitions, or any visible row unresolved after merge MUST fail closed as `dynamic_property_template_invalid`.
- Run the dynamic stabilization loop after every initial property fill, not only when `skippedCount > 0`; a newly revealed required row may exist even when all source properties initially matched. The stable merged full plan is authoritative for the single final save. If new mapped PIDs still appear after five rounds, fail as `dynamic_property_template_unstable`.
- Property UI rows are located by the unique full label under `.property-list`; options are unique exact visible `role=listbox/option` matches. Matching/readback MUST normalize NFKC, whitespace, and Unicode dash variants. Multi-select placeholders may disappear after the first choice, so an enumerated row may fall back only to its unique text input. Re-read option texts immediately before the trusted locator click because the live menu can re-render. Every selected value MUST be read back from the same row, including selected text exposed only through an input placeholder.
- A dynamic row MAY already contain an expected dependent value (for example `材质=棉`). `fillGoodsProperties()` MUST read and skip that exact value instead of reopening and rewriting its control.
- SKU previews group by the unique color/flower dimension. All SKUs of one color MUST resolve to one URL, and different colors MUST NOT share a URL. Blank add-color rows are ignored.
- All preview files MUST download before any preview upload begins. Each exact color container MUST own one file input, one distinct successful 2xx completion response, and a visible preview readback. A successful `/v3/store_image` response MAY return the uploaded URL at top-level `url`; legacy `img_url` shapes remain supported.
- Image, SKU, and price writes trigger broad React form re-renders. `fillGoodsProperties()` MUST run after those writes so a later render cannot restore stale attribute selections.
- Selecting a standard size dimension MAY make the merchant form automatically enable a size chart. An active chart can block listing even when attributes, SKU previews, prices, and stock are otherwise complete.
- After the dynamic-property plan stabilizes and immediately before the one final save, the service MUST call `disableSizeChart(page)`. It uses the official two-step UI action: the unique `a[data-tracking-click-viewid="disable_size_chart"]` control, followed by the exact `确认停用` button. No staging save or direct size-chart endpoint is allowed.
- Size-chart disable succeeds only after both the disable control and `[class*="sizeChart_sizeTable"]` disappear. If both are already absent, the helper is a safe no-op for categories/forms without an active chart. A missing or ambiguous control/confirmation, or failed DOM readback, MUST fail closed before save with a stable `size_chart_disable_*` issue.
- Do not infer disabled state from draft payload scalars. Live evidence showed the official disable action changed `size_spec_id` from `313998050` to another non-zero ID (`314004011`) while `size_parent_spec_id`, `is_size_change_casually`, and `is_size_spec_sync_detail` did not provide an authoritative off flag. Official action plus DOM readback is the contract.
- Before the one final `route.continue()`, `goods_properties` MUST match every planned platform ID/value and each matched `skus[].thumb_url` MUST exactly equal the in-memory uploaded URL for that SKU color. There is no post-reload canonical-URL bypass. For enumerated `controlType=1` values, exact platform IDs plus `vid` are authoritative because the live payload `value` may be empty or presentation-formatted; free-input values still require exact normalized text. Errors/logs expose only issue codes and counts, never image URLs, React objects, or raw template responses.

### 11.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| no bounded structured source properties | `source_properties_missing`, fail before draft creation |
| no color dimension, missing color image, or same-color image conflict | stable `sku_preview_*` issue, fail before draft creation |
| malformed/empty merchant template | `property_template_invalid`, no DOM/index fallback |
| successful template envelope with `result.modules` | unwrap `result`; use root `result.id` as `propertysTid` |
| enumerated property has no candidates | `property_template_invalid`; free-input property may omit candidates |
| required property unmapped | `required_property_unmapped`, no form fill/save |
| important property unmapped | `important_property_unmapped`, no form fill/save |
| optional property/value unmapped | skip the property; warning `property_mapping_partial` |
| trusted option click reveals a new property row | bounded main-world projection, strict merge, fill only newly mapped template PIDs |
| scripted `element.click()` changes display but misses dependency chain | forbidden; use the exact Playwright locator's trusted `.click()` |
| explicit same-page template fetch or staging save/reload | forbidden; the dependency is resolved from the current same-page form state |
| dynamic model conflicts, is unresolved, or has ambiguous module evidence | `dynamic_property_template_invalid`, no save |
| dynamic mapping does not stabilize within five rounds | `dynamic_property_template_unstable`, no save |
| dependent property already has the expected value | skip rewriting it; retain it in the final full plan |
| duplicate/missing property row or option, or readback mismatch | `E_BUSINESS`, no save |
| incomplete preview download/upload/readback | `E_BUSINESS`, no save; detail contains no URL |
| size-chart control and table both absent | safe no-op; continue to the final save |
| active chart has no unique disable control or no unique confirmation | `size_chart_disable_control_unmapped` / `size_chart_disable_confirmation_missing`, no save |
| disable click does not remove both control and table | `size_chart_disable_readback_mismatch`, no save |
| outgoing property IDs/value mismatch | abort route with `goods_property_mismatch` |
| final SKU thumb missing/mismatch | abort route with `sku_thumb_url_missing` / `sku_thumb_url_mismatch` |

### 11.5 Good / Base / Bad Cases

- Good: 18 SKUs across gray/blue/yellow and six sizes preserve three unique `thumbUrl` values; a trusted click fills `面料俗称`, same-page state adds `材质` and `成分含量`, the automatically enabled size chart is officially disabled, and all 19 mapped rows plus three previews pass the one final save and independent draft readback.
- Base: all SKUs of one declared color reuse one source thumbnail and one merchant-uploaded URL; a category without an active chart takes the no-op branch.
- Bad: hard-code one category's full attribute list, use `element.click()`, explicitly fetch the template twice, stage-save/reload to discover attributes, scan unbounded React state, pick the first candidate, derive properties from detail text, or set a guessed `size_spec_id` instead of using the official disable action.

### 11.6 Tests Required

- Source/normalizer/cache unit: exact-goods bounded projection, `thumbUrl` preservation, v4 round-trip, v3 rejection, malformed properties and preview conflicts.
- Property mapper unit: direct/live-envelope template shapes, root template ID, free-input without candidates, unique refPid, exact name, explicit fabric one-to-many alias, slash collapse, multi-value limits, duplicate candidates, required/important failure, optional atomic skip, and template drift.
- Dynamic-template unit: bounded main-world reader, known-row exclusion, exact row/model-name match, single-module fallback, multi-module ambiguity, definition conflict, unresolved visible row, and invalid-shape failure.
- Service unit: initial template with only `面料俗称`, same-page dependent-only fill of `材质`/`成分含量`, one template endpoint call, one final save, and final full-plan validation.
- Form/image unit: trusted locator option click (scripted DOM click forbidden), exact row/option, already-satisfied dependent-value skip, disappearing multi-select placeholder, dash normalization, placeholder readback, duplicate rejection, property-last ordering, blank color row ignore, exact color container, top-level store-image `url`, complete download, distinct 2xx responses, and URL-free error detail.
- Size-chart unit: official two-step action, already-disabled no-op, missing confirmation failure, and control/table readback mismatch failure. Service unit MUST assert exactly one disable attempt after property stabilization and zero save calls when disable fails.
- Route unit: missing/mismatched `goods_properties` and exact `thumb_url` call `abort`, and unroute occurs in all paths.
- Real E2E: cache-only source, no `--confirm`, no consumer source request, exactly one save log, draft status, `成分含量` plus all 19 mapped property rows read back, three color previews, unchanged 18-SKU pricing/stock, and no disable control or size-chart table after reopening the saved draft.

### 11.7 Wrong vs Correct

#### Wrong

```js
const row = page.locator('input[placeholder="请选择"]').nth(sourceIndex);
await row.click();
await page.locator('[role="option"]').first().click();
sku.thumb_url = source.skus[skuIndex].thumbUrl;
```

#### Correct

```js
const propertyPlan = buildPropertyPlan(source.goodsProperties, merchantTemplate);
if (!propertyPlan.ok) throw propertyMappingError(propertyPlan.issues);

const previewPlan = buildSkuPreviewPlan(source);
const uploadedPreviewPlan = await uploadSkuPreviewImages(page, previewPlan.plan);
await fillSkuRowsImagesAndPrices(page);
await fillGoodsProperties(page, propertyPlan.plan); // React-sensitive fields last

let stableTemplate = merchantTemplate;
let stablePlan = propertyPlan;
for (let round = 0; round < 5; round += 1) {
  stableTemplate = await readDynamicPropertyTemplate(page, stableTemplate);
  const nextPlan = buildPropertyPlan(source.goodsProperties, stableTemplate);
  const added = onlyNewTemplatePids(stablePlan, nextPlan);
  stablePlan = nextPlan;
  if (added.length === 0) break;
  await fillGoodsProperties(page, added);
}

await disableSizeChart(page); // official two-step action; fails closed on readback drift

const checked = validateDraftEditPayload(outgoingBody, {
  expectedPropertyPlan: stablePlan.plan,
  expectedSkuPreviewPlan: uploadedPreviewPlan,
  expectedSkuPricing: pricingPlan.skuPricing,
});
if (!checked.ok) await route.abort('failed');
await clickSaveDraft(page, draftIds.goodsCommitId, { strictPayload: true });
```

## 12. Scenario: Full-Count Discount Configuration

### 12.1 Scope / Trigger

Use this contract when changing `fullCountDiscountRate`, the merchant full-count discount control, final form-write ordering, or draft edit/detail validation.

### 12.2 Signatures

```text
config/config.example.json: fullCountDiscountRate = 0.95
PDD_FULL_COUNT_DISCOUNT_RATE=<0.50-0.99|50-99>
```

```js
fillFullCountDiscount(page, discountRate, log) -> {
  rate, displayValue, payloadValue,
}

validateDraftEditPayload(body, {
  expectedFullCountDiscountRate,
})
```

Verified mapping:

```text
runtime 0.88 -> UI 8.8 -> request two_pieces_discount: 88
runtime 0.95 -> UI 9.5 -> request two_pieces_discount: 95
```

### 12.3 Contracts

- Runtime configuration is owned by `src/infra/config.js`; service/adapter MUST NOT read `process.env` or copy the default.
- The only verified control is `input[data-tracking-viewid="count_discount"]`, with placeholder `5.0~9.9`. It MUST be unique, filled through Playwright, blurred, and read back numerically.
- Fill the discount after dynamic properties and size-chart handling, immediately before the final save, because earlier form writes may re-render the page.
- Before `route.continue()`, `two_pieces_discount` MUST equal `fullCountDiscountRate * 100` as an integer. Missing or mismatched values abort the request.
- When draft detail includes `two_pieces_discount` (or its camel-case variant), it MUST match the configured value. A successful detail response may omit this field; the already-validated save request remains authoritative in that case. Unavailable detail keeps the existing `draft_verification_unavailable` warning contract.
- Missing/duplicate controls, readback drift, or payload drift MUST fail closed; do not silently use the platform default.

### 12.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| config absent from override layers | baseline `0.95` |
| decimal/percentage form in range and integer-percent precision | normalized `0.50-0.99` runtime value |
| invalid range, syntax, or precision | `E_CONFIG_INVALID` before browser/page writes |
| discount control missing or non-unique | `E_BUSINESS`, no save |
| UI readback differs | `full_count_discount_readback_mismatch`, no save |
| request field missing/mismatched | abort route with `full_count_discount_missing` / `full_count_discount_mismatch` |
| detail omits the discount field | keep the request-side result; do not report a missing-field failure |
| detail includes a mismatched discount field | strict verification fails with `full_count_discount_mismatch` |

### 12.5 Good / Base / Bad Cases

- Good: runtime `0.88` writes `8.8`, reads back `8.8`, and the intercepted draft request contains `two_pieces_discount: 88`.
- Base: no override uses baseline `0.95` and writes request value `95`.
- Bad: locate a broad placeholder match, ignore duplicate controls, or trust the visible input without validating the outgoing request.

### 12.6 Tests Required

- Config unit: baseline, decimal/percentage normalization, boundaries, precision, and invalid values.
- Form unit: exact selector, UI conversion, blur/readback, missing/duplicate control, and mismatch failure.
- Route/detail unit: exact `two_pieces_discount` acceptance plus missing/mismatch abort evidence; detail omission is tolerated, but a returned mismatch fails verification.
- Service unit: discount fill occurs after size-chart handling and before save; expected rate reaches strict payload validation.
- Real verification: use an empty draft in one browser session, intercept and abort the save request, and prove the UI/request mapping without platform persistence.

### 12.7 Wrong vs Correct

#### Wrong

```js
const raw = process.env.PDD_FULL_COUNT_DISCOUNT_RATE || '0.95';
await page.locator('input[placeholder*="折扣"]').first().fill(String(Number(raw) * 100));
```

#### Correct

```js
const rate = ctx.runtimeConfig.fullCountDiscountRate;
await fillFullCountDiscount(page, rate, ctx.log);
await clickSaveDraft(page, goodsCommitId, {
  strictPayload: true,
  expectedFullCountDiscountRate: rate,
});
```
