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
diagnose.js       维度视图、shop 视图、compare 视图、STALE_SAMPLE_FIELDS / AMBIGUOUS_GROUP_FIELDS
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
- Command-facing results MUST go through a view in `src/services/views/`: whitelist projection (each entity view exports a `*_VIEW_FIELDS` list that equals the emitted key set), unit conversion (`src/infra/units.js`), Chinese labels and a factual `headline`. Upstream extra fields MUST NOT change the output; PII (receiver name / phone / address, `deliveryManPhone`, `refundAddressInfo` …) MUST NOT be projected。
- Internal calculators (`computeOrderStats`、`segmentGoods`、`analyzePromoRoi`、`summarize*`、`listGoods`、`listOrders`) keep internal codes and raw-ish numbers and MAY be reused by other services; only the view layer translates them. Field facts come from `.trellis/tasks/10-07-domain-view-contract-v2/research/upstream-schema-2026-10.md` (orders/goods money in fen, unix seconds with `0` = not happened)。
- Shared enum → Chinese tables live in `src/services/views/labels.js`; single-view tables live beside their owning view. Report hint tables live in each view's report declaration. Unknown enum codes render `未知(<code>)` via `labelOf`; unregistered report hint keys throw `E_INTERNAL` instead of emitting a missing label。Order status uses upstream `order_status_str` (no self-built status table)。
- Order quantity upstream field is `goods_number`; inventory/segment `readQuantity` reads `quantity ?? goods_number ?? goods_quantity ?? goodsQuantity`。
- Reused calculations such as ROI、segmentation、inventory matching MUST have one owner module and tests。
- Goods list identity MUST map `goods_id ?? goodsId ?? id ?? null` at both endpoint and service boundaries, preserving numeric/string IDs. A remaining null identity indicates upstream shape drift or a mapping regression, not normal behavior. Inventory matching MUST retain the `goods_name` fallback and may report internal `matched_by: 'mixed'` when identity is unavailable (output label `按商品名匹配（一侧缺少商品 ID）`)。
- Inventory `detail.data_quality` and segmentation `summary.data_quality` MUST distinguish `goods_complete`, `orders_complete` and each scan's truncated/rate-limited flags. Forward `goodsTotal`, `goodsScanTruncated`, and `goodsScanRateLimited` along with order flags.
- Incomplete segmentation uses internal `data_completeness` codes `partial_goods`, `partial_orders`, or `partial_goods_orders` (output as Chinese labels, see table below). Incomplete orders make `units_sold` (window given by top-level `window_days`; formerly `units_sold_30d`) and `stock_days` null; `observed_units_sold` preserves observed sales, not an estimate of the missing portion.
- Queries MUST NOT generate operating advice, grades, scores, ranks, or good/bad promo classifications. The action-plan service is removed.
- Diagnosis uses `summarizeOrders`, `summarizeInventory`, `summarizePromo`, and `summarizeAfterSales`; internal `full` / `partial` describes data availability only (output `数据完整` / `数据不完整`). Missing inputs remain visible as partial dimensions.
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
```

CLI：`pdd diagnose customer-service [--days 30]`、`pdd diagnose reviews [--days 30]`，均为 `needsAuth:true`、`needsMall:'switch'`。

### 3. Contracts

- 客服 days 为 1-63 的整数，窗口按上海日期取 `[今天-days, 昨天]`。`cs.overview` 使用 page-api POST `/desert/stat/mallServiceOverviewData`，请求 `{ startDate, endDate }`；`cs.monthTrend` 使用 legacy 导航与 `/desert\/stat\/mallMonthServiceData/` 被动捕获 GET，返回固定最近 31 天，按 `statDate` 过滤。导航页为 `/mms-chat/overview/service`；两者成功条件为 `success === true` 且 errorCode ∈ `SUCCESS_BUSINESS_CODES`（0/1000000）。
- 客服 data：`{ headline, window, caliber, summary, trend, hints, mall_id }`，口径固定「多多客服-客服数据（人工回复）」。summary 与 trend 指标映射以 `views/customer-service.js` 的 `METRICS` 为准；比率乘 100，时长单位秒、保留 2 位小数，null 保留。trend 为 null 或 `{ items:[{ date, ...summary字段, category_top10_avg_response_seconds, category_avg_response_seconds }] }`，日期升序；客服账号名及比较字段由白名单过滤。
- 评价 days 映射 `{30:1, 60:5, 90:4, 180:3}` 为 rangeType。endTime 为当前 Unix 秒，startTime=endTime-days*86400。标签和类型聚合的请求为 `{ startTime, endTime, rangeType }`；列表为 `{ startTime, endTime, pageNo, pageSize:10, descScore:['1','2','3'] }`，三个端点均为 page-api POST `/saturn/reviews/*`，导航页 `/goods/evaluation/index`。成功判定为 `success === true || errorCode === 1000000`。
- 列表每页 10 条，最多 30 页；满 30 页标记 truncated 并提示。service 调用同时携带内部 `page` 和上游 `pageNo`，fixture 分页器使用前者，`buildPayload` 仅投影后者；fixture 使用 `totalRows` 和 `data`。
- 评价 data：`{ headline, window_days, keyword_tags, issue_types, negative_reviews, hints, mall_id }`。标签 `{ name,count }`；类型 `{ name,positive_count,negative_count,share_pct }`，平台 proportion 已为 0-100。列表 `{ items,total,truncated }`，total 取 totalRows。item 字段以 `NEGATIVE_REVIEW_FIELDS` 为准；score 非零时输出 history_score，三项评分为 null。createTime 秒转上海时间；appendReview 字符串直接取，文本对象投影为文本。
- 正文和追评手机号 `/1[3-9]\d{9}/g` 掩码为前三位加四星加后四位。昵称、头像、订单、规格、快照和媒体 URL 在 adapter 白名单过滤，仅保留回复状态、图片数量与文本标签。`REDACT_KEYS` 增加 cs_name、nickname、avatar、orderSn。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 客服 days 越界或评价 days 非指定值 | `E_USAGE` / exit 2，请求前校验 |
| 客服 overview 失败 | 整体失败 |
| 客服 trend 的可降级 PddCliError | `trend:null` 并追加 hint |
| 任一评价源的可降级 PddCliError | 对应部分 null 并追加 hint；三源全失败抛最后一个错误 |
| 程序异常、超时、取消 | 继续抛出 |
| 上游集合或列表 totalRows 缺失 | adapter 抛 `E_NETWORK` |

### 5. Good/Base/Bad Cases

- Good：回复率 0.666666 输出 66.67，响应 14.666 秒输出 14.67，无咨询日仍保留类目均值。
- Base：评价列表为空时输出空 items 和 total 0，其余数据源独立存在。
- Bad：把人工回复序列与星级口径合并、自行分词、输出完整评价原始对象。

### 6. Tests Required

`customer-service-contract.test.js` / `reviews-contract.test.js` 覆盖 payload、成功判定和白名单；对应 view/service 测试覆盖字段、单位、窗口、null、掩码、分页与降级。两个同名 e2e 验证单行 envelope、隐私剔除、参数 exit 2、分页截断与数据源失败；`data-contract-v2.test.js` 用 entityFields 覆盖所有实体数组。

### 7. Wrong vs Correct

Wrong：仅传 pageNo 给 fixture 分页器，重复读取第一页；将 descScore 发为数字数组。
Correct：内部 page 与 pageNo 同步，buildPayload 保留精确请求格式；descScore 固定字符串数组 `['1','2','3']`。

## Scenario: Traffic and Goods Traffic

### 1. Scope / Trigger

适用于全店逐日流量及商品区间流量，保持现有 diagnose 四维汇总。

### 2. Signatures

`getTrafficView(ctx, { days = 30 })` → `diagnose traffic`；`getGoodsTrafficView(ctx, { days = 30, goodsId })` → `goods traffic`。命令均为 needsAuth:true、needsMall:'switch'。

### 3. Contracts

- 全店 days 为 1-30 整数；先 `traffic.readyTime` 再 `traffic.overviewList`，page-api POST `/sydney/api/mallFlow/queryMallFlowOverViewReadyTime`（空请求；三个流量端点均以 `success: true` 且 errorCode ∈ `SUCCESS_BUSINESS_CODES`（0/1000000）为成功）及 `queryMallFlowOverViewList`（beginDate/endDate）。截止日取 readyTime，逐日行及同行均值/优秀值映射由 `views/traffic.js` 拥有；只汇总访客、订单、金额，提示访客跨日重复；窗口内无返回统计日时 summary 各项为 null，返回日数少于窗口天数时追加提示。
- 商品 days 仅 1/7/30 → queryType 0/1/2；窗口与全店相同，截止日取 `traffic.readyTime`（结束日晚于就绪日时平台返回空列表）。`traffic.goodsDetailList` page-api POST `/sydney/api/goodsDataShow/queryGoodsDetailVOList`，参数 startDate/endDate/queryType/sortCol:0/sortType:1/pageNum/pageSize:50/goodsId?，省略 actVs。按 totalNum 翻页，最多 20 页。行白名单在 `views/goods-traffic.js`；数值字段（含 goodsId）中的 PUA 字符触发 E_BUSINESS，商品名、类目等原文字段不做该检测。
- `promo.goodsPromotionList` 复用 fetch 请求体合并策略，保留页面生成签名。POST `/mms-gateway/venus/api/goods/promotion/v3/list`：beginDate/endDate/blockType:3/clientType:1/pageNumber/pageSize:50/filter.searchKeyV2（当前批商品 ID 逗号拼接）/sortBy:9999/orderBy:9999/scenesMode:1 或 3/withTagsInfo:true。每批最多 50 个商品，每场景最多 20 页；只累加当前批的商品，阻止上游忽略过滤条件时重复归属。
- adapter 依次展开 optimizationMessage/reportInfo/reportInfo2；空串视为缺失，金额对象读取 value（无 unit/YUAN 按元，FEN 除 100，PERCENT 除 unitCode 或 100；其他单位输出 null 并追加 promo_unknown_unit 提示，与 promo.js MoneyVO 一致），裸数字厘除 1000，转整数分后累计。adInfos:null 且 totalAdNum:0 为未开通；未知金额传播 null。
- non_promo_* = 商品总量减去推广直接成交；间接成交单列。负差额 null/hint；推广可降级 PddCliError 或分页上限使全部推广和差值 null，promo_complete:false；完整无记录为 0。所有输出保留固定口径及尚未经有投放店铺实测的提示。

### 4. Validation & Error Matrix

days 越界 / 非法 goods-id → E_USAGE / exit 2，请求前验证；主流量/明细失败 → 整体失败；逐日 statDate 缺失或日期无效 → E_NETWORK，避免窗口过滤静默丢行；推广普通 PddCliError → 降级；超时、取消、程序异常 → 传播。商品提前空页且尚未达到总量也标记 goods_truncated。

### 5. Good/Base/Bad Cases

Good：两场景直接成交 1.23 元各一条，合计 2.46 元，再从商品总额减去。Base：未开通推广返回 0。Bad：跨批重复累计同一推广行、失败补零、将访客按推广拆分。

### 6. Tests Required

`traffic-contract.test.js`：请求、PUA、缺集合、金额形态、空串回退、未开通。`traffic-view.test.js`：白名单、百分数、金额、null、同行映射。`traffic.test.js`：窗口、原生 queryType、双场景、跨批归属、分页、失败降级和异常传播。两条 fixture e2e 和 data-contract-v2 的 items[] 字段集覆盖最终 JSON。

### 7. Wrong vs Correct

Wrong：total - (direct + indirect)，推广失败时输出 0。Correct：仅减 direct，失败时输出 null 并标记 promo_complete:false。

## Scenario: Goods Cost and Net Profit

- services/goods-cost-input.js 单独拥有非负元金额、精确规格及字符串 ID 校验；goods-cost.js 编排本地预演/确认，goods-cost-import.js 原生解析 UTF-8 JSON 后整批校验（1 MiB / 5000 条）。未知列、重复商品/规格键、坏行全部拒绝，无先写好行行为。
- goods.profit days 为 1–90，默认 30；按 group_time 成团时间统计上海最近 N 个完整自然日、不含当天，[start,end)；复用 collectOrdersForStaleAnalysis，显式 scope all、size 50、since=start/until=end-1。保留 truncation/rate-limit，按成团时间过滤、订单号内部去重，缺时间或冲突样本标不完整。
- goods-profit-calculation.js 是纯函数：收入=order_amount+platform_discount，不重复加 shipping_amount 或扣 merchant_discount。未付款取消收入及所有成本 0；退款成功（5）收入/货本 0，已发货扣全部按单项，未发货为 0，发货时间缺失/无效时这些费用 null。10/11 正常计算并单列单数及收入；未知售后码/缺字段相关财务 null。
- 成本先精确 spec，后商品默认，无匹配则利润/率 null；货本乘 goods_number，按单项只扣一次，缺数量只影响依赖数量的项。cost_updated_at 是实际使用记录的最大时间，default_fallback_order_count 为非空规格未命中后实际回落单数；成本只有当前值，历史查询会重算。
- goods-profit-promo.js 完整分页 entityReport，保留已删除推广历史，只按 goodsId 归属，无名称回退。商品花费按实体归属合计，全店 promo_spend_yuan 取 totals.spend，shop_promo_spend_yuan 为总计减归属合计；负差额为 null/hint，已知总计和按总计计算的净利润保留。totals 每页不累加；口径固定提示“仅含商品推广报表口径”，关注/询单覆盖留后续研究。
- 推广失败/截断/限流相关花费与净利润 null；完整无该商品记录为 0，金额无效保留 null。窗口订单采集不完整时窗口财务 null，observed_order_count/observed_revenue_yuan 保留样本。summary 严格传播所需未知输入，禁止仅合计有成本商品。
- view 白名单由 views/goods-cost.js / goods-profit.js 导出，中文 availability 表在 labels.js，利润 hints 归 goods-profit view 的报表声明所有。gross_margin_pct/net_margin_pct 为有符号百分数，可超过 ±100 且原样保留，零收入为 null。filter_goods_id 仅筛 items，summary 全店。固定提示当前成本重算与两项高估：仅退款不退货、商家共担补贴。
- 测试：goods-cost*、goods-profit* 服务/视图单测，orders-scope/orders-contract/promo-money 回归，两个 goods 成本/利润 fixture e2e 与五个命令的 data-contract-v2；共享 runner/存储改动执行 npm test。

## Scenario: Goods Estimated Receipt

- `getGoodsReceiptView(ctx, { goodsIds = [], page = 1, size = 10, caliber = 'regular' })` → `goods receipt`。选项已由 commander 校验，service 只把口径名解析为 `RECEIPT_CALIBERS` 场景表（未知口径防御为 E_USAGE）。术语见 GLOSSARY.md「Estimated Merchant Receipt」，PRD 见 `.scratch/goods-receipt/spec.md`。
- 口径只靠请求的 `consult_price_scene_list` 携带，服务端不保存：常规 7/8、所有优惠 10/11；场景 9（未来走势）不用。`RECEIPT_CALIBERS` 是场景值唯一来源，列表与补全请求共用。
- 列表 `goodsPrice.list` 每页最多 10 个商品、每个商品只带回部分 SKU；`remain_sku_num > 0` 的商品按顺序调用 `goodsPrice.expand` 补全（带已拿到的 SKU ID），按 sku_id 去重追加，少于平台报告数时告警 `receipt_sku_incomplete`；补全业务错误整体 E_BUSINESS / exit 6，不输出半截列表。`xhr_count` = 1 + 补全次数。
- 每个 SKU 只采用当前口径的单件 / 多件场景，其他场景忽略并告警 `receipt_scene_ignored`；缺单件场景 `single: null` 并告警 `receipt_single_missing`，缺多件场景 `multi: null`。平台明确无优惠为 0 / `[]`。
- views/goods-receipt.js 拥有白名单与分转元：券前价取活动价（来源为 activity_type_desc）否则拼单价（来源「拼单价」）；多件 `discounts` 为合计。数值全部原样报告，不重算、不推导技术服务费或补贴。

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
// src/services/diagnose/orders-collector.js
collectOrdersForStaleAnalysis(page, ctx, { scope = 'valid', scanDays, maxPages, pageSize })
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
| `goods profit` | `all` | 成团时间完整窗口须包含退款、10/11 和未付款取消；显式覆盖 collector 的 valid 默认 |
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

Applies to `services/console-login*.js`, `daemon/routes.js`, `daemon/sse.js` and interactive auth persistence. Frontend contracts are consumed directly by `console/public/app/app.js`.

### 2. Signatures

```js
startConsoleSession(slug, { mode: 'password' | 'qr', ownerTag, signal }) -> { session_id };
startConsoleAddSession({ login_name, password }, { ownerTag, signal }) -> { session_id }; // mode 'add', no account yet
getConsoleSession(id) -> { state, message, remaining_seconds, expires_at, qr_image };
consoleSessionFrames(id) -> { subscribe(callback), [Symbol.asyncIterator]() };
consoleSessionPointer(id, { gesture_id, seq, events, cancel? }); // { ok: true, editable, numeric, result?: 'interrupted' }
consoleSessionText(id, { text } | { key });
refreshConsoleQr(id); cancelConsoleSession(id); closeAllConsoleSessions();
saveMerchantLogin(result, initial, task); // shared verified-candidate + lease/CAS/manual-success commit
```

### 3. Contracts

- Memory-only session ids are 16 random bytes, base64url. Sessions are keyed by account id, and every add session shares the key `add`. A new session cancels the previous session with the same key and waits for its cleanup; at most two keys have active/reserved sessions. Closing resources still occupy a slot. Terminal status remains available for five minutes, then is dropped.
- Password and QR start at `/api/accounts/:slug/relogin` and `/qr` (POST `{}`); adding a shop starts at `/api/accounts/add` (POST `{ login_name, password }`, same validation as saved passwords, 400 `E_USAGE` otherwise; body fields are deleted after use). Session routes are `/api/sessions/:id`, `/frames` (GET); `/pointer`, `/text`, `/sms`, `/qr/refresh`, `/cancel` (POST). All require a console cookie; all POSTs retain JSON/custom-header checks.
- States are `filling|takeover|sms|qr|verifying|succeeded|failed|timed_out|cancelled`; message is fixed Chinese or null, expires_at is ISO, qr_image is a data URL only in QR state. Message is set only where it adds information: `sms` → `短信验证码已发送到绑定手机`; `takeover`, `qr`, `verifying` (cleared on entry, before verification awaits) and `timed_out` → null; failures and add-session success carry a fixed reason. An identity mismatch fails as `failed` with `登录店铺与所选店铺不一致，未保存` (no error code in the message); the five-field status contract stays unchanged.
- Sessions hold `withMerchantAuthUpdate` for the full operation, with the account identity and a twelve-minute deadline. Explicit starts skip automatic throttle/awaiting-human gates, retain the block gate, and use `deviceState(tx)` via `createSnapshotContext`.
- Password attempts receive seventy seconds; `beginReloginAttempt` owns attempt recording and its `fail(outcome)` records non-success results through `recordReloginOutcome` before throwing. Only challenges wait for a human: `sms` enters state `sms` (no picture; `/sms { code }` fills the login page's SMS dialog via `submitSmsCode` and returns `{ ok, result: submitted|wrong_code|form_changed }`, one submission at a time), other challenges enter `takeover` (captcha dialog relay). `form_changed` / `network_error` end the session as `failed` with a fixed message, without takeover; wrong-password/locked outcomes reuse the breaker and credential-version guard. `takeover` and `sms` expire after ten minutes and increment the timeout counter; QR uses `TIMEOUTS.LOGIN_QR` and recaptures in the same context. Cancellation and QR timeout leave the takeover counter unchanged.
- PASS_ID is an acquisition signal. Close the login page, independently verify expected identity and shop access, then call the attempt handle's `succeed(candidate)`. Live sessions retain `saveMerchantLogin` as the snapshot/account commit callback. Snapshot/account updates, manual reset, pending-action resolution and password-success outcome commit atomically; failure preserves all prior persisted state except the already-recorded attempt time. QR/manual success resets consecutive timeouts; QR keeps an existing block/action. All browser paths close resources and release leases. Daemon stop aborts sessions and rejects new starts; completed sessions drop the attempt handle along with browser/credential references.
- Add sessions hold no account lease and write no relogin state before the shop is known. They log in from a blank browser state with the submitted credential, which lives only in session memory and is cleared when the session ends. `wrong_password` / `account_locked` / `form_changed` / `network_error` end as `failed` with a fixed message and register nothing; challenges use the same `sms` / `takeover` windows (timeouts do not touch any counter). After PASS_ID the login page closes, `verifyConsoleLogin` verifies without an expected mall, `provisionMerchantLogin` registers a new account or updates the existing one for that mall (short lease), and `setAccountPassword` saves the credential. Messages: `店铺已添加，密码已保存` / `店铺已存在，登录信息和密码已更新`.
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

- `test/services/console-login.test.js`: device continuity, seventy-second budget, captcha takeover vs SMS input vs form/network failure, add sessions (blank state, new vs existing shop, SMS, failures without registration, credential validation and body clearing), lease outside transactions, shared verified commit, mismatch/rejected check/CAS preservation, partial resource cleanup, cancellation, real timer boundaries, retention, QR reuse and fixture-only control guards.
- `test/adapter/takeover.test.js`, `test/daemon/sse.test.js`: CDP acks, latest-frame throttling, pointer timing/coordinates/serialization, validation, keys, backpressure, disconnect and decodable fixture images.
- `test/e2e/console-login.e2e.test.js`: fixture random-port/temp-DB challenge through SSE/input to success, action resolution, ordinary marker reuse with no new attempt, two-timeout breaker/unblock, QR, account replacement/global limit, daemon stop and secret-free responses/streams/stdout/logs. Run full `npm test` after targeted tests.

### 7. Wrong vs Correct

```js
// Wrong: link previews consume the one-time token.
GET('/c/:token', redeemConsoleToken);
// Correct: GET serves only a self-hosted script; the protected JSON POST consumes it.
POST('/api/redeem', { token }, { 'X-PDD-Console': '1' });
```
