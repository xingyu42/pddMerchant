# 02: pdd orders after-sales 精确起止时间窗与多维筛选

**What to build:** 在 `pdd orders after-sales` 主干之上支持 `--since` / `--until` 精确起止时间窗分段拉取历史 **After-Sales Case（售后单）**，以及按订单号（`--sn`）、商品 ID（`--goods-id`）、售后状态（`--status`）和售后类型（`--type`）的多维筛选与前置参数校验，使排查跨月历史数据或定位特定订单、商品及状态的售后情况时避开单次长窗口截断。

**Blocked by:** 01: pdd orders after-sales 核心主干与售后原因分布聚合

**Status:** resolved

- [x] 支持 `--since <date|ts>` 与 `--until <date|ts>` 精确起止时间窗参数：`YYYY-MM-DD` 按 `Asia/Shanghai` 解析为当日 `00:00:00` 与 `23:59:59` 闭区间（校验合法日历日期并拒绝不存在日期），Unix 秒级时间戳直接透传；支持任意跨度历史时间窗（突破 `--days` 的 365 天上限），仅指定 `--since` 时 `--until` 默认截至当前时刻，`window.days` 输出 `null`。
- [x] 在参数解析阶段完成全部互斥与合法性校验，直接返回 `E_USAGE`（退出码 `2`）且零浏览器请求（`xhr_count === 0`）：校验 `--days` 与 `--since`/`--until` 互斥、`--sn` 与 `--goods-id` 互斥、禁止单独传入 `--until`、拒绝 `since > until`，并拒绝非法 `--goods-id`、`--status`、`--type` 及无效日期输入。
- [x] 支持 `--sn <order_sn>` 按订单号筛选 **After-Sales Case（售后单）**：未指定时间参数时默认全历史检索（请求跳过起止时间字段，返回 `window: { start_at: null, end_at: null, days: null }`），同时在服务端 `searchText` 模糊查询结果之上增加本地严格 `order_sn === sn` 精确过滤，排除模糊匹配误召回；传入时间参数时按对应时间窗执行精确过滤。
- [x] 支持 `--goods-id <id>` 通过 `searchText` 按商品 ID 筛选售后单（保持与 `--sn` 互斥，可自由组合时间窗、`--status` 与 `--type`）。
- [x] 支持 `--status <scope>`（`all|open|refunded|closed`，基于参数字典及已确认枚举构造 `afterSalesStatusList` 数组：如 `open` 映射进行中状态并集、`refunded` 映射 `[5]`、`closed` 映射 `[6, 12, 17, 24]`），使返回明细与 `reason_summary[]` 聚合统计严格按筛选后结果计算。
- [x] 支持 `--type <kind>`（`all|refund|return_refund|exchange|resend|repair`）售后类型筛选；经用户授权发起只读线上核验确认列表接口接受标量 `afterSalesType`，随后固化请求参数映射、本地过滤一致性与端点契约。
- [x] 补齐精确起止时间窗、参数互斥/合法性校验（`E_USAGE` + `xhr_count === 0`）、`--sn` 精确过滤与全历史模式、`--goods-id`、`--status`、`--type` 组合筛选的 E2E 测试及端点契约测试，并确认 `npm run check` 全量通过。

## Comments

- 2026-11-22 经用户授权对默认账号 `/mercury/mms/afterSales/queryList` 执行只读实测（`ok: true`, `warnings: []`）：未传类型 `total: 1584`；标量 `afterSalesType: 2` 返回 HTTP 200、`total: 678`（全为 `退货退款`）；标量 `afterSalesType: 1` 返回 HTTP 200、`total: 895`（全为 `退款`/`未发货退款`）；数组 `afterSalesType: [2]` 返回 HTTP 400 `errorCode: 3000000`（`参数校验失败`）；`afterSalesTypeList: [2]` 被静默忽略（`total: 1584`）。据此锁定 `--type` 传标量整数 `afterSalesType`（`all` 省略该字段）。
- 2026-11-22：完成 TDD 实现与测试覆盖（commit `fb896cf`，merge `8415c55`）。双轴代码评审后于 `a64fbc4`（merge `cae689d`）完成收口修复：去重 `isCalendarDate` 至 `src/infra/units.js` 并补齐 `units.test.js` 与 `envelope-errors-output.md` 契约同步、移除多余的 `--status` 本地二次过滤、并保持平台首页 `total` 原值（`fetched_count` 与 `reason_summary[]` 基于复核后明细计算）。`PDD_TEST_ADAPTER=fixture npm run check` 全量通过。
