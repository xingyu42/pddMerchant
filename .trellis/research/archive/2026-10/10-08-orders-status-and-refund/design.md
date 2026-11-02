# Design — 订单列表状态覆盖与退款口径修复

## D1 范围（scope）由 adapter 定义，上层只传语义名

`src/adapter/endpoints/orders.js` 新增冻结表，作为 `orderType` / `afterSaleType` 的唯一来源（只收录已采样验证的组合）：

```js
export const ORDER_LIST_SCOPES = Object.freeze({
  all:          { orderType: 0, afterSaleType: 0 }, // 全部（含售后/退款/取消）
  valid:        { orderType: 0, afterSaleType: 1 }, // 全部发货状态，仅无售后（销量口径，内部用）
  pending_ship: { orderType: 1, afterSaleType: 1 }, // 待发货（= statisticWithType.unship）
  shipped:      { orderType: 2, afterSaleType: 1 }, // 已发货待收货（= unreceive）
  received:     { orderType: 3, afterSaleType: 1 }, // 已收货
  after_sales:  { orderType: 0, afterSaleType: 2 }, // 售后处理中
});
export const ORDER_LIST_DEFAULT_SCOPE = 'all';
```

- `buildPayload(params)`：`const { orderType, afterSaleType } = ORDER_LIST_SCOPES[params.scope ?? ORDER_LIST_DEFAULT_SCOPE]`；未知 scope 抛 `E_USAGE`（防御，正常由命令层先校验）。移除 `params.orderType` 透传（无调用方使用）。
- 发货 Tab 组合均用 `afterSaleType: 1`：采样只验证了这些组合与 `statisticWithType` 计数一致；`pending_ship` 排除售后中订单也符合「要发哪些货」的语义（有售后申请的单不应直接发货）。完整视图由默认 `all` 提供。

## D2 命令层

- `src/commands/registry/orders.js`：`orders list` 增加 `.option('--status <scope>', '订单范围：all|pending_ship|shipped|received|after_sales', 'all')`。
- `src/commands/orders/list.js`：校验 `status ∈ ORDER_LIST_CLI_SCOPES`（不含内部 `valid`），否则 `PddCliError E_USAGE`；把 `scope` 传给 `getOrderListView`。CLI 可选值列表从 adapter 导出，避免重复。
- 依赖方向：commands → services → adapter；命令层从 services 再导出 scope 常量（不直接 import adapter）。

## D3 视图与标签

- `labels.js` 新增：
  - `ORDER_SCOPE_LABEL = { all: '全部', pending_ship: '待发货', shipped: '已发货待收货', received: '已收货', after_sales: '售后处理中' }`
  - `AFTER_SALES_STATUS_LABEL = { 5: '退款成功', 10: '售后处理中', 11: '售后处理中' }`
- `views/order.js`：`after_sales_status: labelOf(AFTER_SALES_STATUS_LABEL, raw?.after_sales_status)`，更新注释的证据出处。
- `services/orders.js` `listHeadline`：`${window}${scopeLabel}订单共 N 单…`；`all` 时状态分布保持现有格式。

## D4 退款口径（`computeOrderStats`）

```js
const AFTER_SALES_REFUNDED = 5;
// 字段存在性：至少一条订单带有 after_sales_status 键（值可为 null）
const hasAfterSalesField = list.some((o) => o && Object.hasOwn(o, 'after_sales_status'));
```

- 遍历中：`code = o.after_sales_status`；`code === 5` → refunded；`code != null && code !== 5` → afterSalesOpen。
- 返回新增 / 变更字段：
  - `refund_count`: `total === 0 ? 0 : hasAfterSalesField ? refunded : null`
  - `after_sales_count`: 同上规则（售后处理中）
  - `refund_rate`: `total > 0 && hasAfterSalesField ? refunded / total : null`
- 删除对 `refund_status` / `refundStatus` / `after_sale_type` / `afterSaleType` 的读取（无证据）。
- 拆出 `countAfterSales(list)` 小函数，保证 `computeOrderStats` < 50 行。

### 下游
- `views/order.js` `toLocalOrderStatsView`：`refund_rate_pct: stats.refund_rate == null ? null : toPct(stats.refund_rate)`；新增 `after_sales_count`。
- `services/orders.js` `localStatsSentence`：`refund_count == null` → 「退款数据不可用」；否则「退款成功 X 单，售后处理中 Y 单」。
- `diagnose/funnel-health.js`：`refundCount = orderStats.refund_count`（不再 `?? 0`）；`refund_count == null` → `refund_count/refund_rate_pct/fulfillment_rate_pct` 全为 `null`。
- `diagnose/orders-health.js`：`refund_rate` 为 `null` 时不写 `refund_rate_pct`（现有 `typeof === 'number'` 判断已满足，确认即可）。
- `views/diagnose.js`：funnel / orders 文案对 `null` 输出「退款数据不可用」。

## D5 采集器范围

- `diagnose/orders-collector.js` `collectOrdersForStaleAnalysis`：新增 `options.scope`，默认 `'valid'`，透传给 `listOrders`。
- `diagnose/reports.js` `getFunnelDiagnosis`：传 `scope: 'all'`。
- `diagnose/collectors.js` `collectOrdersInput`：显式 `scope: 'all'`。
- `services/orders.js` `getOrderStatsView`：本地样本显式 `scope: 'all'`。
- `goods-segmentation.js` / `collectGoodsInput`：沿用默认 `valid`（销量口径）。

## 兼容性

- 输出契约：`data` 键只增不删（新增 `after_sales_count`）；`refund_count` / `refund_rate_pct` 可能由 0 变 `null`——符合 v2「缺失为 null」规则。
- 行为变化：`orders list` 默认结果集变大（含待发货/已收货/售后/取消）；30 天销量增加（计入待发货与已收货）。需在 SKILL.md 说明。
- Fixture：`mockRunEndpoint` 不看 scope，fixture 列表不变；scope 映射由 adapter 单测覆盖。

## 已知局限

- 退款率分母为全部样本（含「已取消」未支付订单），会轻微稀释比率；需要更多样本确认 `pay_status` / `order_status` 语义后再调整。
- 列表时间窗基于 `groupStartTime`（默认 7 天），超过窗口的老待发货订单不会出现在 `--status pending_ship` 中；`orders stats` 的待发货总数不受窗口限制，可用于交叉核对。

## 回滚

单任务单提交；回滚 = revert 该提交。无数据迁移、无持久化格式变更。
