# Domain Service Contracts

## 1. Scope / Trigger

适用于修改 `src/services/**` 中 orders、goods、promo、diagnose、promo-roi、goods-segmentation、auth 等领域逻辑。

## 2. Signatures

服务函数标准形态（`src/services/goods.js:32-41`）：

```js
export async function listGoods(page, params = {}, ctx = {}) {
  const result = await runEndpoint(page, GOODS_LIST, params, ctx);
  const goods = Array.isArray(result?.goods) ? result.goods.map(toGoodsRecord) : [];
  return {
    total: Number(result?.total) || 0,
    goods,
    sessionId: result?.sessionId ?? null,
    raw: result?.raw ?? null,
  };
}
```

私有 normalizer 模式（`src/services/goods.js:19-30`）：

```js
function toGoodsRecord(g) {
  return {
    goods_id: g.goods_id ?? g.goodsId ?? g.id ?? null,
    goods_name: g.goods_name ?? g.goodsName ?? '',
    quantity: Number.isFinite(Number(g.quantity)) ? Number(g.quantity) : 0,
    sku_price: g.sku_price ?? g.skuPrice ?? null,
    // ...stable field projection
  };
}
```

主要服务目录：

```text
src/services/orders.js         订单列表/详情/统计；get*View 产出命令级 v2 data
src/services/goods.js          商品列表/库存视图、写入校验（validateWriteValue）
src/services/goods-write.js    写操作编排：预演/提交、回显与 headline（单项 + batch）
src/services/goods-publish.js  发布流程（含运费模板、软风控）
src/services/promo.js          活动报表（Poseidon 适配）
src/services/promo-roi.js      ROI 计算（analyzePromoRoi，内部）+ getPromoRoiView
src/services/diagnose/index.js 店铺数据汇总（summarize*，内部代码）
src/services/diagnose/reports.js  diagnose.* 命令级结果（采集 → summarize → 视图）
src/services/goods-segmentation.js  商品销量与库存统计 + getGoodsSegmentView
src/services/shops.js          店铺列表/当前店铺视图
src/services/auth.js           认证状态管理
src/services/views/            领域视图（防腐层），见下
```

领域视图层（输出契约 v2 防腐层，`src/services/views/`）：

```text
_shared.js        pick / text / yuanText / mallIdOf / toFiniteNumber
labels.js         共享枚举 → 中文标签；报表专属表与声明归各自 view 所有
order.js          ORDER_VIEW_FIELDS / ORDER_DETAIL_VIEW_FIELDS、toOrderView、stats 视图
goods.js          GOODS_VIEW_FIELDS / GOODS_PROMOTION_VIEW_FIELDS / COST_TEMPLATE_VIEW_FIELDS
goods-publish.js  PUBLISH_VIEW_FIELDS（live / fixture 两条流程同一形状）
promo.js          PROMO_ROI_ITEM_FIELDS / PROMO_TOTALS_FIELDS
diagnose.js       DIAGNOSE_DIMENSIONS / STALE_SAMPLE_FIELDS、toDimensionView、toShopView（compare 视图在 shop 视图内组装）
shops.js account.js config.js auth.js   管理命令视图
```

```js
// 视图标准形态：白名单投影，键顺序即 *_VIEW_FIELDS；缺失为 null
export function toOrderView(raw) {
  return {
    order_sn: text(pick(raw, ['order_sn', 'orderSn'])),
    status: orderStatusLabel(raw),            // 上游 order_status_str，回退 '未知(<code>)'
    paid_amount_yuan: yuanFromFen(raw?.order_amount),
    ordered_at: toLocalDateTime(pick(raw, ['order_time', 'orderTime'])),
    // ...
  };
}
```

## 3. Contracts

- Service MUST return plain serializable data for envelope `data`。
- Service MUST NOT call `console.log`、write stdout、or build full envelope。
- Service MAY throw `PddCliError` with correct `ExitCodes` for domain validation/business failures。
- Raw endpoint payload MUST be normalized before returning to command layer。
- Command-facing results MUST go through a view in `src/services/views/`: whitelist projection (each entity view exports a `*_VIEW_FIELDS` list that equals the emitted key set), unit conversion (`src/infra/units.js`), Chinese labels and a factual `headline`. Upstream extra fields MUST NOT change the output; PII (receiver name / phone / contact phone / nickname / detailed address such as `consumerAddress`, `deliveryManPhone`, `refundAddressInfo` …) MUST NOT be projected。
- Order region (D5 revision, 2026-11, `.scratch/order-region/spec.md`): `orders list` items and the `orders detail` order MAY output `province` / `city` / `district`, taken only from upstream `province_name` / `city_name` / `district_name` via `text()` (missing or empty string → null). Region `*_id` codes, street, postcode and full addresses stay excluded, and the view MUST NOT parse region from `consumerAddress` or other address fields. Every other D5 exclusion is unchanged。
- Internal calculators (`computeOrderStats`、`segmentGoods`、`analyzePromoRoi`、`summarize*`、`listGoods`、`listOrders`) keep internal codes and raw-ish numbers and MAY be reused by other services; only the view layer translates them. Field facts come from `.trellis/tasks/10-07-domain-view-contract-v2/research/upstream-schema-2026-10.md` (orders/goods money in fen, unix seconds with `0` = not happened)。
- Shared enum → Chinese tables live in `src/services/views/labels.js`; single-view tables live beside their owning view. Report hint tables live in each view's report declaration. Unknown enum codes render `未知(<code>)` via `labelOf`; unregistered report hint keys throw `E_INTERNAL` instead of emitting a missing label。Order status uses upstream `order_status_str` (no self-built status table)。
- Order quantity upstream field is `goods_number`; inventory/segment `readQuantity` reads `quantity ?? goods_number ?? goods_quantity ?? goodsQuantity`。
- Reused calculations such as ROI、segmentation、inventory matching MUST have one owner module and tests。
- Goods list identity MUST map `goods_id ?? goodsId ?? id ?? null` at both endpoint and service boundaries, preserving numeric/string IDs. A remaining null identity indicates upstream shape drift or a mapping regression, not normal behavior. Inventory matching MUST retain the `goods_name` fallback and may report internal `matched_by: 'mixed'` when identity is unavailable (output label `按商品名匹配（一侧缺少商品 ID）`)。
- Goods stock SKU (2026-11, `.scratch/sku-stock/spec.md`): `GOODS_LIST.normalize` projects `sku_list[]` to `skuId` / `spec` / `skuQuantity` (non-negative finite or null) / raw `isOnsale`; missing or non-array `sku_list` → null (distinct from `[]`). `services/goods.js` alone maps `isOnsale` (true/1/'1' → true, false/0/'0' → false, else null), sets `low_stock` (on sale AND known quantity ≤ threshold) and computes `low_stock_sku_count` once; `toGoodsStockView` only projects `GOODS_STOCK_ITEM_FIELDS` / `GOODS_STOCK_SKU_FIELDS`. `goods list` output is unchanged. `items` = total quantity ≤ threshold OR `low_stock_sku_count > 0`; `low_stock_count` counts only the former and MAY differ from `items.length`; the headline's SKU-trigger line counts the rest (total above threshold or null), so the two lines sum to `items.length`. 缺货 means quantity `<= 0` at both goods and SKU level。
- Inventory `detail.data_quality` and segmentation `summary.data_quality` MUST distinguish `goods_complete`, `orders_complete` and each scan's truncated/rate-limited flags. Forward `goodsTotal`, `goodsScanTruncated`, and `goodsScanRateLimited` along with order flags.
- Incomplete segmentation uses internal `data_completeness` codes `partial_goods`, `partial_orders`, or `partial_goods_orders` (output as Chinese labels, see table below). Incomplete orders make `units_sold` (window given by top-level `window_days`; formerly `units_sold_30d`) and `stock_days` null; `observed_units_sold` preserves observed sales, not an estimate of the missing portion.
- Queries MUST NOT generate operating advice, grades, scores, ranks, or good/bad promo classifications. The action-plan service is removed.
- Diagnosis uses `summarizeOrders`, `summarizeInventory`, `summarizePromo`, and `summarizeAfterSales`; internal `full` / `partial` describes data availability only (output `数据完整` / `数据不完整`). Missing inputs remain visible as partial dimensions.
- 诊断地区区块 `diagnose.orders.regions`（2026-11, `.scratch/region-report/issues/02-province-distribution-core.md`）：`getOrdersDiagnosis` 在完成 `collectOrdersInput` 之后调用 `orders.regionDistribution`（page-api POST `/sydney/api/mallCoreData/queryMallGeographyDistributionList`，`{ queryType: 1 }`，导航 `/sycm/stores_data/operation`，数值字段命中 PUA 抛出 `E_BUSINESS` fail-closed 并带 `detail.reason: 'pua_obfuscated'`，校验 `provinceName` 去重与跨行 `statDate` 一致，白名单投影 `provinceName` / `statDate` / `cfmOrdrAmt` / `cfmOrdrCnt` / `cfmOrdrUsrCnt` / `cfmOrdrAup` / `cfmOrdrAop`，剔除 `provinceId` / `*Cent`）。`toOrdersDiagnosisView` 在原有 `toDimensionView('orders', result)` 上追加 `regions: ORDER_REGIONS_FIELDS`（口径「数据中心-地域分布（成团订单）」、`window` 由最新 `statDate` 推导近 7 天、无成团省份时 `items: []`、`province_count: 0`、`window: null` 并保留 `window_days: 7`、`delayed`、`items[]` `ORDER_REGION_ITEM_FIELDS` 按成团额降序、金额全为 `null` 时 headline 如实陈述缺失）及对应 hint/headline（`delayed: true` 时追加提示）；主区块与 `diagnose.shop` 不受影响。地域分布与 `operating-report.js` 共用 `isDegradableReportError`：可降级 `PddCliError`（含子账号无权访问触发的 `E_AUTH_EXPIRED`）置 `regions: null` 并附 hint、退出码 0；`E_TIMEOUT`、`E_INTERNAL`、`AbortError` 与程序异常继续抛出。验证：`test/adapter/orders-contract.test.js`、`test/services/diagnose-orders-regions.test.js`、`test/e2e/diagnose-orders.e2e.test.js` 与 `data-contract-v2.test.js` 的 `diagnose.orders` 用例。
- 地域分布 headline 只在有成团额的省份中比较最高值；部分省份金额缺失时明示比较范围。
- Diagnose `detail` keys (v2, set directly by `summarize*`):
  - orders: `shipping_p95_hours`（1 位小数）, `refund_rate_pct`（有列表样本时恒输出；无订单样本或样本缺 `after_sales_status` 字段时 null）, `pending_ship_count`, `delayed_ship_count`（formerly `refund_rate` / `unship` / `delay`）。
  - inventory: `data_quality`, `total`, `out_of_stock_count`, `low_stock_count`, `low_stock_threshold`, `out_of_stock_rate_pct`, `low_or_out_rate_pct`, `reported_total`, `matched_by`(label), `stale_count`, `stale_sample[{ goods_id, goods_name, quantity }]`, `ambiguous_groups[{ normalized_name, sku_count, sample_quantities }]`（formerly `out_of_stock` / `low_stock` / `*_rate` / `total_reported`; `stale_sample[].units_sold_30d` removed）。
  - promo: `impression`, `click`, `gmv_yuan`, `spend_yuan`, `ctr_pct`（曝光为 0 时 null）, `roi`。
  - after_sales: `total_orders`, `refund_count`, `refund_rate_pct`, `after_sales_count`, `after_sales_rate_pct`, `status_distribution`（以中文状态为键）, `window_days`。`refund_count` 计退款成功，`after_sales_count` 计售后处理中，两类占比各以采集到的全部订单数为分母。未知计数和对应占比保持 null，空样本计数为 0、占比为 null；headline 区分退款成功与售后处理中，字段缺失时说明售后数据不可用。售后统计使用事实名称，移除以退款率补数命名的 `fulfillment_rate_pct`。
- After-sales entry points: `getAfterSalesDiagnosis(ctx, { days })` → `diagnose after-sales [--days 30]` (envelope command `diagnose.after-sales`); `diagnoseShop({ orders, goods, promo, after_sales })`, shop views and comparisons use dimension key `after_sales`. Standalone scans default to 30 days with truncation/rate-limit hints; shop defaults to its 7-day first-page order sample. The old `diagnose funnel` entry point is removed.
- Order list scope and refund semantics: see **Scenario: Order list scope & refund identification** below。
- Inventory `stale_count` retains its legacy field name but means observed zero-sales goods, not an operating judgment. Missing order enrichment makes it null.
- Promo ROI is a numerical ratio (null when spend is zero); no break-even threshold or classification is returned. `promo.roi` data: `{ headline, by(label), items, total, summary{ spend_yuan, gmv_yuan, roi, excluded_inactive_count, excluded_inactive_spend_yuan }, totals{ impression, click, ctr_pct, spend_yuan, gmv_yuan, net_gmv_yuan, cost_per_order_yuan, goods_fav_spend_yuan, mall_fav_spend_yuan, inquiry_spend_yuan } | null, mall_id }`; CTR is recomputed as click / impression (upstream ctr has unknown units and is not used)。
- Promo money parsing (`src/adapter/endpoints/promo.js` `parseMoney` / `moneyToNumber`): MoneyVO `unit: YUAN` as-is, `FEN` ÷ 100, other non-empty unit → `null` plus a `unitWarnings` entry that services forward to `meta.warnings`; bare numbers / strings are yuan; missing or invalid → `null` (never 0). `totals.cost` is not emitted (same source as `spend`)。 Aggregations (`analyzePromoRoi` row / summary sums, `summarizePromo` gmv) propagate `null`: one unknown amount makes the sum and its ROI `null` instead of counting it as 0。
- Comparisons return numerical metric deltas, not score changes or improvement/regression labels. Inventory and orders `pending_ship_count` / `delayed_ship_count` are current snapshots and MUST NOT receive historical deltas (`note: 仅有当前快照，无上期数据`). For `_pct` metrics `delta` is in percentage points and `delta_pct` is the relative change in %; for other metrics `delta` is in the metric's own unit. Compare windows are `{ start_date, end_date, days }` (Asia/Shanghai)。
- Internal code → output label (translated only in the view layer; shared tables in `src/services/views/labels.js`, dedicated tables beside their view):

| Output field | Internal code → label |
| --- | --- |
| diagnose / shop / compare `status` | `full` 数据完整, `partial` 数据不完整 |
| diagnose issues/hints `dimension` | `orders` 订单, `inventory` 库存, `promo` 推广, `after_sales` 售后 |
| compare metric `note` | `current_snapshot_only` 仅有当前快照，无上期数据 |
| inventory / segment `matched_by` | `goods_id` 按商品 ID 匹配, `goods_name` 按商品名匹配, `mixed` 按商品名匹配（一侧缺少商品 ID） |
| segment `summary.data_completeness` | `full` 数据完整, `no_promo` 数据完整（无推广数据）, `no_orders` 数据完整（统计期内无订单）, `empty` 无商品, `partial` 数据不完整, `partial_goods` 商品数据不完整, `partial_orders` 订单数据不完整, `partial_goods_orders` 商品与订单数据均不完整 |
| promo.roi `by` | `plan` 推广计划, `sku` 商品, `channel` 推广场景 |
| promo `scenes_type` | `9` 商品推广（archive 07-05 promo-poseidon-adapt 证据）；其余 `未知(<code>)` |
| promo `promotion_type` | 无值域证据，非空一律 `未知(<code>)` |
| order `after_sales_status` | `5` 退款成功, `10` / `11` 售后处理中（10-08 research）；其余 `未知(<code>)`；null → null |
| orders.list `--status` scope（headline） | `all` 全部, `pending_ship` 待发货, `shipped` 已发货待收货, `received` 已收货, `after_sales` 售后处理中 |
| order `status` | 上游 `order_status_str`；缺失回退 `未知(<order_status>)` |
| goods.publish `status` | `draft` 草稿, `submitted` 已提交 |
| goods.reviews `filter.mode` | `substantive` 实质内容, `min_length` 最小字数, `all` 全部 |
| goods write status echo `value` | `onsale` 上架, `offline` 下架 |
| shops.current `source` | `mock` 测试数据, `state` 页面状态, `url` 页面 URL, `cookie` Cookie, `storage` 本地存储, `xhr` 接口响应, `dom` 页面元素 |
| config `source` / `effective_source` / issues `layer` | `baseline` 基线配置, `local` 本地覆盖, `env` 环境变量, `cli` 命令行参数 |
| login `mode` | `qr` / `consumer-qr` 扫码登录, `headed` / `consumer-headed` 有头浏览器登录 |
| login `check_verdict`, doctor `verdict` | `verified` 已验证, `rejected` 已失效, `failed` 验证失败, `indeterminate` 无法判定, `not_configured` 未配置 |
| doctor `reason` / `mall_source` / auth file `error` | `AUTH_REASON_LABEL` / `verified_shop_endpoint` 店铺接口验证 / `auth_state_unreadable` 登录态文件无法读取、`auth_state_undecryptable` 登录态文件无法解密 |

- Wording: in headlines「凭据」means only a saved login credential (the account view no longer exposes `has_credential` / `last_refresh_at`; ③ adds `has_password`); stored auth state is still called「登录态文件」. `account remove` headline: `已移除账号 <slug> 及其认证数据`. Headlines never invent placeholder names (e.g. missing shop name → `当前店铺 ID <id>（未获取到店铺名）`)。

## 4. Validation & Error Matrix

| 条件                                                     | 行为                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| required service option missing after command validation | throw usage/business `PddCliError` depending on boundary                            |
| adapter returns business error                           | preserve mapped `PddCliError` rather than wrapping blindly                          |
| endpoint data missing optional array                     | normalize to `[]` when semantically empty                                           |
| endpoint data missing required identity                  | throw business error or include unmatched record with warning                       |
| mixed data sources partially fail                        | return partial data plus warnings, or throw `ExitCodes.PARTIAL` via runner contract |
| incomplete orders contain no observed sales | unknown full-period sales, not zero |
| zero spend or zero previous comparison value | ratio or percentage delta is null, not infinity |

## 5. Good/Base/Bad Cases

- Good：orders stats service fetches list data, computes aggregate metrics with `computeOrderStats`, then projects them via `toLocalOrderStatsView` into `{ headline, remote, local, mall_id }`。
- Base：diagnose service composes orders/goods/promo facts and returns detail/status/data-quality hints。
- Bad：service returns raw XHR response containing platform-only fields and lets command handler pick fields。

## 6. Tests Required

- Unit tests for normalizers and business calculations。
- View tests: exact key set equals `*_VIEW_FIELDS`, injected unknown upstream fields leave output unchanged, absent fields are `null`, PII never appears, labels for known / unknown codes。
- Fixture adapter e2e for command-to-service-to-adapter shape。
- Regression tests for gotchas: upstream `id` mapping, identity alias priority and numeric/string preservation, null `goods_id` fallback, camelCase/snake_case business errors, empty payloads。
- Edge-case table tests when parser/normalizer accepts broad external payload variation。
- Tests for factual reporting should cover incomplete sources, explicit zero values, numerical comparisons, advice-free output, removed CLI entry points, and preserved write dry-run behavior. The temporary removal-verification tests were excluded from the commit at the user's request; do not assume they exist in the committed suite.

## 7. Wrong vs Correct

Wrong: `ordersTruncated` plus no matching orders implies `units_sold: 0`. Correct: retain `observed_units_sold: 0`, set the full-period value to null, and mark partial quality.

### Wrong

```js
export async function listGoods(ctx, options) {
  return runEndpoint(ctx, goodsListSpec, options); // leaks raw payload upward
}
```

### Correct

```js
export async function listGoods(ctx, options) {
  const payload = await runEndpoint(ctx, goodsListSpec, options);
  return normalizeGoodsList(payload, options);
}
```

## Operating Report Scaffolding

- Customer service, reviews, experience, traffic, goods traffic and goods profit each export a report declaration from their view, re-exported by the service. Its days range/choices generate Commander parsing, help text, defaults and defensive service validation; validation remains `E_USAGE` / exit 2. `withReportDays` preserves the report command name in parse-error envelopes.
- `runReport(ctx, definition, { days, window, hints }, collect)` gives the callback `{ window, hints, hint(key), optional(key, collect, fallback) }`. `createReport` supplies the same handle to independently callable collectors. Fallback may be a value or `(error) => value`, preserving report-specific null/empty-map/partial-result behavior and reviews' last error.
- Optional sources degrade domain `PddCliError` failures; timeout, cancellation, internal hint-contract errors and unexpected errors propagate unchanged. Signal checks surround collection. Hint registration is checked when added and when translated; emitted report hints are non-empty Chinese strings.
- `report-windows.js` owns named window constructors (platform ready date, yesterday, Shanghai complete days, rolling seconds). Public window keys, inclusive/exclusive boundaries, headlines and hint wording retain their existing contracts.

## Scenario: Shop Experience Star

### 1. Scope / Trigger

适用于 `diagnose.experience` 的端点、服务、视图及 fixture；独立查询平台店铺综合体验星级，`DIAGNOSE_DIMENSIONS` 保持原有四个维度。

### 2. Signatures

```js
getShopExperienceView(ctx, { days = 7 } = {}) // src/services/experience.js; returns v2 data
toExperienceView(info, { trend = null, mallId = null, hints = [] } = {}) // views/experience.js
```

CLI：`pdd diagnose experience [--days 7]`，`needsAuth:true`、`needsMall:'switch'`。端点为 `experience.navigatorReadyDate`、`experience.navigatorInfo`、`experience.navigatorList`，均走 `page-api`；先 ReadyDate，再 Info，最后 List（参数 `{ beginDate, endDate }`）。

### 3. Contracts

- `data` 字段：`headline`、`status`、`snapshot`、`indicators`、`consumer_experience_plan`、`trend`、`hints`、`mall_id`。`mall_id` 使用 `mallIdOf(ctx)` 的明文值，与其他 diagnose 命令一致。
- `snapshot` 字段：`stat_date`、`star`、`star_change`、`next_star`、`next_star_rank_pct`、`score_rank_pct`、`score_grade`、`star_text`、`industry`；统计日期来自 Info.timestamp，平台文案原样保留。
- `indicators[]` 字段：`key`、`dimension`、`name`、`value`、`unit`、`next_star_threshold`、`next_star_status`。十项指标及字段、单位映射以 [views/experience.js](../../../src/services/views/experience.js) 的 `INDICATORS` 为唯一来源，中文标签归同一 view 所有。
- 比率及门槛乘 100；`gmvRk` 已为百分数，保留原值；时长保留小时/天，`dsr3m` 单位为「平台原值」。数值统一用 `infra/units.js` 保留 2 位小数，null 保留 null。门槛读 `<field>NextPctThreshold`；达标状态仅映射平台 `<field>NextStarRkDesc`：0 已达标、1 未达标，其他/null 为 null，指标值为 null 时状态也为 null。
- `consumer_experience_plan` 为 `{ enabled, required, next_star_status }`，来自 `isRps`、`isRequireRps`、`isRpsNextStarRkDesc`。
- `trend` 为 null 或 `{ start_date, end_date, days, items }`；截止日来自 ReadyDate，起日为截止日减 `days - 1`，使用 UTC 日期运算隔离宿主时区。`items[]` 为 `{ date, star, score_rank_pct, <十项指标 key> }`，按日期升序保留窗口内有数据的行，缺日保留缺行。
- 输出白名单剔除 `mallId`、`mallName`、店铺名、图片 URL、`avgDescRevScrRcatePct3m`、`mallStarToc`，以及未确认的指标 `*Rk`、`*RkDesc`、`*4p5Standard`、`*5Standard`、`*RkStage`；保留已确认的 `scoreRk`、`gmvRk` 和下一星级达标状态用于映射。CLI 仅透传平台评分和判定。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| days 为非整数或超出 1–30 | `E_USAGE` / exit 2，发起端点请求前校验 |
| Info 失败 | 整体失败，交 runner 输出错误 envelope |
| ReadyDate / List 的可降级 `PddCliError` | 保留快照，`trend:null`、`status:数据不完整`，追加对应 hint |
| 意外异常、超时或取消 | 原样抛出，沿用 `goods-profit-promo.js` 的 catch 模式 |
| `normalFlag === false` 或 `delayData != null` | 追加「平台标记数据延迟」，数据完整性状态保持原值 |

### 5. Good/Base/Bad Cases

- Good：人工回复率 0.5、门槛 0.8、状态 1 输出 50、80、「未达标」，签收退货退款时长 null 保持 null。
- Base：完整的空趋势数组保留窗口及空 items；平台缺少某日时保留缺行。
- Bad：按阈值自行生成达标判定、缺失补 0、用当前日期替代 ReadyDate，均偏离平台事实。

### 6. Tests Required

`experience-contract.test.js` 校验 payload、成功码（success 与 0/1000000）和上游白名单；`experience-view.test.js` 校验十项映射、null、达标标签、headline 和字段集合；`experience.test.js` 校验窗口、days 边界和错误传播。`experience.e2e.test.js` 验证单行 JSON、明文 ctx.mall_id、上游键及店铺名剔除；`data-contract-v2.test.js` 用 `entityFields` 覆盖 `snapshot`、`indicators[]`、`trend.items[]`。fixture builder 使用侦察样本和真实 normalize，自动化验证仅用 fixture。

### 7. Wrong vs Correct

Wrong：`value >= threshold ? '已达标' : '未达标'`，自行推导平台判定。
Correct：值存在时映射 `<field>NextStarRkDesc` 的 0/1；未知码或缺失值输出 null。

## Scenario: Customer Service and Reviews

### 1. Scope / Trigger

适用于独立的客服与评价查询，保持 `diagnose shop` 的现有四维汇总。

### 2. Signatures

```js
getCustomerServiceView(ctx, { days = 30 } = {})
getReviewsView(ctx, { days = 30 } = {})
getGoodsReviewsView(ctx, { days = 30, goodsId = null, stars = null, all = false, minLength = null } = {})
```

CLI：`pdd diagnose customer-service [--days 30]`、`pdd diagnose reviews [--days 30]`、`pdd goods reviews [--days 30] [--goods-id <id>] [--stars 4,5] [--all|--min-length <n>]`，均为 `needsAuth:true`、`needsMall:'switch'`。

### 3. Contracts

- 客服 days 为 1-63 的整数，窗口按上海日期取 `[今天-days, 昨天]`。`cs.overview` 使用 page-api POST `/desert/stat/mallServiceOverviewData`，请求 `{ startDate, endDate }`；`cs.monthTrend` 使用 legacy 导航与 `/desert\/stat\/mallMonthServiceData/` 被动捕获 GET，返回固定最近 31 天，按 `statDate` 过滤。导航页为 `/mms-chat/overview/service`；两者成功条件为 `success === true` 且 errorCode ∈ `SUCCESS_BUSINESS_CODES`（0/1000000）。
- 客服 data：`{ headline, window, caliber, summary, trend, sales, today, hints, mall_id }`，口径固定「多多客服-客服数据（人工回复）」。summary 与 trend 指标映射以 `views/customer-service.js` 的 `METRICS` 为准；比率乘 100，时长单位秒、保留 2 位小数，null 保留。trend 为 null 或 `{ items:[{ date, ...summary字段, category_top10_avg_response_seconds, category_avg_response_seconds }] }`，日期升序；客服账号名及比较字段由白名单过滤。
- 客服销售区块 `sales`：口径「多多客服-销售数据」，平台只提供 3 天之前的数据（询单后 3 日内的下单计入询单当日）。窗口为 `windowEndingDaysAgo(min(days, 62), 3)`，即 `[今天-3-(n-1), 今天-3]`；62 来自销售数据页自定义日期的可选范围 `[今天-64, 今天-3]`（真实账号 2026-11-20 实测；更长的区间请求不报错，返回值与 62 天相同）。`cs.salesOverview` 使用 page-api POST `/desert/stat/mallSalesOverviewData`，请求 `{ startDate, endDate }`；`cs.monthSalesTrend` 为 `/desert\/stat\/mallMonthSalesData/` 被动捕获的无参 GET，由点击「销售数据」页签触发（`requiredTrigger:true`），固定返回 `[今天-33, 今天-3]` 共 31 行，按 `statDate` 过滤。
- `sales` 形状：`{ caliber, window, summary, trend }`。summary 为 `{ inquiry_user_count, group_user_count, inquiry_conversion_rate_pct, cs_sales_amount_yuan }`，取区间汇总接口（不由逐日相加）；trend 为 null 或 `{ items:[{ date, ...summary字段, category_top10_avg_inquiry_conversion_rate_pct, category_avg_inquiry_conversion_rate_pct }] }`，日期升序。转化率乘 100，金额为元、保留 2 位小数。null 按上游原值保留：询单 0 人时转化率 null，成团 0 人时客服销售额 null，尚未出数的日期整行 null（含类目均值），无询单记录的日期四项 null 而类目均值有值。客服可提升销售额（`csCanImproveSalesAmount`）与各 `*Compare` 字段由白名单过滤。headline 在原有行之后追加「<start> 至 <end> 询单 N 人，成团 N 人，询单转化率 N%，客服销售额 N 元」，null 的部分略去，询单人数为 null 时为「<区间> 无询单数据」，`sales` 为 null 时不追加。
- 客服今日实时区块 `today`（2026-11, `.scratch/realtime-data/issues/06-customer-service-today.md`）：经 `collectToday(report, collect)` 依次调用 `cs.todayRealtime`（page-api `GET /desert/stat/mallServiceRealTimeData`）、`cs.todayUnreply`（page-api `GET /chats/cs/unreplyUser/count`）与 `cs.todayHourConsult`（page-api `POST /desert/stat/getMallHourConsultData`，`{ startDate: today, endDate: today }`），不接入 `querySpecifiedDayServiceQuality`。`today` 形状为 `CS_TODAY_FIELDS`：`snapshot_at`、`as_of_hour`、`caliber`（固定「多多客服-实时数据（3 分钟人工回复率）」）、实时指标、`unreply_user_count`、过滤掉晚于 `snapshot_at` 上海小时（保留 `hour <= snapshotHour`）并按 `"00".."23"` 升序的 `hourly[]`（`CS_TODAY_HOURLY_FIELDS`）。headline 追加「今日实时客服：…」行，`today` 为 null 时不追加；可降级失败走 `today_unavailable`，原有 `summary`、`trend`、`sales` 不受影响。
- 评价 days 映射 `{30:1, 60:5, 90:4, 180:3}` 为 rangeType。endTime 为当前 Unix 秒，startTime=endTime-days*86400。标签和类型聚合的请求为 `{ startTime, endTime, rangeType }`；列表为 `{ startTime, endTime, pageNo, pageSize:40, descScore?, goodsId? }`（`diagnose reviews` 固定 `descScore:['1','2','3']`；`goods reviews` 按 `--stars` / `--goods-id` 传入，缺省时省略对应键，上游返回全店全部星级），三个端点均为 page-api POST `/saturn/reviews/*`，导航页 `/goods/evaluation/index`。成功判定为 `success === true || errorCode === 1000000`。
- 标签聚合的 `positiveKeywordList` / `negativeKeywordList` 为显式 `null` 时读取为空数组（真实账号实测：没有不满意标签的店铺 `negativeKeywordList` 为 `null`，满意标签照常返回）；缺键、`result` 为 null 仍为响应结构错误。`typeList` 与列表 `data` 的 `null` 仍为响应结构错误。
- `goods reviews` 的 days 为 1-365 的整数，窗口同为 `[now-days*86400, now]` 的 Unix 秒，只调用列表端点。
- 列表每页 `REVIEWS_PAGE_SIZE`=40 条（实测 pageSize 10-40 可用，49 起被上游以「仅支持查看近2000条评价」拒绝），最多采集 `REVIEWS_VIEW_LIMIT`=2000 条（50 页）。total 取首页 totalRows（越过末页时上游 totalRows 回落为 0）；翻满 50 页且 total 大于已采集条数时标记 truncated 并提示，恰好 2000 条为 `truncated:false`。两个命令共用 `collectReviews`。service 调用同时携带内部 `page` 和上游 `pageNo`，fixture 分页器使用前者，`buildPayload` 仅投影后者；fixture 使用 `totalRows` 和 `data`。
- 评价 data：`{ headline, window_days, keyword_tags, issue_types, negative_reviews, goods_scores, hints, mall_id }`。标签 `{ name,count }`；类型 `{ name,positive_count,negative_count,share_pct }`，平台 proportion 已为 0-100。列表 `{ items,total,truncated }`，total 取 totalRows。item 字段以 `REVIEW_FIELDS` 为准（两个命令共用）；`REVIEWS_LIST` 额外提取内部整数 `status`（缺失或非整数时为 `null`）专供 `goods reviews` 占位识别，不进入 `REVIEW_FIELDS`；score 非零时输出 history_score，三项评分为 null。createTime 秒转上海时间；appendReview 字符串直接取，文本对象投影为文本。
- 商品评分区块 `goods_scores`：端点 `reviews.goodsScores` 使用 page-api POST `/sydney/api/saleQuality/queryGoodsEvaluateVO`（导航页 `/sycm/goods_quality/comment`），请求 `{ pageSize:10, pageNo, sortCol:5, sortType:1 }`；`goodsEvaluates: null` 且 `mallOprGoodsCntStd` 为非负整数时读取为空列表，缺键仍报结构错误；对 `goodsId` 及四个数值字段检测 PUA 字体混淆字符（商品名不检测）。与 `collectReviews` 共用 `collectPages`，最多采集 20 页（200 个商品），`total` 取首页 `mallOprGoodsCntStd`；超出 20 页标记 `truncated:true` 并附 hint「商品评分列表已达 200 个商品上限，结果已截断」。`goods_scores` 形状：`{ caliber:'数据中心-评价数据', window_days:30, items, total, truncated }`（固定近 30 日，在任意 `--days` 下均输出）；item 字段以 `GOODS_SCORE_FIELDS` 为准，`review_count` 为 0 时三项平均分输出 `null`，否则保留 2 位小数；`todayEvaluationCount`、排名字段、未确认含义字段、图片 URL 与商品状态由白名单过滤。headline 在原有行之后追加「近 30 日有效评价商品 N 个」（N 为 `review_count > 0` 的商品数）；`goods_scores` 为 `null` 时不追加。
- 正文和追评手机号 `/1[3-9]\d{9}/g` 掩码为前三位加四星加后四位。昵称、头像、订单、规格、快照和媒体 URL 在 adapter 白名单过滤，仅保留回复状态、图片数量与文本标签。`REDACT_KEYS` 增加 cs_name、nickname、avatar、orderSn。
- `goods reviews` data：`{ headline, items, total, fetched_count, filtered_out_count, truncated, filter, window_days, goods_id, stars, hints, mall_id }`。`goods_id` 为字符串或 null（全店）；`stars` 为升序数字数组或 null（全部星级）；`filter` 形状为 `GOODS_REVIEWS_FILTER_FIELDS`（`{ mode, min_length }`），内部模式码 `substantive` / `min_length` / `all` 经 `views/reviews.js` 的 `GOODS_REVIEW_FILTER_MODES` 映射为中文标签 `实质内容` / `最小字数` / `全部`。上游 `/saturn/reviews/list` 保持无内容筛选请求，由视图层本地无损执行确定性过滤（`total` 保留过滤前首页 `totalRows`，`fetched_count === items.length + filtered_out_count`，与数据中心官方「有效评价」独立，`diagnose reviews` 不做内容过滤）：
  - 主评遇 `status === 4` 或精确命中 7 条前后端平台占位模板有效字数为 `0`；追评独立判定；非占位文本先剔除 Emoji 展示序列（`\p{RGI_Emoji}`）再提取非 Emoji 的 Unicode 字母/汉字（`[\p{L}--\p{Emoji}]`），清洗后长度 `>= 2` 且全字符相同（忽略大小写）计为 `0`（单字保留）；零主观词表、零外部 AI。
  - 默认 `substantive`（输出 `mode: '实质内容'`，`min_length: 1`）保留主评或追评有效字数 `>= 1` 或有效评分为整数 1–3 星的 **Negative Review**（`effectiveScore = score !== 0 ? score : descScore` 且为 `1..3` 整数，排除 `0`、负值与非整数），4–5 星纯图/纯视频/纯标签条目被剔除；`min_length` 模式（输出 `mode: '最小字数'`）严格按主评或追评有效字数 `>= min_length` 筛选（无中差评兜底）；`all` 模式（输出 `mode: '全部'`，`min_length: null`）保留全部已采集条目（`filtered_out_count: 0`）。
  - headline 首行：`all`（全部）为「近 N 天<scope><starsLabel>评价 T 条」，`substantive`（实质内容）追加「，实质内容 K 条」，`min_length`（最小字数）追加「，有效字数 ≥ M 字 K 条」；`truncated: true` 时追加「已采集 F 条，结果已截断」（`F` 为 `fetched_count`）。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 客服 days 越界或评价 days 非指定值 | `E_USAGE` / exit 2，请求前校验 |
| `goods reviews` 的 days 非 1-365 整数、goods-id 非正整数、stars 含 1-5 以外的值或空段、`--all` 与 `--min-length` 同时传入、或 `--min-length` 非 `>= 1` 整数 | CLI 解析阶段拒绝（`E_USAGE` / exit 2，`xhr_count` 0）；`days` 由 `runReport` 兜底校验，其余选项由命令注册器独占校验，服务层仅做纯模式选择 |
| 客服 overview 失败 | 整体失败 |
| `goods reviews` 列表失败 | 整体失败，原错误透传 |
| 客服 trend 的可降级 PddCliError | `trend:null` 并追加 hint |
| 客服销售区间汇总的可降级 PddCliError | `sales:null` 并追加「客服销售数据拉取失败」，不再请求逐日接口；`summary`、`trend` 照常 |
| 客服销售逐日（含页签点击失败）的可降级 PddCliError | 仅 `sales.trend:null` 并追加「客服销售逐日趋势拉取失败」 |
| 客服今日或任一评价源的可降级 PddCliError | 对应部分 null 并追加 hint；原评价三源全失败抛最后一个错误 |
| `reviews.goodsScores` 出现可降级 PddCliError 或字体混淆 `E_BUSINESS` | `goods_scores:null` 并追加「商品评分拉取失败」，不追加商品评分 headline，不影响命令整体成败 |
| 程序异常、超时、取消 | 继续抛出 |
| 上游集合、商品评分结构或列表 totalRows 缺失 | adapter 抛 `E_NETWORK` |

### 5. Good/Base/Bad Cases

- Good：回复率 0.666666 输出 66.67，响应 14.666 秒输出 14.67，无咨询日仍保留类目均值。
- Good：`--days 63` 时 `window.days` 为 63、`sales.window.days` 为 62，两个窗口各自如实标注。
- Base：评价列表为空时输出空 items 和 total 0，其余数据源独立存在；商品评分评价数为 0 时三项均分输出 `null`。
- Bad：把人工回复序列与星级口径合并、自行分词、输出完整评价原始对象、把商品评分 0 评价均分原样输出为 0。

### 6. Tests Required

`customer-service-contract.test.js` / `reviews-contract.test.js` 覆盖 payload、方法（含 page-api GET）、成功判定、白名单、`REVIEWS_LIST` 内部 `status` 提取与商品评分 PUA 混淆检测；对应 view/service 测试覆盖字段、单位、窗口、null、掩码、分页与降级；客服销售区块另覆盖 3 天滞后窗口与 62 天上限、四种逐日空值形态、两级降级和 headline 三种写法；客服今日实时另覆盖三端点、`Reply-Rate Caliber`、小时零填充升序与 `today_unavailable` 降级；商品评分区块另覆盖固定 30 日窗口、200 上限截断、0 评价均分 null 与独立降级。两个同名 e2e 验证单行 envelope、隐私剔除、参数 exit 2、分页截断与数据源失败；`reviews.e2e.test.js` 与 `reviews.test.js` / `reviews-view.test.js` 同时覆盖 `goods reviews` 的筛选透传、默认 Substantive Review 过滤、`--all` / `--min-length` 模式、解析阶段参数互斥与非法值拒绝、`fetched_count` / `filtered_out_count` / `filter` 中文标签回显、headline 与 2000 条上限（同时确保 `diagnose reviews` 与 `REVIEW_FIELDS` 不受影响），`numeric-options.test.js` 覆盖 `goodsIdArg` / `starsArg` / `integerArg`；`data-contract-v2.test.js` 用 entityFields 覆盖所有实体数组与对象（含 `goods_scores`、`goods_scores.items[]`、`goods.reviews` 默认 / `--all` / `--min-length` 的 `filter` 中文标签与 `items[]`、`today` 与 `today.hourly[]`）。

### 7. Wrong vs Correct

Wrong：仅传 pageNo 给 fixture 分页器，重复读取第一页；将 descScore 发为数字数组。
Correct：内部 page 与 pageNo 同步，buildPayload 保留精确请求格式；descScore 为字符串数组，`diagnose reviews` 固定 `['1','2','3']`，`goods reviews` 取 `starsArg` 的解析结果。

## Scenario: Traffic and Goods Traffic

### 1. Scope / Trigger

适用于全店逐日流量及商品区间流量，保持现有 diagnose 四维汇总。

### 2. Signatures

`getTrafficView(ctx, { days = 30 })` → `diagnose traffic`；`getGoodsTrafficView(ctx, { days = 30, goodsId })` → `goods traffic`。命令均为 needsAuth:true、needsMall:'switch'。

### 3. Contracts

- 全店 days 为 1-30 整数；先 `traffic.readyTime` 再 `traffic.overviewList`，page-api POST `/sydney/api/mallFlow/queryMallFlowOverViewReadyTime`（空请求；三个流量端点均以 `success: true` 且 errorCode ∈ `SUCCESS_BUSINESS_CODES`（0/1000000）为成功）及 `queryMallFlowOverViewList`（beginDate/endDate）。截止日取 readyTime，逐日行及同行均值/优秀值映射由 `views/traffic.js` 拥有；只汇总访客、订单、金额，提示访客跨日重复；窗口内无返回统计日时 summary 各项为 null，返回日数少于窗口天数时追加提示。
- 今日实时区块（2026-11, `.scratch/realtime-data/issues/02-shop-today.md`）：逐日数据之后经 `collectToday(report, collect)`（`services/today.js`）调用 `traffic.todayFlow`（POST `/sydney/api/mallFlow/queryMallFlowRtData`，空请求，投影 `muvRt`/`mpvRt`/`guvRt`/`gpvRt`）与 `traffic.todayTrade`（POST `/sydney/api/mallTrade/queryMallTradeList`，`{ queryType: 6, queryDate: <上海今天> }`，`todayRtList[]` 按小时累计，`hr` 必须为 "00".."23"）。`data.today` 字段为 `TRAFFIC_TODAY_FIELDS`：`snapshot_at`（CLI 抓取时间，上游不返回快照时间）、`as_of_hour`（最新累计行 `hr`）、四项流量实时值、最新累计行的成交字段、`hourly[]`（`TRAFFIC_TODAY_HOURLY_FIELDS`）；两接口刷新时点不同，不交叉计算。无累计行时成交字段 null、`hourly: []`。`report.optional('today_unavailable')` 语义：普通 `PddCliError`（E_NETWORK / E_BUSINESS / E_RATE_LIMIT 等）→ `today: null` + 提示，逐日数据照常；E_TIMEOUT、E_INTERNAL、取消与程序异常透传。
- 商品 days 仅 1/7/30 → queryType 0/1/2；窗口与全店相同，截止日取 `traffic.readyTime`（结束日晚于就绪日时平台返回空列表）。`traffic.goodsDetailList` page-api POST `/sydney/api/goodsDataShow/queryGoodsDetailVOList`，参数 startDate/endDate/queryType/sortCol:0/sortType:1/pageNum/pageSize:50/goodsId?，省略 actVs。按 totalNum 翻页，最多 20 页。行白名单在 `views/goods-traffic.js`；数值字段（含 goodsId）中的 PUA 字符触发 E_BUSINESS，商品名、类目等原文字段不做该检测。
- `promo.goodsPromotionList` 复用 fetch 请求体合并策略，保留页面生成签名。POST `/mms-gateway/venus/api/goods/promotion/v3/list`：beginDate/endDate/blockType:3/clientType:1/pageNumber/pageSize:50/filter.searchKeyV2（当前批商品 ID 逗号拼接）/sortBy:9999/orderBy:9999/scenesMode:1 或 3/withTagsInfo:true。每批最多 50 个商品，每场景最多 20 页；只累加当前批的商品，阻止上游忽略过滤条件时重复归属。
- adapter 依次展开 optimizationMessage/reportInfo/reportInfo2；空串视为缺失，金额对象读取 value（无 unit/YUAN 按元，FEN 除 100，PERCENT 除 unitCode 或 100；其他单位输出 null 并追加 promo_unknown_unit 提示，与 promo.js MoneyVO 一致），裸数字厘除 1000，转整数分后累计。adInfos:null 且 totalAdNum:0 为未开通；未知金额传播 null。
- non_promo_* = 商品总量减去推广直接成交；间接成交单列。负差额 null/hint；推广可降级 PddCliError 或分页上限使全部推广和差值 null，promo_complete:false；完整无记录为 0。所有输出保留固定口径及尚未经有投放店铺实测的提示。
- 商品今日实时区块（2026-11, `.scratch/realtime-data/issues/03-goods-today.md`, `04-goods-single-today.md`）：推广采集之后经 `collectToday(report, collect)` 采集 `today`，`getGoodsTrafficView` 返回 `{ data, warnings }`（由 runner 合入 `meta.warnings`）。未传 `--goods-id` 调用 `traffic.goodsTodayOverview`（POST `/sydney/api/goodsDataShow/queryGoodsPageRT`，白名单投影 6 个 `*Rt` 字段并排除昨日无 `Rt` 字段；检测 PUA；显式 `null` 静默输出 `null`，无法解析的非 `null` 格式串或值置 `null` 并写入 `goods_today_parse_failed` warning；shape 为 `GOODS_TRAFFIC_TODAY_OVERVIEW_FIELDS`）。传入 `--goods-id` 调用 `traffic.goodsTodayStat`（POST `/sydney/api/goodsDataShow/queryGoodsStatDtr` `{ goodsId }`，仅投影 `todayGoodsDetail` 与 `todayGoodsDetailList` 并排除 `yesterdayGoodsDetail*`；允许全 `null` 的 `todayGoodsDetail` 与指标为 `null` 的小时行；shape 为 `GOODS_TRAFFIC_TODAY_SINGLE_FIELDS` 与按 `statHr` 升序的 `hourly[]` `GOODS_TRAFFIC_TODAY_HOURLY_FIELDS`，`todayGoodsDetail` 实时汇总与 `todayGoodsDetailList` 小时截止相互独立陈述）。`today` 走 `report.optional('today_unavailable')`，PUA/业务/网络/限流失败降级 `today: null` 与 hint、退出码 0，历史明细与推广照常输出；超时与程序异常继续抛出。

### 4. Validation & Error Matrix

days 越界 / 非法 goods-id → E_USAGE / exit 2，请求前验证；主流量/明细失败 → 整体失败；逐日 statDate 缺失或日期无效 → E_NETWORK，避免窗口过滤静默丢行；推广普通 PddCliError → 降级；今日实时 PddCliError（含 PUA 混淆） → `today: null` + `today_unavailable` hint；超时、取消、程序异常 → 传播。商品提前空页且尚未达到总量也标记 goods_truncated。

### 5. Good/Base/Bad Cases

Good：两场景直接成交 1.23 元各一条，合计 2.46 元，再从商品总额减去。Base：未开通推广返回 0。Bad：跨批重复累计同一推广行、失败补零、将访客按推广拆分。

### 6. Tests Required

`traffic-contract.test.js`：请求、PUA、缺集合、金额形态、空串回退、未开通、全店与商品今日端点。`traffic-view.test.js`：白名单、百分数、金额、格式化字符串与 parse warning、null、同行映射、全店与商品 today 区块。`today.test.js`：上海日期、抓取时间、降级与透传。`traffic.test.js`：窗口、原生 queryType、双场景、跨批归属、分页、失败降级和异常传播。两条 fixture e2e 和 data-contract-v2 的实体字段集覆盖最终 JSON（含全店与 `--goods-id` 的 `today` 与 `today.hourly[]`）。

### 7. Wrong vs Correct

Wrong：total - (direct + indirect)，推广失败时输出 0。Correct：仅减 direct，失败时输出 null 并标记 promo_complete:false。

## Scenario: Consumer Experience Plan Charge Records

### 1. Scope / Trigger

`goods profit` 的运费险（`insurance_fen`）来源：消费者体验提升计划（退货包运费）收费记录 `experiencePlan.orderInsuranceList`。只读；同模块写接口（`close_service`、`pause_service`、`openService`、`refreshServiceStatus`）一律不接入。原只读命令 `diagnose experience-plan` 已于 2026-11-15 按用户要求移除，CLI 不再单独输出计划状态、费率或收费记录。

### 2. Contracts

- 端点：page-api POST `/mms-gateway/rfreight/postpaid/order_insurance_list`，导航 `https://mms.pinduoduo.com/freight/return_freight`；成功码为 `success:true` 且 `errorCode` 为 `0`（page-api 合成外壳）或 `1000`（浏览器抓包）。
- 请求：`{ pageSize: 100, pageNumber: page-1, queryFeeStatusList: [1, 2], clientType: 1, createBeginTime, createEndTime }`（1 待收费、2 收费成功，不含 3 收费取消；按创建时间毫秒筛选，单次跨度 ≤ 30 天）。筛选条件与页面默认一致；`pageSize` 页面默认 10，2026-11-15 真实账号只读实测 50 / 100 均可用。
- 投影只保留 `orderSn`、`serviceAmountVO`、`feeStatusDesc`；`batchSn`、`sn`、`mallId`、`uid` 等不进入服务层。
- 金额对象仅 `unit === 'YUAN'` 时按字符串精确解析（`parseYuanToFen`）；其他或缺失单位该单记 null 并按单位去重写入 `meta.warnings`。解析与 promo MoneyVO 语义不同，不共用；实现位于 `src/services/goods-profit-insurance.js`。

### 3. Tests Required

`experience-plan-contract.test.js`（端点路径、请求体、成功码、白名单、缺形态拒绝）、`goods-profit-insurance.test.js`（分段、翻页、截断、失败、金额单位）、`page-api-success-guard.test.js`。

## Scenario: Goods Cost and Net Profit

- services/goods-cost-input.js 单独拥有非负元金额、精确规格及字符串 ID 校验；goods-cost.js 编排本地预演/确认，goods-cost-import.js 原生解析 UTF-8 JSON 后整批校验（1 MiB / 5000 条）。未知列、重复商品/规格键、坏行全部拒绝，无先写好行行为。成本项为货本、包材、快递、技术服务费（COST_NAMES），不含运费险：`insurance_yuan` 输入报 E_USAGE（字段 insurance_yuan，导入时进入 row_errors），set 无 `--insurance-yuan` 选项（commander 未知选项，退出码 2），list/set/remove 输出无 insurance_yuan。
- goods.profit days 为 1–90，默认 30；按 confirm_time 成交时间（秒，等于支付时间）统计上海最近 N 个完整自然日、不含当天，[start,end)；orders.list 不返回 group_time，不为成团时间逐单调用订单详情。复用 `collectOrdersWindow`，显式 scope all、size 50、since=start/until=end-1（按下单时间覆盖窗口，成交晚于下单）。保留 truncation/rate-limit，按成交时间过滤、订单号内部去重（事实字段含 confirm_time）；confirm_time 为 0 的未付款取消静默排除，其余缺失、非数字或为 0 的样本及冲突样本标不完整（hint invalid_order_window）。
- goods-profit-calculation.js 是纯函数：收入=order_amount+platform_discount，不重复加 shipping_amount 或扣 merchant_discount。未付款取消收入及所有成本 0；退款成功（5）收入/货本 0，已发货扣包材/快递/技术服务费，未发货为 0，发货时间缺失/无效时这些费用 null。5 以外的非空整数售后码（10/11 及未登记的 6/31 等）按售后处理中正常计算并单列单数及收入；售后码缺失或非整数时相关财务 null。
- 运费险（insurance_fen）不属于成本录入（ADR 0004），PROFIT_COST_FIELDS 在 COST_NAMES 之外单独追加，取 goods-profit-insurance.js 采集的体验提升计划收费记录（`experiencePlan.orderInsuranceList`，queryFeeStatusList [1,2]，pageSize 100），按 order_sn 对齐、同单多条求和。采集窗口：createBeginTime = 窗口起点前 1 天，createEndTime = 窗口终点 - 1ms，按 ≤30 天分段；每段翻页取满 total，单段页数上限（默认 50）触顶记 truncated，空页提前结束或 total 漂移记不完整。逐单：未付款取消 0；「收费成功」计入（退款不扣回）；「待收费」退款为 0、正常/10/11 计入、未知售后状态 null；其他收费状态文案 null + warning；无记录 0（仅记录完整时）。金额仅 YUAN（planMoneyReader），其他单位 null + warning。采集失败（PddCliError，report.optional）或不完整：运费险、商家成本、毛利、净利 null，hint `insurance_unavailable` / `insurance_incomplete`，data_quality `insurance_complete` / `insurance_truncated`，退出码不变。运费补偿由平台支付给买家，不是商家成本，不计入。
- 成本先精确 spec，后商品默认，无匹配则利润/率 null；货本乘 goods_number，按单项只扣一次，缺数量只影响依赖数量的项。cost_updated_at 是实际使用记录的最大时间，default_fallback_order_count 为非空规格未命中后实际回落单数；成本只有当前值，历史查询会重算。
- goods-profit-promo.js 完整分页 entityReport，保留已删除推广历史，只按 goodsId 归属，无名称回退。商品花费按实体归属合计，全店 promo_spend_yuan 取 totals.spend，shop_promo_spend_yuan 为总计减归属合计；负差额为 null/hint，已知总计和按总计计算的净利润保留。totals 每页不累加；口径固定提示“仅含商品推广报表口径”，关注/询单覆盖留后续研究。
- 推广失败/截断/限流相关花费与净利润 null；完整无该商品记录为 0，金额无效保留 null。窗口订单采集不完整时窗口财务 null，observed_order_count/observed_revenue_yuan 保留样本。summary 严格传播所需未知输入，禁止仅合计有成本商品。
- view 白名单由 views/goods-cost.js / goods-profit.js 导出，中文 availability 表在 labels.js，利润 hints 归 goods-profit view 的报表声明所有。gross_margin_pct/net_margin_pct 为有符号百分数，可超过 ±100 且原样保留，零收入为 null。filter_goods_id 仅筛 items，summary 全店。固定提示当前成本重算、运费险取平台逐单收费记录与两项高估：仅退款不退货、商家共担补贴。
- 测试：goods-cost*、goods-profit* 服务/视图单测，orders-scope/orders-contract/promo-money 回归，两个 goods 成本/利润 fixture e2e 与五个命令的 data-contract-v2；共享 runner/存储改动执行 npm test。

## Scenario: Goods Estimated Receipt

- `getGoodsReceiptView(ctx, { goodsIds = [], page = 1, size = 10, caliber = 'regular' })` → `goods receipt`。选项已由 commander 校验，service 只把口径名解析为 `RECEIPT_CALIBERS` 场景表（未知口径防御为 E_USAGE）。术语见 GLOSSARY.md「Estimated Merchant Receipt」，PRD 见 `.scratch/goods-receipt/spec.md`。
- 口径只靠请求的 `consult_price_scene_list` 携带，服务端不保存：常规 7/8、所有优惠 10/11；场景 9（未来走势）不用。`RECEIPT_CALIBERS` 是场景值唯一来源，列表与补全请求共用。
- 列表 `goodsPrice.list` 每页最多 10 个商品、每个商品只带回部分 SKU；`remain_sku_num > 0` 的商品按顺序调用 `goodsPrice.expand` 补全（带已拿到的 SKU ID），按 sku_id 去重追加，少于平台报告数时告警 `receipt_sku_incomplete`；补全业务错误整体 E_BUSINESS / exit 6，不输出半截列表。`xhr_count` = 1 + 补全次数。
- 每个 SKU 只采用当前口径的单件 / 多件场景，其他场景忽略并告警 `receipt_scene_ignored`；缺单件场景 `single: null` 并告警 `receipt_single_missing`，缺多件场景 `multi: null`。平台明确无优惠为 0 / `[]`。
- views/goods-receipt.js 拥有白名单与分转元：券前价取活动价（来源为 activity_type_desc）否则拼单价（来源「拼单价」）；多件 `discounts` 为合计。数值全部原样报告，不重算、不推导技术服务费或补贴。

## Scenario: After-Sales Case Reporting

- `getAfterSalesView(ctx, { days, since, until, sn, goodsId, status, type })` 按售后申请时间采集。传入 `since` 时用精确 Unix 秒闭区间（`until` 默认当前秒，`window.days` 为 `null`）；仅传 `sn` 且未指定时间时查全历史，省略请求时间字段，三个 `window` 字段均为 `null`；其余情况采用 `rollingSecondsWindow`（默认 30 天）。时间回显为北京时间。
- `sn` / `goodsId` 共用上游 `searchText`；状态筛选交给上游 `afterSalesStatusList`，保留返回的未登记状态码。商品 ID 筛选同样由上游完成。本地只复核订单号和售后类型；原因汇总与 `fetched_count` 基于复核后的明细，`total` 始终保留平台首页总数。售后单级别的枚举表归 `views/after-sales.js`；订单列表、订单统计、售后诊断和净利润维持原有订单级口径（ADR 0006）。
- `after_sales.list` 每页 100 条，最多 20 页，保留首页的 `total`；遇到短页或收满总数即停止。只有第 20 页取满且尚未覆盖总数时，`truncated: true`，摘要与提示同时标明上限。可选 `after_sales.params` 拉取失败时追加提示并保留明细；`E_TIMEOUT`、`E_INTERNAL`、取消及程序异常继续传播。
- 输出为 `{ headline, window, filters, total, fetched_count, truncated, reason_summary, items, hints, mall_id }`。明细遵循 `AFTER_SALES_CASE_FIELDS`；原因按文案聚合，缺文案时回退 `未知(<code>)` 或 `未知`。组内大类须全部已知且一致才输出；退款金额按分加总后转元，总占比以 `fetched_count` 为分母。排序依次为单数降序、退款金额降序、原因文案升序。
- `orders detail` 详情输出为 `{ headline, order, after_sales_cases, hints, mall_id }`（加 `--with-track` 时附加 `track`，遵循 `ORDER_DETAIL_TRACK_FIELDS`）。仅当上游详情的 `after_sales_id` 或 `after_sales_status_code` 非空时调用 `getOrderAfterSalesCases(ctx, orderSn)`。`toOrderDetailView` 在 `after_sales_status` 无有效数字时改用 `after_sales_status_code`（仍用订单级 `AFTER_SALES_STATUS_LABEL`，无状态码且原文非数字时输出 `null`）。传 `withTrack: true` 时调用 `collectOrderTrack`，复用 `caseEntries` 拉取 `logistics.forwardTrack` 及带 `reverseShippingId` 与 `reverseTrackingNumber` 的售后单 `logistics.reverseTrack`；缺失正向/逆向轨迹（含 `available: true` 但无承运商节点的空轨迹与 `forward_no_carrier_trace`）、缺逆向物流公司 ID 或可降级失败（不含超时、取消、`E_RATE_LIMIT`、`E_RISK_CONTROL` 与 `E_AUTH_*`）时附 `hints` 并继续返回订单详情，摘要控制在 `<= 4` 行内且第 4 行耗时严格对齐 `returns[0]`（按 `return_delivery_event === '已入柜/驿站待取'` 区分「退回到达」与「退回签收」）。正向/逆向送达时刻遵循 `DELIVERY_CALIBER`（`IN_CABINET` 最早时刻优先，否则取 `SIGN` / `SIGN_ON_BEHALF` / `OUT_CABINET` 最早时刻），中转仓入库/合包/出库（`INBOUND` / `UNPACKING` / `OUTBOUND`，避开快递柜/驿站入出库文案误判）与二段揽收会重置第一段交接标记；输出字符串 `shipping_id` / `reverse_shipping_id`、中文 `delivery_event` / `return_delivery_event` 及各阶段 `_days`；`traces[]` 节点遵循 `{ occurred_at, status, summary }`，严格使用闭合中文状态/摘要白名单（未知状态统一归入 `OTHER` / `其他节点`），不保留原始轨迹文本或客服热线。
- `getOrderAfterSalesCases` 复用分页采集，以 `searchText` 查询单号（无时间窗），再本地精确匹配单号，按 `createdAt` 数值倒序、同秒按 `id` 数值倒序，沿用 `AFTER_SALES_CASE_FIELDS` 并返回 `{ cases, caseEntries, hints, requestCount }`。仅在有匹配时查询原因字典。无售后标识或无匹配时售后单为 `[]`；检索被截断时追加提示，即使已采集的明细无精确匹配。可降级的列表错误返回 `null` 并附中文提示，可降级的字典错误保留售后单并将 `reason_category` 置为 `null`。两者均沿用报表错误策略，继续传播超时、取消及程序异常。`requestCount` 包含失败的逻辑端点调用，详情将其计入 `meta.xhr_count`。
- `getAfterSalesView` 在 `withDelivery: false` 时输出与原契约完全一致（不含 `delivery` 键，明细保持 `AFTER_SALES_CASE_FIELDS`）；传入 `withDelivery: true`（`--max-track-fetches` 需配合 `--with-delivery` 使用，1–500 默认 50）时，严格按 `isAfterSalesCaseShipped`（匹配 `shipping_status === '已发货'`）识别已发货售后单并按唯一 `orderSn` 在单次命令内去重，在配额内实时调用 `logistics.forwardTrack`（无本地持久化缓存），遇到 `E_RATE_LIMIT` / `delivery_track_capped` / 可降级失败（不含超时、取消、`E_RISK_CONTROL` 与 `E_AUTH_*`）停止或降级并保留已成功采集的结果；遇到 `E_RATE_LIMIT` 中止后，未查询订单置为 `delivery_source: '流控中止未查'` 并计入 `skipped_throttled_orders_count`。输出改为 `{ data, meta: { xhr_count } }`，明细使用 `AFTER_SALES_CASE_WITH_DELIVERY_FIELDS`（中文 `delivery_event` 与 `delivery_source`；`shipping_status` 缺失或未知时 `delivery_source` 为 `null`），根级追加 `delivery`（`AFTER_SALES_DELIVERY_SUMMARY_FIELDS` 区分 `fetched_orders_count`、`delivered_orders_count`、`skipped_cap_orders_count` 与 `skipped_throttled_orders_count`，含 `avg_days`、`p50_days`、`p90_days`、`min_days`、`max_days`），截断时将提示并入 `headline[0]` 以维持 `<= 3` 行。`services/logistics.js` 不得反向 import `services/after-sales.js`。

## Scenario: Order list scope & refund identification

### 1. Scope / Trigger
- Trigger: any change to `listOrders` callers, `computeOrderStats`, refund/after-sales output, or `orders list --status`. Cross-layer: CLI option → service scope → adapter `ORDER_LIST_SCOPES` → upstream `orderType` / `afterSaleType`.
- Evidence: `.trellis/tasks/10-08-orders-status-and-refund/research/order-list-filters-2026-10-08.md`.

### 2. Signatures
```js
// src/services/orders.js
listOrders(page, { scope = 'all', page, size, since, until }, ctx)
getOrderListView(page, { scope, page, size, since, until }, ctx) // → { headline, items, total, mall_id }
computeOrderStats(orders) // → { total, status_distribution, shipping_seconds, refund_count, after_sales_count, refund_rate }
export { ORDER_LIST_CLI_SCOPES, ORDER_LIST_DEFAULT_SCOPE } // re-exported for commands (no adapter import)
// src/services/orders.js
collectOrdersWindow(page, ctx, { scope = 'valid', scanDays, maxPages, pageSize })
```
CLI: `pdd orders list [--status all|pending_ship|shipped|received|after_sales]` (default `all`).

### 3. Contracts
- Caller → scope mapping (MUST hold):

| Caller | Scope | Why |
| --- | --- | --- |
| `orders list` default | `all` | 待发货 / 售后 / 退款 / 已取消 must be visible |
| `getOrderStatsView` local sample | `all` | refund counts need after-sales orders |
| `collectOrdersInput` (diagnose orders / shop / compare) | `all` | same |
| `getAfterSalesDiagnosis` | `all` | same |
| `goods profit` | `all` | 成交时间完整窗口须包含退款和 10/11（未付款取消没有成交时间，过滤时排除）；显式覆盖 collector 的 valid 默认 |
| `collectGoodsInput` (diagnose inventory), `goods segment` | `valid` (default) | sales = paid orders without after-sales, all shipping states |

- Refund identification uses ONLY order `after_sales_status`: `5` → refunded (`refund_count`); any other non-null code → in progress (`after_sales_count`). String codes are compared numerically (`'5'` counts as refunded). `refund_status` / `refundStatus` / `after_sale_type` / `afterSaleType` do not exist upstream and MUST NOT be read.
- Field presence: `hasField = orders.some((o) => Object.hasOwn(o, 'after_sales_status'))`.

| Sample | `refund_count` / `after_sales_count` | `refund_rate` |
| --- | --- | --- |
| empty | `0` | `null` |
| non-empty, `hasField` | counts | `refunded / total` |
| non-empty, no order has the key | `null` | `null` |

- Views: `toLocalOrderStatsView` emits `refund_count`, `after_sales_count`, `refund_rate_pct` (null-propagating); headline sentence 「退款成功 X 单，售后处理中 Y 单」 or 「退款数据不可用」.
- Known limitation: the refund-rate denominator includes 「已取消」 (unpaid, `pay_status=0`) orders; the list window (`groupStartTime`, default 7 days) also bounds `--status pending_ship`.

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| `--status` not in `ORDER_LIST_CLI_SCOPES` (incl. internal `valid`) | `E_USAGE`, exit 2 (command layer) |
| unknown `params.scope` reaching adapter | `E_USAGE` from `buildPayload` (defensive) |
| `after_sales_status` key absent on every sampled order | counts/rates null + hint; never 0 |
| `after_sales_status` code not in label table | label `未知(<code>)`, counted as in-progress |

### 5. Good/Base/Bad Cases
- Good: 7-day `orders list` returns 39 orders incl. 「售后处理中」 labels; `--status pending_ship` count equals `orders stats` `pending_ship_count` (live 2026-10-08: 8 = 8).
- Base: fixture orders all carry `after_sales_status: null` → `refund_count: 0`, rate computed.
- Bad: list requested with `afterSaleType: 1` and refunds counted from it — refunds are filtered out upstream, so the count is always 0.

### 6. Tests Required
- `test/adapter/orders-contract.test.js`: default payload 0/0, all scope mappings, unknown scope `E_USAGE`.
- `test/services/orders-statistics.test.js`: null/5/10/11 sample counts; field-absent → null; empty → 0 / null; legacy refund fields ignored.
- `test/services/orders-scope.test.js`: scope passed to `orders.list` per caller (table above).
- `test/services/diagnose-facts.test.js`: after-sales/orders null propagation, independent refund/open counts and rates, empty denominators, absence of `fulfillment_rate_pct`.
- `test/e2e/factual-surface.e2e.test.js`: `diagnose after-sales` and shop `dimensions.after_sales` preserve refund/open counts and rates; comparison tests cover `compare.dimensions.after_sales`.
- e2e: `orders list --status pending_ship` succeeds; `--status bogus` exit 2; contract-v2 covers the `--status` variant.

### 7. Wrong vs Correct
#### Wrong
```js
const hasRefund = Boolean(o?.refund_status ?? o?.after_sale_type); // fields never exist → always 0
listOrders(page, { page: 1, size: 50 }, ctx);                       // old default 2/1 hid refunds
```
#### Correct
```js
const stats = computeOrderStats((await listOrders(page, { scope: 'all', page: 1, size: 50 }, ctx)).orders);
// refund_count from after_sales_status === 5; null when the field is absent
```

## Scenario: Console Authentication and Account API (P3)

### 1. Scope / Trigger

Applies to `services/console-*.js`, `services/views/console.js`, `daemon/server.js` and its HTTP/routing/static helpers, and `console link`. Interactive sessions and relogin/QR routes belong to P4.

### 2. Signatures

```js
createConsoleLink({ accountId = null }) -> { url, expires_at }; // internal expires_at: ISO
redeemConsoleToken(consoleToken) -> { sessionValue, accountSlug }; // sync, one transaction
resolveConsoleSession(consoleSession) -> { account_id, created_at, expires_at } | null;
consoleSessionCookie(consoleSession, runtimeConfig) -> string;
getAuthStateMetadata(accountId) -> metadata | null; // adapter; no decryption
createConsoleServer() -> { start(context), stop(), address() }; // daemon component
```

- `pdd console link [--account <slug>]` uses global `--account`, `needsAuth:false`, `needsBrowser:false`; v2 data is `{ headline, url, expires_at }`, with local `expires_at`.
- `GET /api/accounts` returns `{ items: [...] }`; each item's keys equal `CONSOLE_ACCOUNT_VIEW_FIELDS`: `slug`, `display_name`, `mall_id`, `session_status`, `has_password`, `password_relogin_status`, `pending_actions`, `status_kind`, `status`, `status_detail`.
- Console account status is a console-only projection (CLI `account.list` / `doctor` and shared labels unchanged). `status_kind` is a machine value matched top-down: `relogin_paused` (relogin summary `blocked`, read from the raw summary even without a password) → `action_required` (`awaiting_human` or any open pending action) → `relogin_required` (verdict `rejected`) → `verified` → `unknown`. `status` is `暂停/需验证/失效/正常/未知`; `status_detail` is one fixed Chinese line from the console tables in `views/console.js` (`自动登录暂停：<原因>`, challenge detail from the summary reason, else `待处理：<原因>` from the first open `human_takeover` or first open action, else the verdict detail / `暂无核验记录`; `null` for `verified` / `relogin_required`, whose badge already states the verdict). Raw codes never reach these fields. The frontend chooses buttons from `status_kind`, never from Chinese text.
- `POST /api/accounts/:slug/password` accepts `{ login_name, password }`, returns `{ ok:true, has_password:true }`; `/password/clear` returns `{ ok:true, has_password:false }`; `/unblock` returns `{ ok:true }`.
- `GET /api/patrol` returns `{ enabled, interval_minutes, last_patrol_at }` (live state of the daemon's patrol component; local time). `POST /api/patrol` accepts `{ enabled: boolean }` (else 400 `E_USAGE`), writes `patrolEnabled` to the local config via `setLocalConfigValue` (same file as `pdd config set`), then starts/stops the loop without a restart and returns the same view. When env/CLI overrides the local value it returns 409 `E_CONFIG_OVERRIDDEN`; without a wired patrol component 503 `E_PATROL_UNAVAILABLE`. Routes are matched by path and method, so one path may serve GET and POST.
- `POST /api/accounts/:slug/remove` accepts `{ confirm_name }`; it must equal the shop's `display_name` (else slug) after trim, otherwise 400 `E_USAGE` `店铺名不一致，未删除`. An active console login session for the account returns 409 `E_CONSOLE_SESSION_STATE`. Success deletes through `removeAccountView(slug, { confirm: true })` (same cascade as the CLI) and returns `{ ok:true, removed:true }`.
- `pdd account remove --slug <slug>` previews unless `--confirm`. Data fields: `headline`, `slug`, `display_name`, `was_default`, `has_password`, `has_login_state`, `goods_entry_count` (goods cost entries), `removed`, `dry_run`. Footprint is counted by SQL only (no decryption), so removal still works when the master key no longer matches.

### 3. Contracts

- Generate 32 random bytes for token/session values; persist only SHA-256 hex hashes. Links last 10 minutes; sessions last 8 hours without renewal. One short synchronous transaction validates/consumes the token and inserts the session; insertion failure rolls back consumption. A null account binding is valid; the binding only chooses the landing page.
- Keep raw secrets under `consoleToken` / `consoleSession` names. `sessionValue` is the redemption return field; destructure it immediately as `consoleSession`. The CLI link's `data.url` is the intentional secret-output exception and never enters logs.
- Cookie: `pdd_console=<value>; HttpOnly; SameSite=Strict; Path=/`; add `Secure` only when `consolePublicUrl` is HTTPS.
- Metadata reads use `getAuthStateMetadata`, without decrypting stored browser state. Prefer `metadata.last_check.verdict`, falling back to `check_verdict`; shared verdicts/reasons use `labels.js`, and console-only action kinds use their owning view's table. Missing verdict is null; action timestamps are local strings. Reuse `formatPasswordReloginStatus`.
- Password writes reuse existing credential services, immediately discard parsed body fields, and return fixed whitelisted data. All account sessions can operate all merchant accounts.
- Public routes are `GET /healthz`, `GET /c/:token`, `GET /app/redeem.js`, `GET /app/styles.css`, and `POST /api/redeem`. GET previews serve a small external-script HTML page and leave the token untouched. The browser script POSTs `{ token }` with JSON and `X-PDD-Console: 1`; redemption sets the cookie and returns `{ location }` (`/` or `/#/accounts/<slug>`). Replay/expiry returns fixed 410 JSON, unless the request already carries a valid console session cookie: then it returns `{ location: '/' }` without a new cookie (same browser reopening a used link). Unauthenticated `/` returns a 401 HTML link hint.
- Require the exact configured listen Host/port or public URL host; loopback listeners also accept `localhost`, `127.0.0.1`, `[::1]` with the listen port. POST writes require JSON plus `X-PDD-Console: 1`; cap the body at 64 KiB, stop reading on HTTP 413, set `Connection: close` and destroy the socket after flushing the response instead of draining the remaining upload. Errors are `{ error:{ code, message } }` with Chinese messages and fixed safe fallbacks.
- All final responses carry no-store/nosniff/no-referrer/DENY; HTML also carries the strict self-only CSP. Parser failures use a fixed secure 400 response. Static files come only from `console/public` and `/vendor/` -> `console/vendor`, with lexical and realpath prefix checks and an explicit MIME map, including `.mjs`.
- `CONSOLE_ROUTES` owns method, route template, regex, public flag and handler. Future P4 routes go through the same guard. Access logs contain only method/template/status/duration; unknown paths use wildcard templates.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Link creation without valid daemon lease/address | `E_DAEMON_NOT_RUNNING`, exit 1 |
| Consumed, absent or malformed token | typed `E_CONSOLE_LINK_GONE`; HTTP 410 (200 `{ location: '/' }` with an existing valid session cookie) |
| Token at/past expiry | typed `E_CONSOLE_LINK_EXPIRED`; HTTP 410 |
| Absent, unknown or expired cookie | HTTP 401 |
| Host mismatch | HTTP 421 |
| Write method/header/content type invalid | HTTP 403 |
| Body exceeds 65536 bytes / invalid JSON | HTTP 413 / 400 |
| Unknown merchant slug | HTTP 404, `E_ACCOUNT_NOT_FOUND` |
| Traversal, encoded traversal, absolute path, root-escaping symlink | HTTP 404 |
| Listen EADDRINUSE | `E_CONSOLE_PORT_IN_USE` with port/address_in_use; component cleanup releases lease |

### 5. Good/Base/Bad Cases

- Good: list metadata even if the encrypted auth state is unreadable; reset/clear credentials through the existing password-relogin services.
- Base: an unbound link opens `/` and can list all accounts; a bound link changes only the landing page.
- Bad: log request URLs/headers/bodies, decrypt state merely to display a verdict, or normalize away traversal before checking path components.

### 6. Tests Required

- `test/services/console-auth.test.js`: replay, exact expiry, unknown/absent cookies, null/account binding, hashed storage, Secure flag, transactional rollback.
- `test/daemon/server.test.js`, `static.test.js`: Host, CSRF, JSON/body limit, traversal/symlinks/MIME, security headers including parser failures, account whitelist/password actions, safe access templates, occupied port lease cleanup and owner-protected metadata. Two GET previews preserve redemption; the first JSON POST succeeds and replay returns 410; replay with the issued cookie returns `/` without Set-Cookie, a stale cookie still gets 410. `test/daemon/redeem.test.js` executes the browser script and checks POST headers, navigation and fixed Chinese failure text.
- `test/e2e/console.e2e.test.js`: random-port fixture daemon and temporary DB; start/link/redeem/list/password/replay/stop; plaintext credentials absent from responses, stdout/stderr, CLI/daemon logs and DB bytes; token/session absent from logs.
- `data-contract-v2.test.js` covers `console.link`; daemon helpers allocate random ports and wait for the published URL. Run targeted tests and full `npm test`.

### 7. Wrong vs Correct

```js
// Wrong: access logs retain a one-time link secret.
log.info({ url: request.url, headers: request.headers });
// Correct: only the stable route template is retained.
log.info({ method, route: '/c/:token', status, duration_ms });
```

## Scenario: Interactive Console Login (P4)

### 1. Scope / Trigger

Applies to `services/console-login.js`, `services/console-accounts.js`, `daemon/routes.js`, `daemon/server.js`, `daemon/sse.js` and interactive auth persistence. Frontend contracts are consumed directly by `console/public/app/app.js`.

### 2. Signatures

```js
// services/console-login.js — instance-scoped console application wired by composeDaemonRuntime / createConsoleServer
createConsoleApp({ driver, seal, clock, commit, patrol, runtimeConfig }) -> {
  health: { check() },
  auth: { redeem(token), resolveSession(sessionValue), sessionCookie(sessionValue, config) },
  patrol: { get(patrol, runtimeConfig), set(patrol, body, runtimeConfig) },
  accounts: { list(), add(body, opts), savePassword(slug, body), clearPassword(slug), unblock(slug), remove(slug, body) },
  sessions: {
    start(slug, { mode: 'password' | 'qr', ownerTag, signal }) -> { session_id },
    startAdd({ login_name, password }, { ownerTag, signal }) -> { session_id },
    get(id) -> { state, message, remaining_seconds, expires_at, qr_image },
    frames(id) -> { subscribe(callback), [Symbol.asyncIterator]() },
    pointer(id, { gesture_id, seq, events, cancel? }), // { ok: true, editable, numeric, result?: 'interrupted' }
    sms(id, { code }), text(id, { text } | { key }),
    refreshQr(id), cancel(id), awaitDone(id), closeAll(),
  },
};
// services/console-accounts.js — pure local account management (zero dependency on session state machine)
removeConsoleAccount(slug, { confirm_name }, { isAccountLoggingIn }) -> { ok: true, removed: true };
saveMerchantLogin(result, initial, task); // shared verified-candidate + lease/CAS/manual-success commit
```

### 3. Contracts

- Memory-only session ids are 16 random bytes, base64url. Sessions are keyed by account id, and every add session shares the key `add`. A new session cancels the previous session with the same key and waits for its cleanup; at most two keys have active/reserved sessions. Closing resources still occupy a slot. Terminal status remains available for five minutes, then is dropped.
- Password and QR start at `/api/accounts/:slug/relogin` and `/qr` (POST `{}`); adding a shop starts at `/api/accounts/add` (POST `{ login_name, password }`, same validation as saved passwords, 400 `E_USAGE` otherwise; body fields are deleted after use). Session routes are `/api/sessions/:id`, `/frames` (GET); `/pointer`, `/text`, `/sms`, `/qr/refresh`, `/cancel` (POST). All require a console cookie; all POSTs retain JSON/custom-header checks.
- States are `filling|takeover|sms|qr|verifying|succeeded|failed|timed_out|cancelled`; message is fixed Chinese or null, expires_at is ISO, qr_image is a data URL only in QR state. Message is set only where it adds information: `sms` → `短信验证码已发送到绑定手机`; `takeover`, `qr`, `verifying` (cleared on entry, before verification awaits) and `timed_out` → null; failures and add-session success carry a fixed reason. An identity mismatch fails as `failed` with `登录店铺与所选店铺不一致，未保存` (no error code in the message); the five-field status contract stays unchanged.
- Sessions hold `withMerchantAuthUpdate` for the full operation, with the account identity and a twelve-minute deadline. Explicit starts skip automatic throttle/awaiting-human gates, retain the block gate, and use `deviceState(tx)` via `createSnapshotContext`.
- Password attempts receive seventy seconds; `beginReloginAttempt` owns attempt recording and its `fail(outcome)` records non-success results through `recordReloginOutcome` before throwing. Only challenges wait for a human: `sms` enters state `sms` (no picture; `/sms { code }` fills the login page's SMS dialog via `submitSmsCode` and returns `{ ok, result: submitted|wrong_code|form_changed }`, one submission at a time), other challenges enter `takeover` (captcha dialog relay). `form_changed` / `network_error` end the session as `failed` with a fixed message, without takeover; wrong-password/locked outcomes reuse the breaker and credential-version guard. `takeover` and `sms` expire after ten minutes and increment the timeout counter; QR uses `TIMEOUTS.LOGIN_QR` and recaptures in the same context. Cancellation and QR timeout leave the takeover counter unchanged.
- PASS_ID is an acquisition signal. Close the login page, independently verify expected identity and shop access, then call the attempt handle's `succeed(candidate)`. Live sessions retain `saveMerchantLogin` as the snapshot/account commit callback. Snapshot/account updates, manual reset, pending-action resolution and password-success outcome commit atomically; failure preserves all prior persisted state except the already-recorded attempt time. QR/manual success resets consecutive timeouts; QR keeps an existing block/action. All browser paths close resources and release leases. Daemon stop aborts sessions and rejects new starts; completed sessions drop the attempt handle along with browser/credential references.
- Add sessions hold no account lease and write no relogin state before the shop is known. They log in from a blank browser state with the submitted credential, which lives only in session memory and is cleared when the session ends. `wrong_password` / `account_locked` / `form_changed` / `network_error` end as `failed` with a fixed message and register nothing; challenges use the same `sms` / `takeover` windows (timeouts do not touch any counter). After PASS_ID the driver drains in-flight QR refreshes, closes takeover and the login page, verifies without an expected mall via `AuthPort.verifyAndSeal`, `provisionMerchantLogin` registers a new account or updates the existing one for that mall (short lease), and `setAccountPassword` saves the credential. Messages: `店铺已添加，密码已保存` / `店铺已存在，登录信息和密码已更新`.
- SSE uses `event: frame` and `{ jpeg, width, height }` (`jpeg: null` while no captcha dialog is found), no-store, five fps maximum. Backpressure drops frames until drain, then sends the latest. End/disconnect releases subscribers. Browser images, credentials and input are never logged.
- Pointer requests require a per-gesture id and zero-based batch sequence. Successful responses retain `{ ok: true, editable, numeric }`; interruption adds `result: 'interrupted'` with null focus fields. Cancellation uses the same body with `cancel: true, events: []`. The adapter owns sequencing, bounded time validation, fixed-anchor replay and idle release (browser-runtime section 10); fixture shares those rules.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| blocked account, password mode | 409 `E_AUTH_RELOGIN_BLOCKED` (`自动登录已暂停，请修改密码或扫码登录`); QR is allowed and its success keeps `blocked` |
| password mode, no stored password | 409 `E_AUTH_PASSWORD_REQUIRED` |
| third active account | 429 `E_CONSOLE_BUSY` |
| unknown/dropped id | 404 `E_CONSOLE_SESSION_NOT_FOUND` |
| wrong state for input/refresh/frames | 409 `E_CONSOLE_SESSION_STATE` |
| invalid pointer/text/key/SMS code, or add without non-empty login name/password ≤128 | 400 `E_USAGE`; no input echoed |
| concurrent SMS submission | 409 `E_CONSOLE_SESSION_STATE` |
| password outcome form_changed / network_error | session failed with fixed message; no takeover |
| daemon stopping | 503 `E_CONSOLE_STOPPING` |
| identity mismatch, cancelled task, CAS conflict, rejected/uncertain verification | preserve saved auth; terminal failed/cancelled |

### 5. Good/Base/Bad Cases

- Good: one lease surrounds browser work; final persistence remains a short synchronous transaction with a branded candidate.
- Base: fixture starts share the same registry, state machine, routes, limits and timeout counters; only acquisition/verification is substituted.
- Bad: publish takeover before CDP is ready, save a cookie merely because PASS_ID appeared, or let a slow client accumulate JPEGs.

### 6. Tests Required

- `test/services/console-login.test.js`: instance-scoped `createConsoleApp` with `InMemoryConsoleLoginDriver`, isolated temp SQLite, instance `CandidateSeal`, and controllable `clock` (zero module mocks or polling waits) covering device continuity, 70s budget, captcha takeover vs SMS single-flight vs form/network failure, add sessions (blank state, new vs existing shop, SMS, failures without registration, credential validation and body clearing), lease outside transactions, shared `beginReloginAttempt` + `saveMerchantLogin` commit, mismatch/rejected/foreign-seal/CAS preservation, partial resource cleanup, cancellation, 3-min/10-min/12-min/5-min timer boundaries, QR refresh single-flight & in-flight drain on `verifying`, same-key serial replacement & 2-key slot retention during cleanup, active-login removal guard, and `closeAll` 503 stopping gate.
- `test/services/console-accounts.test.js`: `removeConsoleAccount` confirmation validation, 409 `E_CONSOLE_SESSION_STATE` via injected `isAccountLoggingIn`, and zero-dependency isolation from `console-login` / browser modules.
- `test/adapter/takeover.test.js`, `test/adapter/console-login-driver-port.contract.test.js`, `test/daemon/sse.test.js`: CDP acks, latest-frame throttling, shared `createDeterministicTakeoverChannel` pointer timing/coordinates/serialization, validation, keys, backpressure, disconnect and decodable fixture images.
- `test/e2e/console-login.e2e.test.js`: fixture random-port/temp-DB challenge through SSE/input to success, action resolution, ordinary marker reuse with no new attempt, two-timeout breaker/unblock, QR, account replacement/global limit, daemon stop and secret-free responses/streams/stdout/logs. Run full `npm test` after targeted tests.

### 7. Wrong vs Correct

```js
// Wrong: link previews consume the one-time token.
GET('/c/:token', redeemConsoleToken);
// Correct: GET serves only a self-hosted script; the protected JSON POST consumes it.
POST('/api/redeem', { token }, { 'X-PDD-Console': '1' });
```
