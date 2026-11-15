# 05: `goods profit` 统计窗口改按成交时间（修复真实账号上采集 0 单）

**What to build:** `goods profit` 改用订单列表自带的成交时间 `confirm_time` 划定统计窗口，替换当前的成团时间 `group_time`。修复后在真实账号上能采集到订单并算出利润。

**Blocked by:** None (can start immediately)

**Status:** resolved

问题（2026-11-15 真实账号只读确认）：
- `orders.list`（`recentOrderList`）的订单对象**没有 `group_time`**（近 7 天 266 单全部缺失），只有 `orderDetail` 有。`filterOrders` 把缺 `group_time` 的订单判为无效，结果 0 单、`orders_complete: false`、利润全部为 `null`。合成 fixture 带了 `group_time`，测试没有暴露
- 列表有 `confirm_time`（秒）。按状态各抽一单与详情对比：`confirm_time` 等于支付时间（`pay_time`，差 ≤ 1 秒）；`group_time` 比它晚 0–30 分钟；未付款取消的订单 `confirm_time` 为 0

决定（用户确认）：统计窗口按**成交时间** `confirm_time`，与平台数据中心「成交」口径一致；不为取成团时间逐单调用订单详情。

规则：
- 窗口仍为上海最近 N 个完整自然日、不含当天，`[start, end)`
- `confirm_time` 为正整数秒：按它落入窗口筛选
- `confirm_time` 为 0 且订单为未付款取消：不属于任何成交窗口，静默排除，不标记采集不完整
- `confirm_time` 缺失、非数字，或为 0 但不是未付款取消：视为字段不可用，标记采集不完整（沿用现有 hint）
- 订单扫描的 `since` 仍按下单时间覆盖窗口（成交晚于下单），不改采集方式
- 重复订单事实冲突的检测保留，事实字段中的 `group_time` 换成 `confirm_time`

- [x] ADR 0004、GLOSSARY（Goods Net Profit 若提到成团时间）、`domain-service-contracts.md`、`skills/pdd-cli/reports.md` 中「按成团时间」改为「按成交时间」
- [x] fixture 订单（`createProfitOrders` 等）改为真实形态：去掉 `group_time`，带 `confirm_time`；保留一个带 `group_time` 但缺 `confirm_time` 的用例，断言为采集不完整
- [x] 窗口边界：`confirm_time` 恰为 `start` 计入、恰为 `end` 不计入
- [x] 未付款取消（`confirm_time` 0）的订单被排除且 `orders_complete` 仍为 true
- [x] 已付款订单缺 `confirm_time` 时 `orders_complete: false` 并出现 hint
- [x] CHANGELOG 记录口径变更；`npm test` 通过

## Comments

- 2026-11-15：在 03 合入后的真实账号冒烟中发现；`main`（a57e035）上同样复现，是 `goods profit` 上线以来的既有问题。
- 2026-11-15：已合入 feat/auto-insurance-fee（ee3230c）。真实账号近 7 天采集 263 单（修复前 0 单）；未付款取消的 3 单均带 pay_status 0。冒烟中另发现未登记售后码 6、31 使收入为 null，按用户决定改为售后处理中（32c4520）。
