# Implement — 订单列表状态覆盖与退款口径修复

按顺序执行；每步完成后跑对应单测。

## 1. Adapter：scope 表
- [ ] `src/adapter/endpoints/orders.js`：新增 `ORDER_LIST_SCOPES` / `ORDER_LIST_DEFAULT_SCOPE` / `ORDER_LIST_CLI_SCOPES`（不含 `valid`）；`buildPayload` 按 `params.scope` 取值，未知 scope 抛 `E_USAGE`；移除 `params.orderType`。
- [ ] `test/adapter/orders-contract.test.js`：默认 payload `orderType 0 / afterSaleType 0`；逐项断言 6 个 scope；未知 scope 抛 `E_USAGE`；删除 `orderType: 7` 透传断言。

## 2. Views / labels
- [ ] `src/services/views/labels.js`：`ORDER_SCOPE_LABEL`、`AFTER_SALES_STATUS_LABEL`（注释引用 research 出处）。
- [ ] `src/services/views/order.js`：`after_sales_status` 用标签表；`toLocalOrderStatsView` 处理 `refund_rate == null`、新增 `after_sales_count`。
- [ ] `test/services/order-view.test.js`：5 / 10 / 11 / 99 / null 标签断言。

## 3. 退款口径
- [ ] `src/services/orders.js`：`computeOrderStats` 按 design D4 重写退款部分（拆 `countAfterSales`）；`localStatsSentence` 处理 null；`listHeadline` 加 scope 标签；`getOrderListView` / `getOrderStatsView` 传 scope；再导出 CLI scope 列表供命令层使用。
- [ ] `test/services/orders-statistics.test.js`：真实形态样本、字段缺失样本、空样本；删除依赖 `refund_status` 等虚构字段的旧用例。

## 4. Diagnose
- [ ] `src/services/diagnose/funnel-health.js`：null 传播。
- [ ] `src/services/diagnose/orders-health.js`：确认 null 不写 `refund_rate_pct`。
- [ ] `src/services/views/diagnose.js`：null 文案「退款数据不可用」。
- [ ] `src/services/diagnose/orders-collector.js`：`options.scope` 默认 `'valid'`。
- [ ] `src/services/diagnose/reports.js`（funnel → `'all'`）、`collectors.js`（`collectOrdersInput` → `'all'`）。
- [ ] 测试：funnel 字段缺失 → `fulfillment_rate_pct === null`；collector 断言传给 `listOrders` 的 scope（默认 valid、funnel all）。

## 5. 命令层
- [ ] `src/commands/registry/orders.js`：`--status <scope>`，默认 `all`。
- [ ] `src/commands/orders/list.js`：校验 scope → `E_USAGE`；透传。
- [ ] e2e（fixture）：`orders list --status pending_ship` 成功且 headline 含「待发货」；`--status bogus` exit 2。
- [ ] `test/fixtures/test-data.js` / `test/fixtures/endpoints/orders.list*.json`：如有需要补 `after_sales_status: 5` 样本，确保默认路径能覆盖退款计数。

## 6. 文档
- [ ] `skills/pdd-cli/SKILL.md`：`orders list --status`，默认全部；退款字段可能为 null 的说明。
- [ ] `CLAUDE.md` Gotchas：`orderType`/`afterSaleType` 语义、`pageSize` 上限 50。
- [ ] `.trellis/tasks/10-07-domain-view-contract-v2/research/upstream-schema-2026-10.md` §6：两条范围外条目标注「已由 10-08-orders-status-and-refund 处理」。

## 验证
```bash
npx vitest run test/adapter/orders-contract.test.js test/services/orders-statistics.test.js test/services/order-view.test.js
npx vitest run test/contract/data-contract-v2.test.js
npm test
```
- 真实账号只读验收（主会话执行）：`pdd orders list --json` 与 `pdd orders list --status pending_ship --json`，核对待发货计数 = `pdd orders stats` 的 `pending_ship_count`。

## Review gate
- `trellis-check` 全量检查（函数 < 50 行、嵌套 ≤ 3、依赖方向、v2 契约）。

## 回滚点
- 全部改动在单提交内；失败时 `git revert`。
