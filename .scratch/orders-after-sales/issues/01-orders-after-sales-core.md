# 01: pdd orders after-sales 核心主干与售后原因分布聚合

**What to build:** 打通 `pdd orders after-sales` 命令从入口解析到 **After-Sales Case（售后单）** 列表分页拉取、可选参数字典映射、**After-Sales Reason（售后原因）** 分布聚合与标准化信封输出的核心主干。面向用户交付最近 30 天（默认）及 `--days <1–365>` 滚动时间窗内的售后单明细与按售后原因聚合的退款分布汇总。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 新增 `pdd orders after-sales` 子命令并支持 `--days <n>`（整数 `1`–`365`，默认 `30`），未传入 `--days` 时默认拉取最近 30 天滚动窗口内的 **After-Sales Case（售后单）**；解析阶段对越界、小数、非数字或负数 `--days` 立即抛出 `E_USAGE`（退出码 `2`），且零浏览器请求（`xhr_count === 0`）。
- [x] 通过商家后台首页（`PDD_HOME`）上下文直连分页拉取售后单列表（`AFTER_SALES_LIST`，`pageSize: 100`，`orderByCreatedAtDesc: true`，请求负载严格使用已验证字段名 `pageNumber`、`pageSize`、`orderByCreatedAtDesc`、`startCreatedTime`、`endCreatedTime`），透传外部中止信号并支持翻页；单次查询达到 `20` 页 / `2,000` 条上限时停止继续拉取，标记 `truncated: true`，并在 `headline` 与 `hints` 中给出清晰中文截断提示及使用 `--since`/`--until` 分段拉取的操作指引。
- [x] 将每条售后单收敛为统一的 18 字段视图模型（`AFTER_SALES_CASE_FIELDS`：`after_sales_id`、`order_sn`、`goods_name`、`spec`、`quantity`、`type`、`status`、`status_detail`、`shipping_status`、`reason_code`、`reason_desc`、`reason_category`、`refund_amount_yuan`、`order_amount_yuan`、`receive_amount_yuan`、`created_at`、`closed_at`、`reverse_tracking_number`）；金额由整数分换算为元，时间格式化为 `Asia/Shanghai` 时区字符串，`closeTime <= 0` 时 `closed_at` 置为 `null`，空 `reverseTrackingNumber` 置为 `null`，保留细分中文状态标签 `status_detail`，并严格剔除 `thumbUrl`、`mallRemark`、`uid`、`returnAddressId`、`actions` 等冗余或敏感字段。
- [x] 通过售后参数字典接口（`AFTER_SALES_PARAMS`）补全 **After-Sales Reason Category（售后原因大类）**（`reason_category`），对未归入官方粗分组的 **After-Sales Reason（售后原因）**（如原因码 `405030`）原样保留 `reason_desc` 并将 `reason_category` 置为 `null`；当 `AFTER_SALES_PARAMS` 失败或超时时平滑降级完成主查询，将 `reason_category` 置为 `null` 并附加中文降级提示（`params_unavailable`）。
- [x] 按 **After-Sales Reason（售后原因）**（`reason_desc`，缺失时回退 `未知(<reason_code>)`）聚合生成 `reason_summary[]`，每项包含 `reason_desc`、`reason_category`（组内所有非空大类唯一一致时回填，否则置 `null`）、`count`、`share_pct`（基于 `fetched_count` 计算）及 `refund_amount_yuan`，按 `count` 降序再按 `refund_amount_yuan` 降序排列；`data` 顶层返回 `window`、`summary`、`reason_summary`、`cases`、`truncated`、`fetched_count`、`total` 与 `hints`（注：按 `spec.md` 与输出契约 v2，顶层键对齐为 `headline`、`window`、`filters`、`total`、`fetched_count`、`truncated`、`reason_summary`、`items`、`hints`、`mall_id`）。
- [x] 完整支持 `--json` 单行 JSON 信封输出、人类可读文本摘要/表格输出及 `--all-accounts` 多账号调度。
- [x] 补齐 `orders after-sales` 核心主干的 fixture E2E 测试（覆盖多页翻页、2,000 条截断、参数字典降级与未分组原因码边界）、端点契约测试及 `data-contract-v2` 数据契约兼容验证，并确认 `npm run check` 全量通过。

## Comments

- 2026-11-22：完成 TDD 实现与测试覆盖（commit `71677b2`，merge `21af329`），顶层字段与枚举标签按 `spec.md` L132 与输出契约 v2 对齐为 `{ headline, window, filters, total, fetched_count, truncated, reason_summary, items, hints, mall_id }`。经 Standards 与 Spec 双轴代码评审后于 `a64fbc4`（merge `cae689d`）完成收口修复：将单视图枚举表迁出共享 `labels.js` 归还 `views/after-sales.js`、解除 `views/after-sales.js` 对 `adapter/` 常量引用、修复第 20 页短页误判 `truncated: true`、并在命令注册器复用 `AFTER_SALES_REPORT` 解析配置。`PDD_TEST_ADAPTER=fixture npm run check` 全量通过。
