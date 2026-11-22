# 03: pdd orders detail 售后状态修复、售后单自动联动与全功能收口验收

**What to build:** 修复 `pdd orders detail` 在上游返回中文文本状态时售后状态字段失真的问题，并为涉售后订单自动联动补充关联 **After-Sales Case（售后单）** 列表及 **After-Sales Reason（售后原因）** 概览；同时完成文档、开发规范、ADR 状态流转与经授权的真实账号只读收口验收，确保既有诊断与经营指标口径严格隔离。

**Blocked by:** 01: pdd orders after-sales 核心主干与售后原因分布聚合, 02: pdd orders after-sales 精确起止时间窗与多维筛选

**Status:** ready-for-agent

- [ ] 修复订单详情视图模型的售后状态字段解析：当上游 `orderDetail` 的 `after_sales_status` 为非数字中文文本且 `after_sales_status_code` 为数值状态码时，优先采用数值状态码完成规范化售后状态映射，消除状态值回退缺失问题。
- [ ] 为 `pdd orders detail` 增加条件触发式 **After-Sales Case（售后单）** 联动：仅当 `after_sales_id != null` 或 `after_sales_status_code != null` 时，自动通过 `AFTER_SALES_LIST`（`searchText: sn`）拉取并以 `order_sn === sn` 本地精确过滤该订单关联售后单，写入 `after_sales_cases[]`（按创建时间降序、同秒按 `after_sales_id` 降序），并在 `headline` 摘要中体现售后单与 **After-Sales Reason（售后原因）** 概览。
- [ ] 确保普通无售后订单零额外请求且联动异常平滑降级：当 `after_sales_id == null` 且 `after_sales_status_code == null` 时跳过 `AFTER_SALES_LIST` 请求，直接返回 `after_sales_cases: []` 与 `hints: []`；当联动接口异常时订单详情主命令保持成功输出，将 `after_sales_cases` 置为 `null` 并附加中文 `hints` 说明。
- [ ] 执行既有口径隔离回归验证：核验 `orders stats`、`diagnose after-sales` 及 `goods profit`（ADR 0004）等既有业务口径未受新售后单明细与原因统计影响，保持各自既有字段定义与统计逻辑独立。
- [ ] 补全并更新订单详情视图单元测试、联动成功/零请求跳过/降级三态 E2E 测试，以及包含新增 `after_sales_cases` 字段的 `data-contract-v2` 数据契约测试。
- [ ] 同步更新项目命令文档、对应工作流技能说明、CHANGELOG 变更记录与 `.trellis/` 知识记录，并将 ADR 0006（`docs/adr/0006-after-sales-case-and-reason-reporting.md`）状态更新为 `Accepted`；全量运行 `npm run check`（lint 与全部测试集）确认通过。
- [ ] 在获得用户明确授权范围后，针对默认商家账号执行真实环境只读端到端验收（覆盖 `pdd orders after-sales --days 30 --json`、`--since`/`--until`、`--sn` 及涉售后与正常订单的 `pdd orders detail`），并将脱敏后的验收结果摘要记录至对应工单 `## Comments`，保证零敏感数据落盘。
