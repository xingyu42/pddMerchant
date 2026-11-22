# 03: pdd orders detail 售后状态修复、售后单自动联动与全功能收口验收

**What to build:** 修复 `pdd orders detail` 在上游返回中文文本状态时售后状态字段失真的问题，并为涉售后订单自动联动补充关联 **After-Sales Case（售后单）** 列表及 **After-Sales Reason（售后原因）** 概览；同时完成文档、开发规范、ADR 状态流转与经授权的真实账号只读收口验收，确保既有诊断与经营指标口径严格隔离。

**Blocked by:** 01: pdd orders after-sales 核心主干与售后原因分布聚合, 02: pdd orders after-sales 精确起止时间窗与多维筛选

**Status:** resolved

- [x] 修复订单详情视图模型的售后状态字段解析：当上游 `orderDetail` 的 `after_sales_status` 为非数字中文文本且 `after_sales_status_code` 为数值状态码时，优先采用数值状态码完成规范化售后状态映射，消除状态值回退缺失问题；无售后订单返回 `"无售后"` 且状态码为 `null` 时映射为 `null`。
- [x] 为 `pdd orders detail` 增加条件触发式 **After-Sales Case（售后单）** 联动：仅当 `after_sales_id != null` 或 `after_sales_status_code != null` 时，自动通过 `AFTER_SALES_LIST`（`searchText: sn`）拉取并以 `order_sn === sn` 本地精确过滤该订单关联售后单，写入 `after_sales_cases[]`（按创建时间降序、同秒按 `after_sales_id` 降序），并在 `headline` 摘要中体现售后单与 **After-Sales Reason（售后原因）** 概览。
- [x] 确保普通无售后订单零额外请求且联动异常平滑降级：当 `after_sales_id == null` 且 `after_sales_status_code == null` 时跳过 `AFTER_SALES_LIST` 请求，直接返回 `after_sales_cases: []` 与 `hints: []`；当联动接口异常时订单详情主命令保持成功输出，将 `after_sales_cases` 置为 `null` 并附加中文 `hints` 说明。
- [x] 执行既有口径隔离回归验证：核验 `orders stats`、`diagnose after-sales` 及 `goods profit`（ADR 0004）等既有业务口径未受新售后单明细与原因统计影响，保持各自既有字段定义与统计逻辑独立。
- [x] 补全并更新订单详情视图单元测试、联动成功/零请求跳过/降级三态 E2E 测试，以及包含新增 `after_sales_cases` 字段的 `data-contract-v2` 数据契约测试。
- [x] 同步更新项目命令文档、对应工作流技能说明、CHANGELOG 变更记录与 `.trellis/` 知识记录，并将 ADR 0006（`docs/adr/0006-after-sales-case-and-reason-reporting.md`）状态更新为 `Accepted`；全量运行 `npm run check`（lint 与全部测试集）确认通过。
- [x] 在获得用户明确授权范围后，针对默认商家账号执行真实环境只读端到端验收（覆盖 `pdd orders after-sales --days 30 --json`、`--since`/`--until`、`--type`、`--sn` 及涉售后与正常订单的 `pdd orders detail`），并将脱敏后的验收结果摘要记录至对应工单 `## Comments`，保证零敏感数据落盘。

## Comments

- 2026-11-22：完成 TDD 实现与测试/文档同步（commit `335ac15`，merge `7eea0b7`）。双轴代码评审后于 `a64fbc4`（merge `cae689d`）完成收口修复：移除 `services/orders.js` 中的 `getSharedClient` 包装并在 `services/after-sales.js` 内直接统计 `requestCount`（含失败调用）回传 `meta.xhr_count`；`getOrderAfterSalesCases` 检索触及 2,000 条截断时补充中文 `hints`；恢复 `README.md` 精简边界；`orderDetail` 在真账号复验发现正常订单返回 `after_sales_status: "无售后"`、`after_sales_status_code: null` 后，于 `e85abff` 修正 `toOrderDetailView` 在 `after_sales_status` 无有效数字时统一映射 `after_sales_status_code`（输出 `null`），并同步更新测试、调研文档、服务契约与 ADR 0006。
- 2026-11-22 真实账号只读端到端验收（经用户授权默认商家账号，全部输出经严格脱敏校验，未记录 `order_sn`、`after_sales_id`、`goods_id`、`goods_name`、`mall_id`、`reverse_tracking_number` 与任何 PII）：
  - `orders after-sales --days 30 --json`：退出码 `0`、`ok: true`、`warnings: []`、`total: 159`、`fetched_count: 159`、`truncated: false`、汇总 `6` 类平台原因（其中未分组码「尺码没选对」`31` 条 / `19.5%`、`reason_category: null`），`items[]` 严格符合 18 字段 `AFTER_SALES_CASE_FIELDS`、`reason_summary[]` 严格符合 5 字段 `REASON_SUMMARY_FIELDS`。
  - `orders after-sales --since 2026-10-01 --until 2026-10-31 --json`：退出码 `0`、`ok: true`、`warnings: []`、`window: { start_at: "2026-10-01 00:00:00", end_at: "2026-10-31 23:59:59", days: null }`、`total: 58`、`fetched_count: 58`、原因汇总 `8` 项，`items[]` 严格符合 18 字段白名单。
  - `orders after-sales --type return_refund --days 30 --json`：退出码 `0`、`ok: true`、`warnings: []`、`filters.type: "退款退货"`、`total: 113`、`fetched_count: 113`，全部返回条目 `type` 均为 `"退货退款"`。
  - `orders after-sales --sn <redacted> --json`：退出码 `0`、`ok: true`、`warnings: []`、`window: { start_at: null, end_at: null, days: null }`、`total: 1`、`fetched_count: 1`，精确匹配率 100%。
  - `orders detail --sn <after-sales-order-redacted> --json`：退出码 `0`、`ok: true`、`warnings: []`、`meta.xhr_count: 3`、`order.after_sales_status: "退款成功"`、`after_sales_cases.length: 1`（`status: "退款成功"`、`reason_desc: "尺码没选对"`、严格 18 字段）、`hints: []`、`headline` 共 `4` 行。
  - `orders detail --sn <normal-order-redacted> --json`（修复 `e85abff` 后复验）：退出码 `0`、`ok: true`、`warnings: []`、`meta.xhr_count: 1`、`order.after_sales_status: null`、`after_sales_cases: []`、`hints: []`、`headline` 共 `3` 行。
  - `orders after-sales --days 7 --since 2026-10-01 --json`：退出码 `2`、`ok: false`、`command: "orders.after-sales"`、`error.code: "E_USAGE"`、`meta.xhr_count: 0`。
