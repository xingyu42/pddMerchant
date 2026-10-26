# 订单列表状态覆盖与退款口径修复

## Goal

让 `orders list` 及所有基于订单列表的统计看到真实的订单全集：待发货订单可见、可按状态筛选；退款统计基于真实存在的上游字段，字段缺失时输出 `null` 而不是伪造的 0。

## Background

- 真实采样证据：`research/order-list-filters-2026-10-08.md`。
- `ORDER_LIST` 默认 `orderType: 2`（已发货待收货）+ `afterSaleType: 1`（仅无售后），列表只返回「已发货待收货且无售后」订单。样本中 8 笔待发货订单、7 笔已收货、9 笔退款成功、2 笔已取消全部不可见。
- `computeOrderStats` 的退款判定依赖 `refund_status` / `refundStatus` / `after_sale_type` / `afterSaleType`，真实数据中四者均不存在；而且请求层 `afterSaleType: 1` 已把售后订单排除，即便字段正确也恒为 0。
- 同一列表驱动 `diagnose orders/shop/funnel`、`diagnose inventory`、`goods segment` 的 30 天销量统计，均受影响。

## Requirements

### R1 订单列表默认覆盖全部状态
- `orders list` 默认返回全部订单（含待发货、已发货、已收货、售后中、退款成功、已取消），即上游 `orderType: 0` + `afterSaleType: 0`。
- headline 的状态分布如实体现各状态计数（含「待发货」）。

### R2 状态筛选
- `orders list --status <scope>`，取值：`all`（默认）/ `pending_ship` / `shipped` / `received` / `after_sales`。
- 映射只使用已采样验证的上游组合（见 design）；非法取值 → `E_USAGE`（exit 2）。
- headline 标明所选范围的中文标签（如「近 7 天待发货 8 单」）。

### R3 售后状态标签
- `after_sales_status`：`5` → `退款成功`，`10` / `11` → `售后处理中`，其他非空码 → `未知(<code>)`，`null` → `null`。标签表放在 `services/views/labels.js`。

### R4 退款口径
- 退款判定只基于 `after_sales_status`：`5` 计为退款成功；其他非空码计为售后处理中。
- 样本非空且没有任何订单带有 `after_sales_status` 键（字段缺失）时：`refund_count`、`refund_rate_pct`、售后处理中计数、funnel `fulfillment_rate_pct` 均输出 `null`；headline 写明「退款数据不可用」，不得写「退款 0 单」。
- 空样本：计数为 0，比率为 `null`（沿用现有规则）。
- 本地统计（`orders stats` / `diagnose orders|shop|funnel`）的请求范围必须包含售后订单（`all`）。

### R5 销量统计范围
- `diagnose inventory` / `goods segment` 的 30 天销量统计使用「全部发货状态、仅无售后」范围（`orderType: 0` + `afterSaleType: 1`），即计入待发货 / 已发货 / 已收货，不计退款、售后中、已取消。
- `diagnose funnel` 走同一采集器，但必须使用 `all` 范围（需要看到退款）。

## Acceptance Criteria

- [ ] `ORDER_LIST.buildPayload({})` 产出 `orderType: 0, afterSaleType: 0`；各 `scope` 映射有单测覆盖。
- [ ] `orders list --status pending_ship` 在 fixture 模式下返回 v2 合法 envelope，headline 含「待发货」；`--status bogus` 退出码 2。
- [ ] `computeOrderStats`：真实形态样本（after_sales_status 为 null/5/10/11）计数正确；字段缺失样本 `refund_count === null`；空样本 `refund_count === 0` 且比率 `null`。
- [ ] `diagnose funnel` 在退款字段缺失时 `fulfillment_rate_pct === null`，headline 不出现「退款 0 单」。
- [ ] `collectOrdersForStaleAnalysis` 默认使用 `valid` 范围，funnel 调用显式传 `all`；有单测断言传给 `listOrders` 的参数。
- [ ] `test/contract/data-contract-v2.test.js` 通过；`npm test` 全绿。
- [ ] `skills/pdd-cli/SKILL.md`、`CLAUDE.md`（Gotchas）、上一任务 research §6 的范围外条目同步更新。
- [ ] 真实账号只读验收：`orders list` 默认能看到待发货订单，计数与 `orders stats` 的待发货数一致。

## Out of Scope

- `orders list --size` 上限校验（上游拒绝 100，`50` 可用）——另行处理。
- 新接售后列表接口；`after_sales_status` 10 与 11 的子类区分。
- `orderType` 4 / 5 的语义。
- 退款率分母是否剔除「已取消（未支付）」订单——本任务分母沿用全部样本，见 design 的已知局限。
