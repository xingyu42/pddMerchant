# PRD：售后单与退款原因查询（`pdd orders after-sales` 与 `pdd orders detail` 联动）

Status: ready-for-agent

来源：2026-11-22 设计访谈与只读实测（参见售后单与退款原因调研报告、领域术语表与 ADR 0006）。

## Problem Statement

商家与下游 Agent 目前可以通过 `pdd orders list`、`pdd orders detail`、`pdd orders stats` 与 `pdd diagnose after-sales` 查看订单是否处于退款成功或售后处理中，却无法获知买家**为什么**申请退款或售后。既有的订单列表与订单详情上游接口仅携带售后单标识与状态码，不返回售后原因。

同时，现有订单详情存在一处状态映射缺陷：上游订单详情将中文文案放入 `after_sales_status`，而把数字状态码放在 `after_sales_status_code`，导致 `pdd orders detail` 对存在售后的订单会输出 `未知(<中文状态>)`。此外，商家也缺少按时间窗（含历史切片）、按单号或按商品维度批量汇总 **After-Sales Reason（售后原因）** 分布的结构化 CLI 能力。

由于拼多多售后工作台以 **After-Sales Case（售后单）** 为粒度按申请时间组织（涵盖退款、退货退款、换货、补寄、维修 5 类及全部生命周期状态，且一笔订单可先后产生多条售后单），新能力需要把售后单模型与既有的订单统计、商品净利润口径清晰隔离。

## Solution

在现有 `orders` 命令组下新增 `pdd orders after-sales`，并联动丰富 `pdd orders detail`：

- **纯 JSON `page-api` 接入**：仅通过 `POST /mercury/mms/afterSales/queryList` 与 `POST /mercury/mms/afterSales/queryParams` 获取数据，在保证响应速度与稳定性的同时控制隐私暴露面。
- **自动翻页与原因分布汇总（`pdd orders after-sales`）**：单次命令按每页 100 条自动翻页（上限 2,000 条，超限时显式标记 `truncated: true` 与提示），在单次结果中同步返回按平台原因文案聚合的 `reason_summary[]` 与逐单明细 `items[]`。
- **灵活时间窗与精准筛选**：同时支持滚动 `--days <n>`（`1–365`，默认 `30`）与精确起止 `--since` / `--until`（接受 `Asia/Shanghai` 自然日 `YYYY-MM-DD` 闭区间或 Unix 秒，二者与 `--days` 互斥，可查询任意历史时段并支持调用方按周/按月分段拉取），以及 `--sn`（未传时间参数时默认查全历史，并在本地执行精确单号匹配）、`--goods-id`（与 `--sn` 互斥）、`--status`、`--type`。
- **订单详情联动与缺陷修复（`pdd orders detail`）**：优先读取 `after_sales_status_code` 修复既有状态映射；仅在订单存在售后标识时自动联动 `queryList` 查询并做精确单号过滤，输出按申请时间倒序排列的 `after_sales_cases[]`（无售后时为 `[]` 且零额外请求；联动失败降级时为 `null` 并附带中文 `hints`）。
- **既有口径与隐私边界**：保持 `orders.stats`、`diagnose.after-sales` 与 `goods.profit`（ADR 0004）口径不变，全部输出严格经过白名单投影与隐私字段剔除。

## User Stories

1. 作为商家，我希望直接运行 `pdd orders after-sales` 时默认查看近 30 天内全店全部类型与全部状态的 **After-Sales Case（售后单）** 列表及原因汇总，以便快速掌握近期售后全貌。
2. 作为商家，我希望在每条售后单输出中看到平台原生的 `reason_code` 与 **After-Sales Reason（售后原因）** 文案 `reason_desc`（例如「尺码没选对」「不想要了」「质量问题」），以便直接核对买家申请原因。
3. 作为下游 Agent，我希望每条售后单尽可能附带平台 **After-Sales Reason Category（售后原因大类）** 字段 `reason_category`（如七天无理由退货、质量问题、商品描述不符等），以便在需要时按平台粗粒度分组分析。
4. 作为商家，我希望对于尚未被平台大类字典收录的高频原因码（例如 `405030`「尺码没选对」），输出保留原文 `reason_desc` 并将 `reason_category` 置为 `null`，以便忠实反映平台数据而不引入自造分类。
5. 作为使用者，我希望当枚举字典接口 `queryParams` 拉取失败降级时，`pdd orders after-sales` 依然正常返回售后单明细与原因分布，仅将 `reason_category` 置为 `null` 并附带中文提示，以便单接口抖动不阻断主流程。
6. 作为商家，我希望在 `reason_summary[]` 中按 `reason_desc` 聚合统计（自动合并对应相同中文文案的多个原因码，如 `88`、`66`、`197` 均合并为「不想要了」；若文案缺失则回退 `未知(<reason_code>)`），以便直接看清真实业务原因占比。
7. 作为下游 Agent，我希望 `reason_summary[]` 中的 `reason_category` 仅在该原因文案下全部记录归属同一平台大类时填充该大类，跨大类或未收录时输出 `null`，以便统计口径保持严谨。
8. 作为商家，我希望 `reason_summary[]` 为每种原因提供单数 `count`、占已采集总数的百分比 `share_pct`（保留 2 位小数）与退款金额合计 `refund_amount_yuan`，并按单数降序、同数按退款金额降序排列，以便一眼定位主要退款原因。
9. 作为商家，我希望 `pdd orders after-sales` 在匹配售后单超过一页（100 条）时自动连续翻页拉取（最多 2,000 条），以便无需手动翻页即可拿到窗口全量汇总。
10. 作为下游 Agent，我希望当匹配售后单超过 2,000 条触发截断时，`total` 保留平台总数、`fetched_count` 为 `2000`、`truncated` 为 `true`、`reason_summary[]` 的占比以 `fetched_count` 为分母，且 `headline` 与 `hints` 明确提示已截断并建议用 `--since`/`--until` 缩小区间分段拉取，以便清晰判断样本完整性。
11. 作为商家，我希望通过 `--days <n>` 指定近 `1–365` 天内的任意天数统计售后原因，并在传入越界或非整数值时立即返回用法错误（`E_USAGE`，退出码 2）且不启动浏览器请求，以便参数误用能快速失败。
12. 作为商家，我希望通过 `--since <date>` 与 `--until <date>` 传入 `YYYY-MM-DD` 日期（按 `Asia/Shanghai` 自然日闭区间 `00:00:00` 至 `23:59:59` 解析），以便精准查询上个月或去年某一周的任意历史切片。
13. 作为自动化脚本作者，我希望 `--since` 与 `--until` 也兼容 Unix 秒整数，以便无缝对接既有 `orders list` 脚本的时间计算逻辑。
14. 作为使用者，我希望仅传 `--since` 未传 `--until` 时结束时间默认取当前时刻，以便便捷查询从某天至今的售后单。
15. 作为脚本作者，我希望单传 `--until` 未传 `--since`、`since > until`、日期格式非法，或将 `--days` 与 `--since`/`--until` 同时传入时，命令在解析阶段立即返回 `E_USAGE`（退出码 2）且零网络请求，以便尽早拦截歧义查询。
16. 作为商家，我希望使用 `pdd orders after-sales --sn <order_sn>` 且不传时间参数时默认检索全部历史售后单（`window` 各字段输出 `null`），以便查出更早期订单的退款原因。
17. 作为商家，我希望在传 `--sn <order_sn>` 的同时显式指定 `--days` 或 `--since`/`--until` 时按指定时间窗过滤，以便支持带时间边界的单号排查。
18. 作为下游 Agent，我希望 `--sn <order_sn>` 查询在本地额外执行 `order_sn === sn` 精确过滤，以便防止上游综合检索框返回部分匹配或关联订单造成污染。
19. 作为商家，我希望通过 `pdd orders after-sales --goods-id <id>` 查看指定商品的售后单列表与退款原因分布，并在传入非法商品 ID 时立即返回 `E_USAGE`（退出码 2）。
20. 作为脚本作者，我希望 `--sn` 与 `--goods-id` 同时传入时命令在解析阶段立即返回 `E_USAGE`（退出码 2）且零请求，以便明确上游共用检索框的互斥边界。
21. 作为商家，我希望通过 `--status <all|open|refunded|closed>` 聚焦特定生命周期的售后单（例如传 `refunded` 仅看已退款成功的售后原因、传 `open` 仅看进行中的售后单），并在传入不支持取值时立即返回 `E_USAGE`。
22. 作为商家，我希望通过 `--type <all|refund|return_refund|exchange|resend|repair>` 按售后类型筛选（例如区分仅退款与退货退款的原因差异），并在传入不支持取值时立即返回 `E_USAGE`。
23. 作为财务或运营分析人员，我希望每条售后单输出均包含金额换算后的 `refund_amount_yuan`、`order_amount_yuan` 与 `receive_amount_yuan`、上海本地时间 `created_at` 与 `closed_at`（未关闭记 `null`）、发货状态 `shipping_status`、退货物流单号 `reverse_tracking_number`（空串记 `null`）、`status` 与 `status_detail`，以便一站核对原因、金额与退货物流。
24. 作为下游 Agent，我希望返回体顶层包含 `window: { start_at, end_at, days }` 与 `filters: { sn, goods_id, status, type }` 回显，以便仅凭 JSON 就能确认本次分析覆盖的精确时间窗与过滤条件。
25. 作为商家，我希望 `headline` 用简洁中文总结查询范围、售后单总数、高频原因前几项及是否截断，以便终端直接可读。
26. 作为商家，我希望运行 `pdd orders detail --sn <order_sn>` 查看存在售后的订单时，不再看到错误的 `未知(退款成功)`，且结果自动附带按申请时间倒序排列的 `after_sales_cases[]` 明细，以便一次查清订单全貌与退款原因。
27. 作为商家，我希望当同一笔订单先后发生过多次售后申请（如首次申请关闭后再次申请）时，`orders detail` 的 `after_sales_cases[]` 按申请时间倒序完整列出全部售后单，以便不遗漏历史记录。
28. 作为商家，我希望运行 `pdd orders detail --sn <order_sn>` 查询无售后订单时，`after_sales_cases` 输出空数组 `[]` 且不触发额外的售后接口请求，以便保持普通订单详情的零开销。
29. 作为下游 Agent，我希望当 `orders detail` 联动拉取售后单接口失败时，订单基础详情仍正常返回，同时 `after_sales_cases` 输出 `null` 并在 `hints` 中给出中文失败说明，以便清晰区分「确实无售后」和「售后原因拉取失败」。
30. 作为自动化使用者，我希望 `pdd orders after-sales` 与扩展后的 `pdd orders detail` 完全兼容 `--json` 单行输出、output contract v2 与 `--all-accounts` 批量模式，以便融入现有自动化流程。
31. 作为注重隐私合规的开发者，我希望 `thumbUrl`、`mallRemark`、`uid`、`returnAddressId`、`actions` 等隐私或内部字段严格被白名单过滤，不进入任何 CLI 输出或日志。
32. 作为维护者，我希望既有 `pdd orders stats`、`pdd diagnose after-sales` 与 `pdd goods profit`（ADR 0004）维持既有统计口径与输出，不因新增售后单视图而发生数值漂移。

## Implementation Decisions

### 领域模型与口径边界

- 遵循领域术语表中的 **After-Sales Case（售后单）**、**After-Sales Reason（售后原因）**、**After-Sales Reason Category（售后原因大类）** 与 ADR 0006 约束。
- 细粒度售后单状态标签（涵盖待商家处理、待消费者发货、待商家收货、平台处理中、退款成功、退款关闭、换货/补寄成功、换货/补寄关闭、维修成功、维修关闭、进行中售后单）仅用于新增售后单视图与 `orders detail` 的 `after_sales_cases[]`。
- 既有的 `orders.stats`、`diagnose.after-sales` 与 `goods.profit` 维持基于订单列表 `after_sales_status` 的既有统计口径不变。

### 命令注册与解析期校验（命令注册层与公共参数解析器）

- 在 `orders` 命令组下注册 `after-sales` 子命令（命令标识 `orders.after-sales`），支持选项：
  - `--days <n>`：`1–365` 的整数，表示近 N 天滚动窗；未传 `--since`/`--until` 且未传 `--sn` 时默认为 `30`。
  - `--since <time>` 与 `--until <time>`：精确起止时间，支持 `YYYY-MM-DD` 日历日期（校验真实有效日期，例如拒绝 `2026-02-30`）与非负 Unix 秒整数。
  - `--sn <order_sn>`：按订单号查询（非空字符串）。
  - `--goods-id <id>`：按商品 ID 查询（复用既有正整数商品 ID 校验器）。
  - `--status <scope>`：售后单状态过滤，取值 `all`（默认）|`open`|`refunded`|`closed`。
  - `--type <kind>`：售后类型过滤，取值 `all`（默认）|`refund`|`return_refund`|`exchange`|`resend`|`repair`。
- 全部参数格式、枚举校验与互斥校验均在 Commander 解析阶段及进入浏览器生命周期前完成，任何违规一律以 `E_USAGE`（退出码 `2`）快速失败且零浏览器/网络开销：
  - `--days` 显式传入时与 `--since` / `--until` 互斥；
  - `--sn` 与 `--goods-id` 互斥；
  - 仅传 `--until` 未传 `--since` 时拒绝；仅传 `--since` 未传 `--until` 时结束时间默认取当前时间；
  - 解析后若 `since > until` 时拒绝。
- 日期与时间戳换算规则：
  - `YYYY-MM-DD` 按 `Asia/Shanghai` 自然日闭区间解析：`--since` 取当日 `00:00:00`（Unix 秒），`--until` 取当日 `23:59:59`（Unix 秒）；
  - Unix 秒整数按原值使用（`--since` 为起始秒，`--until` 为截止秒）。
  - 命令行解析层注意避免 Commander 默认值遮蔽用户是否显式传入 `--days`（需能准确区分「未显式传 `--days` 且传了 `--sn`」与「显式传了 `--days`」）。

### 适配层端点规格（售后端点模块）

- 新增两个 `page-api` 端点规格，均设置 `strategy: 'page-api'`、`nav: { url: PDD_HOME }`：
  - `AFTER_SALES_LIST`（`name: 'after_sales.list'`、`fixtureListKey: 'result.list'`、`POST /mercury/mms/afterSales/queryList`）：
    - 请求体构建：固定包含 `pageNumber`（由 `params.page ?? 1` 映射）、`pageSize`（默认 `100`）、`orderByCreatedAtDesc: true`；按条件附加 `startCreatedTime`、`endCreatedTime`（Unix 秒）、`searchText`（承载 `sn` 或 `goodsId`）、`afterSalesStatusList`（状态码数组）以及售后类型参数。
    - 实施阶段在构建最终 `--type` 请求体与夹具前，需先通过一次只读实测确认 `queryList` 服务端对 `afterSalesType` 接受标量还是数组（若某形态未生效可同步调整）。
    - 响应形状守卫：校验 `result` 为纯对象、`result.total` 为有限非负整数、`result.list` 为数组；缺失或形态异常抛出 `E_NETWORK`。
  - `AFTER_SALES_PARAMS`（`name: 'after_sales.params'`、`POST /mercury/mms/afterSales/queryParams`）：
    - 请求体 `{}`。
    - 响应形状守卫：校验 `result` 为纯对象且 `result.reasonCodeParams` 为纯对象（保留兼容可能缺失其它可选分组，提取 `{ reasonCategoryMap }` 供服务层使用）。

### 服务层编排（售后单服务与订单服务）

- **时间窗与过滤解析**：
  - 传 `--since`（及可选 `--until`）时使用精确起止秒，`window.days` 置为 `null`；
  - 传 `--sn` 且未显式传 `--days`/`--since`/`--until` 时不传 `startCreatedTime` / `endCreatedTime`，`window` 输出 `{ start_at: null, end_at: null, days: null }`；
  - 其余情况使用以当前时间结束的近 `days` 天滚动秒窗，`window` 输出 `{ start_at, end_at, days }`（`start_at`、`end_at` 格式化为 `Asia/Shanghai` 日期时间字符串）。
- **翻页采集与截断**：
  - 按 `pageSize = 100`、`maxPages = 20`（上限 `2,000` 条）顺序翻页；
  - 首页记录平台 `total`，每页检查取消信号 `signal`；当本页返回条数 `< pageSize` 或累计采集条数 `>= total` 时提前结束；
  - 当翻满 20 页且仍有剩余或累计采集达到 `2,000` 而未覆盖 `total` 时标记 `truncated: true` 并追加截断提示；
  - 若传入 `--sn`，对采集到的条目在本地再执行 `String(item.orderSn) === String(sn)` 精确过滤。
- **可选字典降级**：
  - 调用 `AFTER_SALES_PARAMS` 构造 `reasonCode -> reasonCategory` 映射；通过共享报表降级策略捕获可降级错误（排除取消与内部异常），失败时回退为空映射并追加中文提示 `params_unavailable`（`reason_category` 输出 `null`），命令整体仍成功返回。
- **订单详情联动（`orders detail`）**：
  - 获取 `ORDER_DETAIL` 后，仅当 `raw.after_sales_id != null` 或 `raw.after_sales_status_code != null` 时判定存在售后并触发联动；无售后订单零额外请求，直接输出 `after_sales_cases: []`。
  - 存在售后时通过可降级采集拉取 `AFTER_SALES_LIST`（`searchText: sn`，本地精确匹配 `order_sn === sn`）及可选 `AFTER_SALES_PARAMS`，将命中的售后单按 `createdAt` 降序（同秒按 `id` 降序）排列输出至 `after_sales_cases`；联动失败降级时 `after_sales_cases` 输出 `null` 并写入中文提示至 `data.hints`。

### 视图层、标签映射与输出契约 v2（订单/售后视图与共享标签模块）

- **标签与状态分组映射**：
  - 在共享标签模块中定义平台售后类型标签表（`1` 退款、`2` 退款退货、`3` 换货、`4` 补寄、`5` 维修，视图优先使用上游原文 `afterSalesTypeName`）、售后状态码→中文状态标签映射（基于 `queryParams.afterSalesStatusParams` 已实测码值覆盖 `1–32` 及各分组），以及CLI `--status` 到状态码数组、`--type` 到类型编码的映射常量。
  - 修复订单详情视图 `toOrderDetailView`：当上游 `after_sales_status` 为非数字文本且存在 `after_sales_status_code` 时，以 `after_sales_status_code` 传入 `AFTER_SALES_STATUS_LABEL` 映射，保持既有订单列表的数字码行为不变。
- **共享售后单视图白名单 `AFTER_SALES_CASE_FIELDS`（18 个字段）**：
  - `after_sales_id`（string）、`order_sn`（string）、`goods_name`（string|null）、`spec`（string|null）、`quantity`（number|null）
  - `type`（string|null）、`status`（string|null）、`status_detail`（string|null）、`shipping_status`（string|null）
  - `reason_code`（number|null）、`reason_desc`（string|null）、`reason_category`（string|null）
  - `refund_amount_yuan`（number|null）、`order_amount_yuan`（number|null）、`receive_amount_yuan`（number|null）
  - `created_at`（string|null）、`closed_at`（string|null，`<= 0` 为 `null`）、`reverse_tracking_number`（string|null，空串为 `null`）
  - 其余上游字段（`thumbUrl`、`mallRemark`、`uid`、`returnAddressId`、`actions`、`expireActionDesc` 等）一律丢弃。
- **原因分布聚合 `reason_summary[]`**：
  - 聚合键取 `item.reason_desc ?? (item.reason_code != null ? \`未知(${item.reason_code})\` : '未知')`。
  - 每项字段集合 `REASON_SUMMARY_FIELDS`：`reason_desc`、`reason_category`（组内全部记录非空且唯一大类时填该大类，否则 `null`）、`count`、`share_pct`（`count / fetched_count` 转百分数并保留 2 位小数，`fetched_count === 0` 时无条目）、`refund_amount_yuan`（组内退款金额分求和后转元）。
  - 排序规则：按 `count` 降序，同数按 `refund_amount_yuan` 降序，再按 `reason_desc` 字典序稳定排序。
- **`orders after-sales` 顶层视图与 `headline`**：
  - 顶层键：`headline`、`window`（`{ start_at, end_at, days }`）、`filters`（`{ sn, goods_id, status, type }`）、`total`、`fetched_count`、`truncated`、`reason_summary`、`items`、`hints`、`mall_id`。
  - `headline`：汇报时间窗/筛选范围、平台匹配售后单数与已采集条数（若无记录直接报无售后单）；存在原因分布时补充前 3 大高频原因及各自单数/占比；若 `truncated === true` 追加「已达单次 2000 条上限，结果已截断（建议配合 --since/--until 分段拉取）」。
- **`orders detail` 顶层视图与 `headline`**：
  - 在既有订单详情字段基础上新增 `after_sales_cases` 与 `hints`（无提示时 `[]`）；当 `after_sales_cases` 非空时在 `headline` 补充最新一条售后单的类型、状态与原因；当降级为 `null` 时补充中文提示说明。

### 文档与契约同步

- 同步更新命令行说明文档（README 命令表）、Agent CLI 技能指南、命令/服务/端点 Trellis 契约文档，并在实现验收完成后将 ADR 0006 的状态更新为 `Accepted`。

## Testing Decisions

- **测试原则**：只测试可观测的外部行为（CLI 退出码、JSON envelope `data` 契约、字段白名单与隐私剔除、计数与占比算术、时间窗解析与校验、解析期零请求拦截、降级与截断语义、端点请求体构造与响应形状守卫），不断言内部实现细节或私有辅助函数。
- **测试接缝（零新增接缝，沿用 3 处既有接缝）**：
  1. **主接缝（最高层）：CLI E2E + Fixture Adapter**（通过隔离 CLI 运行器与合成夹具、`.page<N>.json` 分页夹具及 `__throws` 异常夹具）：
     - `orders after-sales` 全链路：默认 30 天滚动窗与多页自动采集、`reason_summary[]` 聚合（同文案多编码合并、未收录码 `405030` 保留原文并置 `reason_category: null`、跨类置 `null`、`share_pct` 与退款额合计）、`AFTER_SALES_CASE_FIELDS` 18 字段投影与金额/时间/隐私剔除、`--days`/`--since`/`--until`（`YYYY-MM-DD` 上海自然日与 Unix 秒、单传 `--since` 默认至当前时间）、`--sn`（默认全历史与本地精确单号过滤）、`--goods-id`、`--status`、`--type`；
     - 解析期校验：`--days` 与 `--since`/`--until` 冲突、`--sn` 与 `--goods-id` 冲突、单传 `--until`、`since > until`、非法日期/越界天数/非法枚举值均返回退出码 `2`、`E_USAGE` 且 `xhr_count === 0`；
     - 边界与降级：2000 条截断标记及分段提示、`queryParams` 失败降级仍成功并返回 `reason_category: null` + 中文 `hints`、`--json` 单行与 `--all-accounts` 批量兼容；
     - `orders detail` 联动与回归：有售后订单修复 `after_sales_status` 映射并输出倒序 `after_sales_cases[]`（含一单多售后与本地精确过滤）、无售后订单返回 `after_sales_cases: []` 且零额外请求、联动失败降级返回 `after_sales_cases: null` + 中文 `hints`；
     - 既有口径隔离回归：确认 `orders stats`、`diagnose after-sales` 与 `goods profit` 统计口径与输出不受影响。
  2. **既有契约接缝**：
     - `data-contract-v2` 契约套件：新增 `orders.after-sales` 用例（严格校验 `items[]` 与 `AFTER_SALES_CASE_FIELDS`、`reason_summary[]`、`window`、`filters`），并在 `orders.detail` 用例中覆盖 `after_sales_cases[]` 白名单校验；
     - 订单端点契约套件：校验 `AFTER_SALES_LIST` 与 `AFTER_SALES_PARAMS` 的 `strategy`、`nav.url`、`buildPayload` 上游字段名以及 `normalize` 响应形状守卫。
  3. **既有视图单元测试同步**：
     - 在订单视图测试中补充 `toOrderDetailView` 对文本 `after_sales_status` + 数字 `after_sales_status_code` 的映射回归用例。
- **Prior art**：既有评价 E2E 测试、订单与诊断 E2E 测试、合成测试数据工厂、`data-contract-v2` 契约套件、订单端点契约套件及订单视图单测。
- **运行环境**：自动化测试统一在 `PDD_TEST_ADAPTER=fixture` 下运行；实现完成后的真账号只读验收需另行与用户确认。

## Out of Scope

- 访问或解析 `/aftersales-ssr/detail` HTML / `__NEXT_DATA__` 以获取买家自由输入备注（`questionRemarks`）、协商节点时间线（`afterSalesFlows`）、举证图片或 `qualityReasonRefund` / `isNoReason` 标记。
- 在 `diagnose after-sales` 中接入数据中心 `/sydney/api/saleQuality/*`（品质退款率、纠纷退款率、平台介入率及近 30 日高退款商品排行）或接入降商品售后整改工具 `/api/colombo/rectification/listv2`。
- 新增顶层 `pdd after-sales` 命令组或为 `pdd orders list` 添加售后原因字段。
- 为 `pdd orders after-sales` 新增 `--reason` 筛选参数，或在单个 CLI 命令内部实现跨周/跨月自动多段循环拆分合并（由调用方配合 `--since`/`--until` 外部按段执行）。
- 修改 `orders stats`、`diagnose after-sales` 或 `goods profit` 的既有订单/退款口径，或在 CLI 中自造平台字典之外的原因大类映射。

## Further Notes

- 2026-11-22 线上只读实测已确认：`/mercury/mms/afterSales/queryList` 与 `queryParams` 均可从 `PDD_HOME` 经 `page-api` 直接调用，返回明文 JSON（零 PUA 混淆），其中 `pageSize: 100` 实测正常。
- 实测发现 `queryList` 对未识别参数名会**静默忽略并返回全量数据**（例如误传 `beginTime`/`endTime`、`orderSn`/`goodsId`、`statusList` 均会返回全量 1,583 条），端点构造层必须严格使用 `startCreatedTime`/`endCreatedTime`、`searchText`、`afterSalesStatusList`。
- 实测发现 `queryList` 列表条目自身不返回 `goodsId`（可通过 `searchText` 按商品 ID 过滤），同时多原因码可能对应相同文案（如 `88`/`66`/`197` 均对应「不想要了」），且高频原因码 `405030`（「尺码没选对」）未在 `queryParams.reasonCodeParams` 的 7 大类中出现。
- 实施阶段落地 `--type` 过滤与测试夹具前，需补做一次只读单请求核验 `queryList` 对 `afterSalesType` 接受标量还是数组。
