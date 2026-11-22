# 02: pdd orders after-sales 精确起止时间窗与多维筛选

**What to build:** 在 `pdd orders after-sales` 主干之上支持 `--since` / `--until` 精确起止时间窗分段拉取历史 **After-Sales Case（售后单）**，以及按订单号（`--sn`）、商品 ID（`--goods-id`）、售后状态（`--status`）和售后类型（`--type`）的多维筛选与前置参数校验，使排查跨月历史数据或定位特定订单、商品及状态的售后情况时避开单次长窗口截断。

**Blocked by:** 01: pdd orders after-sales 核心主干与售后原因分布聚合

**Status:** ready-for-agent

- [ ] 支持 `--since <date|ts>` 与 `--until <date|ts>` 精确起止时间窗参数：`YYYY-MM-DD` 按 `Asia/Shanghai` 解析为当日 `00:00:00` 与 `23:59:59` 闭区间（校验合法日历日期并拒绝不存在日期），Unix 秒级时间戳直接透传；支持任意跨度历史时间窗（突破 `--days` 的 365 天上限），仅指定 `--since` 时 `--until` 默认截至当前时刻，`window.days` 输出 `null`。
- [ ] 在参数解析阶段完成全部互斥与合法性校验，直接返回 `E_USAGE`（退出码 `2`）且零浏览器请求（`xhr_count === 0`）：校验 `--days` 与 `--since`/`--until` 互斥、`--sn` 与 `--goods-id` 互斥、禁止单独传入 `--until`、拒绝 `since > until`，并拒绝非法 `--goods-id`、`--status`、`--type` 及无效日期输入。
- [ ] 支持 `--sn <order_sn>` 按订单号筛选 **After-Sales Case（售后单）**：未指定时间参数时默认全历史检索（请求跳过起止时间字段，返回 `window: { start_at: null, end_at: null, days: null }`），同时在服务端 `searchText` 模糊查询结果之上增加本地严格 `order_sn === sn` 精确过滤，排除模糊匹配误召回；传入时间参数时按对应时间窗执行精确过滤。
- [ ] 支持 `--goods-id <id>` 通过 `searchText` 按商品 ID 筛选售后单（保持与 `--sn` 互斥，可自由组合时间窗、`--status` 与 `--type`）。
- [ ] 支持 `--status <all|open|refunded|closed>`（基于参数字典及已确认枚举构造 `afterSalesStatusList` 数组：如 `open` 映射进行中状态并集、`refunded` 映射 `[5]`、`closed` 映射 `[6, 12, 17, 24]`），使返回明细与 `reason_summary[]` 聚合统计严格按筛选后结果计算。
- [ ] 支持 `--type <all|refund|return_refund|exchange|resend|repair>` 售后类型筛选；在锁定最终请求负载形状与 fixture 之前，先经用户确认发起 1 次只读线上核验以确认列表接口类型字段采用标量 `afterSalesType` 还是数组形式，随后固化请求参数映射、本地过滤一致性与端点契约。
- [ ] 补齐精确起止时间窗、参数互斥/合法性校验（`E_USAGE` + `xhr_count === 0`）、`--sn` 精确过滤与全历史模式、`--goods-id`、`--status`、`--type` 组合筛选的 E2E 测试及端点契约测试，并确认 `npm run check` 全量通过。
