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
labels.js         全部枚举 → 中文标签对照表（唯一来源）
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
- `src/services/views/labels.js` is the single place for enum → Chinese tables; unknown codes render `未知(<code>)` via `labelOf`。Order status uses upstream `order_status_str` (no self-built status table)。
- Order quantity upstream field is `goods_number`; inventory/segment `readQuantity` reads `quantity ?? goods_number ?? goods_quantity ?? goodsQuantity`。
- Reused calculations such as ROI、segmentation、inventory matching MUST have one owner module and tests。
- Goods list identity MUST map `goods_id ?? goodsId ?? id ?? null` at both endpoint and service boundaries, preserving numeric/string IDs. A remaining null identity indicates upstream shape drift or a mapping regression, not normal behavior. Inventory matching MUST retain the `goods_name` fallback and may report internal `matched_by: 'mixed'` when identity is unavailable (output label `按商品名匹配（一侧缺少商品 ID）`)。
- Inventory `detail.data_quality` and segmentation `summary.data_quality` MUST distinguish `goods_complete`, `orders_complete` and each scan's truncated/rate-limited flags. Forward `goodsTotal`, `goodsScanTruncated`, and `goodsScanRateLimited` along with order flags.
- Incomplete segmentation uses internal `data_completeness` codes `partial_goods`, `partial_orders`, or `partial_goods_orders` (output as Chinese labels, see table below). Incomplete orders make `units_sold` (window given by top-level `window_days`; formerly `units_sold_30d`) and `stock_days` null; `observed_units_sold` preserves observed sales, not an estimate of the missing portion.
- Queries MUST NOT generate operating advice, grades, scores, ranks, or good/bad promo classifications. The action-plan service is removed.
- Diagnosis uses `summarizeOrders`, `summarizeInventory`, `summarizePromo`, and `summarizeFunnel`; internal `full` / `partial` describes data availability only (output `数据完整` / `数据不完整`). Missing inputs remain visible as partial dimensions.
- Diagnose `detail` keys (v2, set directly by `summarize*`):
  - orders: `shipping_p95_hours`（1 位小数）, `refund_rate_pct`（有列表样本时恒输出；无订单样本或样本缺 `after_sales_status` 字段时 null）, `pending_ship_count`, `delayed_ship_count`（formerly `refund_rate` / `unship` / `delay`）。
  - inventory: `data_quality`, `total`, `out_of_stock_count`, `low_stock_count`, `low_stock_threshold`, `out_of_stock_rate_pct`, `low_or_out_rate_pct`, `reported_total`, `matched_by`(label), `stale_count`, `stale_sample[{ goods_id, goods_name, quantity }]`, `ambiguous_groups[{ normalized_name, sku_count, sample_quantities }]`（formerly `out_of_stock` / `low_stock` / `*_rate` / `total_reported`; `stale_sample[].units_sold_30d` removed）。
  - promo: `impression`, `click`, `gmv_yuan`, `spend_yuan`, `ctr_pct`（曝光为 0 时 null）, `roi`。
  - funnel: `total_orders`, `refund_count`, `refund_rate_pct`, `fulfillment_rate_pct`, `status_distribution`（以中文状态为键）, `window_days`。`refund_count` 为 null（售后字段缺失）时三者均为 null，并追加 hint；headline 写「退款数据不可用」，不得写「退款 0 单」。
- Order list scope and refund semantics: see **Scenario: Order list scope & refund identification** below。
- Inventory `stale_count` retains its legacy field name but means observed zero-sales goods, not an operating judgment. Missing order enrichment makes it null.
- Promo ROI is a numerical ratio (null when spend is zero); no break-even threshold or classification is returned. `promo.roi` data: `{ headline, by(label), items, total, summary{ spend_yuan, gmv_yuan, roi, excluded_inactive_count, excluded_inactive_spend_yuan }, totals{ impression, click, ctr_pct, spend_yuan, gmv_yuan, net_gmv_yuan, cost_per_order_yuan, goods_fav_spend_yuan, mall_fav_spend_yuan, inquiry_spend_yuan } | null, mall_id }`; CTR is recomputed as click / impression (upstream ctr has unknown units and is not used)。
- Promo money parsing (`src/adapter/endpoints/promo.js` `parseMoney` / `moneyToNumber`): MoneyVO `unit: YUAN` as-is, `FEN` ÷ 100, other non-empty unit → `null` plus a `unitWarnings` entry that services forward to `meta.warnings`; bare numbers / strings are yuan; missing or invalid → `null` (never 0). `totals.cost` is not emitted (same source as `spend`)。 Aggregations (`analyzePromoRoi` row / summary sums, `summarizePromo` gmv) propagate `null`: one unknown amount makes the sum and its ROI `null` instead of counting it as 0。
- Comparisons return numerical metric deltas, not score changes or improvement/regression labels. Inventory and orders `pending_ship_count` / `delayed_ship_count` are current snapshots and MUST NOT receive historical deltas (`note: 仅有当前快照，无上期数据`). For `_pct` metrics `delta` is in percentage points and `delta_pct` is the relative change in %; for other metrics `delta` is in the metric's own unit. Compare windows are `{ start_date, end_date, days }` (Asia/Shanghai)。
- Internal code → output label (translated only in the view layer; tables in `src/services/views/labels.js`):

| Output field | Internal code → label |
| --- | --- |
| diagnose / shop / compare `status` | `full` 数据完整, `partial` 数据不完整 |
| diagnose issues/hints `dimension` | `orders` 订单, `inventory` 库存, `promo` 推广, `funnel` 履约 |
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
| `getFunnelDiagnosis` | `all` | same |
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
- `test/services/diagnose-facts.test.js`: funnel/orders null propagation, no 「退款 0 单」.
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
