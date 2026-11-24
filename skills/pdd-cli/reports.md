# 经营报表口径

转述 `diagnose *`、`orders after-sales`、`orders detail`、`goods stock`、`goods traffic`、`goods profit`、`goods receipt`、`goods reviews` 结果前读本文件。通用规则见 SKILL.md「转述结果」：`headline` 优先、`null` 表示未知、`hints` 原样转述。标注 **必附** 的说明在转述时原样带上。

## diagnose shop / orders / inventory / promo

- `diagnose shop`：
  - 汇总订单 / 库存 / 推广 / 售后四个维度。
  - `--compare` 输出环比，窗口为 `{ start_date, end_date, days }`；`_pct` 指标的 `delta` 是百分点，`delta_pct` 是相对变化率。
  - 当前库存和待发货是快照，带 `note: "仅有当前快照，无上期数据"`，无历史对比。
- `diagnose orders` 含两个口径相互独立的区块：
  - `detail`（主区块）：待发货 / 延迟发货计数，以及近 7 天下单列表样本的 P95 发货时长、退款率。
  - `regions`：口径「数据中心-地域分布（成团订单）」，默认近 7 天（`window_days: 7`，`queryType: 1`）。
    - 按成团金额降序列出各省成团额（`_yuan`）、成团单数、成团买家数、客单价（`_yuan`）与笔单价（`_yuan`）。
    - 无成团的省份不出现在 `items[]` 中；无成团省份时 `items: []`、`province_count: 0`、`window: null`，并保留 `window_days: 7`。
    - 命中 `delayData` 时标注 `delayed: true` 并附提示。
    - 降级：地域分布失败或返回字体混淆时仅 `regions: null` 并附 hint，主区块与退出码不变。
  - `diagnose shop` 的 `orders` 维度不含 `regions`。
- 统计范围：销量统计（`diagnose inventory`、`goods segment`）计入待发货、已发货、已收货订单；售后统计（`diagnose orders/shop/after-sales`）使用全部订单。

## diagnose after-sales

- 维度键 `after_sales`；`detail` 含 `total_orders`、`refund_count`、`refund_rate_pct`、`after_sales_count`、`after_sales_rate_pct`、`status_distribution`、`window_days`。
- `after_sales_count` 只计售后处理中订单；两类占比的分母都是采集到的全部订单，空样本为 `null`。
- 店铺汇总取近 7 天首批 50 条订单；单独查询默认近 30 天分页采集，截断和限流写入提示。

## orders after-sales

- 窗口：
  - 默认按售后申请时间查询近 30 天，覆盖全部类型和状态。`--days` 接受 1–365。
  - 精确窗口使用 `--since` / `--until`，接受北京时间 `YYYY-MM-DD`（当日首秒 / 末秒）或 Unix 秒；省略 `--until` 时截至当前秒。`window` 回显北京时间。
  - 仅指定 `--sn`、未指定时间时查全历史，`window` 各字段均为 `null`。
- 筛选：
  - `--sn` 精确匹配订单号；同一订单可对应多条售后单。
  - `--goods-id` 与 `--sn` 互斥，两者都可与 `--status` 和 `--type` 组合；`filters` 回显筛选值，状态与类型使用中文。
  - 状态筛选由平台处理；订单号和售后类型由本地复核。
- 原因：`items[]` 包含平台售后原因码与文案；平台字典未收录该码或字典拉取失败时，`reason_category` 为 `null`；字典拉取失败会附 `hints`。
- 计数与汇总：
  - `total` 始终是平台首页总数；`fetched_count` 是最终输出的明细条数。
  - `reason_summary[]` 按原因文案合并，退款金额先按分加总，`share_pct` 以 `fetched_count` 为分母。
  - 组内所有售后单须归入同一个已知大类才显示该类。
- 上限：每次最多采集 2000 条，截断时附提示。
- 妥投耗时增强（`--with-delivery`）：仅对 `shipping_status` 为「已发货」的售后单按唯一订单号去重，按 `--max-track-fetches`（1–500，默认 50）单次实时拉取正向轨迹（不持久化本地缓存）；`shipping_status` 缺失或未知时 `delivery_source` 为 `null`。送达时刻按「驿站/快递柜入柜优先、否则签收/代收/出柜」口径取 `delivered_at`，计算 `delivery_to_apply_days`（发起早于送达为 `null`），并在 `delivery` 中分别记录实时查询单数（`fetched_orders_count`）、已妥投单数（`delivered_orders_count`）、超出配额跳过单数（`skipped_cap_orders_count`）与流控中止跳过单数（`skipped_throttled_orders_count`）及 `avg_days`、`p50_days`、`p90_days`、`min_days`、`max_days`；触达上限、部分失败或流控时原样附 `hints`（流控中止后的未查订单标为「流控中止未查」）。

## orders detail

- 关联查询：订单有售后标识时自动查询该单全历史售后单，输出 `after_sales_cases[]`，摘要补充最新一条的类型、状态和原因。
- 状态层级：`order.after_sales_status` 为订单级状态；`after_sales_cases[]` 逐条报告售后单级状态和平台原因。
- 排序：同一订单可关联多条售后单，按申请时间倒序，同秒时按售后单 ID 数值倒序。
- 取值与降级：
  - `[]`：无售后标识或无精确匹配。
  - `null`：关联列表拉取失败降级；订单详情照常返回并附 `hints`。
  - 关联检索达到 2000 条上限且结果被截断时，`hints` 提醒结果可能不完整。
  - 原因字典失败时保留售后单和原因文案，仅置 `reason_category` 为 `null` 并附提示。
- 物流轨迹增强（`--with-track`）：在订单详情与关联售后单之外附加 `track` 区块，拉取正向快递轨迹（`track.forward`）及关联售后单逆向退货轨迹（`track.returns[]`）。
  - 送达时刻统一采用「快递送达即算」口径（`delivery_caliber: "快递送达即算（入柜/驿站优先，否则签收/代收/出柜）"`）：存在 `IN_CABINET`（入柜/到达驿站）取最早 `IN_CABINET`，否则取最早 `SIGN` / `SIGN_ON_BEHALF` / `OUT_CABINET`；中转仓入库/合包/出库及二段揽收会重置第一段交接节点，同时暴露参考时间 `in_cabinet_at` 与 `signed_at`。
  - 计算各阶段天数差：`transit_days`（正向揽收到送达）、`delivery_to_apply_days`（收货到发起售后）、`apply_to_return_arrived_days`（发起售后到退货到达/签收）、`delivery_to_return_arrived_days`（正向送达到退货到达/签收）、`reverse_transit_days`（逆向揽收到退货到达/签收）。
  - 轨迹节点 `traces[]` 使用 `{ occurred_at, status, summary }`，严格使用闭合中文状态/摘要白名单（未知状态统一归为「其他节点」/「物流节点更新」），不透出原始站点、人员、地址、取件码或热线文本。正向/逆向缺失轨迹（含仅有公司/运单但无承运商节点的逆向轨迹）、仅有发货通知无承运商轨迹、缺逆向物流公司 ID 或轨迹失败时通过 `hints` 如实提示，第 4 行耗时摘要严格对齐最新一条售后单（`returns[0]`）并按逆向到达类型区分「退回到达」与「退回签收」。

## diagnose experience

- `--days` 1–30，默认 7。返回 `snapshot`（星级、较前一天变化、下一星级及排名门槛、行业排名、平台评级、统计日期）、`indicators[]`（指标值、单位、下一星级门槛、平台达标状态）、`consumer_experience_plan`、`trend`。
- 平台星级、评级文案和达标判定按原意转述。
- 趋势截止到平台就绪日期，只保留有数据的日期。比率为百分数，时长为小时或天；用户评价得分排名保留平台原单位。
- 快照失败时命令失败；趋势不可用时 `trend:null`、`status:"数据不完整"` 并附 `hints`。

## diagnose customer-service

- 窗口与口径：`--days` 1–63，默认 30；窗口为上海日期今天减 days 至昨天。主口径固定「多多客服-客服数据（人工回复）」，与体验星级口径相互独立。
- `summary` / `trend`（客服数据）：
  - `summary` 覆盖整个区间；`trend.items[]` 来自页面加载的最近 31 天中落在窗口内的日期，带类目响应时长参考。
  - 比率后缀 `_pct`，响应时长后缀 `_seconds`；无咨询日为 `null`。
  - 汇总失败时命令失败；趋势失败时 `trend:null` 并附 hint。
- `sales`：口径「多多客服-销售数据」，带自己的 `window`。
  - 窗口：平台只提供 3 天之前的销售数据（询单后 3 日内的下单都计入询单当日），所以结束日为今天往前第 3 天；天数沿用 `--days`，平台可查范围是 62 天，`--days 63` 时 `sales.window.days` 为 62。
  - `sales.summary`：询单人数、成团人数、询单转化率（`_pct`）、客服销售额（`_yuan`），取平台的区间汇总。
  - `sales.trend.items[]`：窗口内最近 31 天的逐日值，另带同类目前 10% 与整体的询单转化率均值。
  - 空值按平台原值：询单 0 人时转化率为 `null`，成团 0 人时客服销售额为 `null`，尚未出数的日期整行为 `null`。
  - 客服销售额与 `goods profit` 的订单收入口径各自独立。
  - 降级：销售汇总失败时 `sales:null` 并附 hint；只有逐日失败时 `sales.trend:null` 并附 hint；原有 `summary`、`trend` 照常返回。
- `today`：今日实时区块，独立于逐日趋势与 `sales`；`caliber` 固定为「多多客服-实时数据（3 分钟人工回复率）」。
  - 字段：`snapshot_at`（CLI 抓取时间）、`as_of_hour`、实时咨询 / 需人工回复 / 人工接待人数、3 分钟人工回复率及阈值、`unreply_user_count`（当前待回复人数）。
  - `hourly[]`：按小时 `"00".."23"` 升序，含 `reply_3min_user_count`、`unreply_3min_user_count`；只保留截至 `snapshot_at` 所在上海小时（`hour <= snapshotHour`）的已发生或当前时段，截除尚未到达的未来小时条目。
  - 凌晨无咨询时回复率、咨询人数与接待人数可能为 `null`。
  - 降级：今日实时拉取失败时 `today: null` 并附 hint，历史数据照常返回。

## diagnose reviews

- `--days` 取 30 / 60 / 90 / 180，默认 30。
- `keyword_tags`：平台满意/不满意标签及计数。
- `issue_types[]`：五类问题正负面计数和平台占比。
- `negative_reviews`：`{ items, total, truncated }`，为描述评分 1–3 星的中差评。
  - 最多采集平台可查看的近 2000 条，超出时 `truncated:true`。
  - 条目含商品 ID、评价时间、三项评分、正文、追评、标签、已回复状态和图片数；平台给出历史评分时三项评分为 `null`。正文中的手机号已掩码为 `138****5678`。
  - 逐条好评或单个商品的评价用 `goods reviews`。
- `goods_scores`：口径固定「数据中心-评价数据」，窗口固定近 30 日（`window_days: 30`），在任何 `--days` 下均输出，与 `negative_reviews.total` 各自陈述。
  - `items[]` 含 `goods_id`、`goods_name`、`review_count`（近 30 日有效评价数）以及 `desc_score_avg` / `logistics_score_avg` / `service_score_avg`（保留 2 位小数）；评价数为 0 的商品三项平均分为 `null`。
  - 分页：每页 10 条、最多 20 页（200 个商品），`total` 取首页总数，超出时 `truncated:true` 并附提示。
  - headline 新增「近 30 日有效评价商品 N 个」（统计 `review_count > 0` 的商品数）。
- 降级：
  - 原有三个数据源（标签聚合、问题类型、中差评列表）分别降级为 `null` 并提示，全部失败时命令失败。
  - `goods_scores` 独立走可选降级：拉取失败时 `goods_scores: null` 并附提示，不新增商品评分 headline 行，命令仍成功且退出码不变。

## diagnose traffic

- `--days` 1–30，默认 30，截止日为平台就绪日期。
- 逐日访客、浏览、成交指标及平台同行均值、优秀值。
- `summary.shop_visitor_count` 是逐日访客数之和，跨日有重复访客，转述时说明。
- 返回日期少于窗口天数时，`summary` 只汇总已返回日期，并附提示。
- `today`：全店今日截至当前的实时区块，独立于逐日 `items` / `summary`。
  - `snapshot_at` 是 CLI 抓取时间，平台不返回快照时间。
  - 访客与浏览量来自流量看板实时值。
  - 成交字段取按小时累计的最新一行，`as_of_hour` 是该行小时（通常落后当前约 1 小时），`hourly[]` 为逐小时累计值；当天还没有成交累计行时，成交字段为 `null`、`hourly: []`。
  - 两组数据刷新时点不同，转述时分开说明，各自保持原值、不互相换算。
  - 降级：今日数据拉取失败时 `today: null` 并附提示，逐日数据照常返回。

## goods stock

- 只扫描一页商品（`--size` 默认 50）。`items` 为总库存不高于 `threshold` 的商品，加上总库存高于阈值或缺失、但至少一个在售规格库存不高于阈值的商品。
- `low_stock_count` 只计总库存不高于阈值的商品，可能少于 `items` 条数；仅因规格进入告警的商品由 headline 第三行单独计数，两行合计等于 `items` 条数。
- `skus[]` 为该商品全部规格：
  - `low_stock` 只在规格在售（`on_sale: true`）且库存为已知数并不高于阈值时为 true；在售标记未知或库存缺失不触发。
  - `low_stock_sku_count` 是该商品 `low_stock` 规格数。
  - 规格数据缺失时 `skus` 与 `low_stock_sku_count` 均为 `null`（区别于零个规格 `[]` / `0`）。
- 「缺货」在商品级和规格级都指库存 `<= 0`。

## goods traffic

- 窗口：`--days` 取 1 / 7 / 30，默认 30，截至平台就绪日期，平台原生区间口径；`--goods-id` 按字符串传递。
- 商品明细最多 20 页，截断时 `data_quality.goods_truncated:true`；明文接口失败或返回字体混淆数据时命令报错。
- 推广拆分：
  - 按商品汇总稳定成本推广和全店托管计划，分别给出直接、间接成交、花费和点击。
  - `non_promo_order_count` / `non_promo_amount_yuan` = 商品总成交 − 推广直接成交，是 CLI 推算值，平台不提供该拆分；负差额为 `null` 并附提示。
  - 推广拉取失败或达到分页上限：推广字段和差值均为 `null`，`data_quality.promo_complete:false`。完整查询中无投放记录的商品推广字段为 0。
  - 推广金额单位无法识别时，对应金额为 `null` 并附提示。
  - **必附**：推广拆分口径来自第三方插件静态分析，尚未经有投放店铺实测；转述拆分结果时附上这句。
- `today`：今日实时区块，独立于历史区间 `items`，含 `snapshot_at`（CLI 抓取时间）。
  - 未传 `--goods-id`：全店商品今日实时概况（`goods_visitor_count`、`goods_page_view_count`、`visited_goods_count`、`pay_order_count`、`pay_amount_yuan`、`pay_conversion_pct`）。上游正常无数据时可为显式 `null`；遇到无法解析的非 `null` 格式串或值时输出 `null` 并写入 `meta.warnings`。
  - 传入 `--goods-id`：该单商品今日实时汇总（来自 `todayGoodsDetail`）与按小时升序的 `hourly[]` / `as_of_hour`（来自 `todayGoodsDetailList`，暂无小时累计行时 `as_of_hour: null`）。两组上游数据源刷新时点独立，headline 分别陈述。
  - 降级：今日实时拉取或字体混淆校验失败时 `today: null` 并附 hint，历史明细照常返回，退出码保持 0。

## goods profit

- 窗口：`--days` 1–90，默认 30。按成交时间（平台数据中心「成交」口径，等于支付时间）统计上海最近 N 个完整自然日，不含当天，`window.end_at` 为排他上界；未付款取消的订单没有成交时间，不计入任何窗口。`--goods-id` 只筛 `items`，`summary` 始终为全店。
- 收入与订单状态：
  - 收入 = 实付 + 平台优惠。
  - 退款成功按全额退款且货已退回处理：货本与收入为 0；已发货仍扣包材、快递、技术服务费，未发货这些费用为 0；发货时间缺失时这些费用为 `null`。
  - 未付款取消的收入与成本为 0。
  - 售后处理中（5 以外的非空售后码，如 10/11，以及未登记的 6/31）正常计入，并单列 `after_sales_order_count` / `after_sales_revenue_yuan`。
- 运费险 `insurance_yuan`：
  - 来源：消费者体验提升计划收费记录里平台逐单报告的服务费，按订单号对齐，CLI 不按费率重算；`goods cost` 没有运费险字段。
  - 「收费成功」的服务费在订单退款后仍计入（平台规则：服务费收取后不退还）。
  - 「待收费」在订单退款或未付款取消时为 0，其余计入。
  - 收费记录中找不到的订单为 0（平台未收取，例如开通计划之前的订单）。
  - 运费补偿由平台支付给买家，不是商家成本，不计入利润。
  - 降级：收费记录拉取失败或不完整时，`insurance_yuan`、`merchant_cost_yuan`、`gross_profit_yuan`、`net_profit_yuan` 为 `null` 并附 hint，`summary.data_quality.insurance_complete:false`（达到分页上限时 `insurance_truncated:true`），退出码不变。服务费金额单位不是元时该单运费险为 `null` 并写入 `meta.warnings`。
- 利润与利润率：`gross_profit_yuan` 扣商家成本，`net_profit_yuan` 再扣推广。`gross_margin_pct` / `net_margin_pct` 是有符号百分数，可负、可超过 ±100；零收入时为 `null`。
- 推广花费仅含商品推广报表口径：
  - 商品按 goodsId 归属；`summary.promo_spend_yuan` 取全店总计。
  - `shop_promo_spend_yuan` 是未归属到商品的差额，只计入 summary，负差额为 `null` 并附 hint。
- 缺失与降级：
  - 缺成本或推广失败时利润为 `null`；完整拉取但无该商品推广记录时花费为 0。
  - 订单截断或限流时窗口财务为 `null`，保留 `observed_order_count` / `observed_revenue_yuan`，读取 `summary.data_quality` 与 `hints`。
- 成本：`cost_updated_at` 是实际使用成本的最大更新时间；`default_fallback_order_count` 是规格未命中、回落默认成本的单数。成本只保留当前值，更新后历史窗口按新成本重算。
- **必附**：转述利润时附以下四条说明：
  1. 推广仅含商品推广报表口径。
  2. 运费险取平台逐单收费记录。
  3. 仅退款不退货时利润可能高估。
  4. 商家共担平台补贴时收入与利润可能高估。

## goods receipt

- 定义：预估实收 = 券前价 − 商家出资优惠，是「商品价格管理」页的平台估算值，按 SKU 给出，CLI 不重算；不含技术服务费、平台补贴，也不是订单收入，和 `goods profit` 的收入口径不同。
- 券前价：有活动价时取活动价，`pre_coupon_price_source` 为活动类型（如「限量折扣」），否则为「拼单价」；`group_price_yuan` 始终是拼单价。
- 单件与多件：
  - `single` 是买 1 件的预估实收。
  - `multi` 是多件时平均单件预估实收的最低值，`quantity` 为出现最低值的件数，`multi.discounts[].discount_yuan` 是多件合计优惠；件数为 1 表示多件不比单件更低。
- **必附口径**：`caliber` 为「商家出资常规优惠」（默认）或「商家出资所有优惠」（另含非公开优惠、多单立减、商家出资平台券）。转述时必须带上口径，两种口径的数字各自陈述，不放在一起比较。
- 空值：平台明确无优惠时优惠为 0、`discounts` 为空；`multi: null` 表示平台没给多件场景；`single: null` 同时有 `receipt_single_missing` 警告。
- `meta.warnings`：`receipt_scene_ignored`（平台返回了其他口径的场景，已忽略）、`receipt_sku_incomplete`（补全后 SKU 数少于平台报告数，`sku_count` 可能偏少）。
- 分页：每页最多 10 个商品，CLI 不自动翻页；按 `total` 和 `--page` 读取其余页。查不到的商品 ID 返回空列表、`total` 为 0，不报错。

## goods reviews

- 窗口与筛选：`--days` 1–365，默认 30，窗口为截至当前时刻的最近 N×24 小时。`--goods-id` 为单个商品 ID，缺省为全店；`--stars` 为 1–5 逗号分隔的描述评分星级，缺省为全部星级。
- 内容过滤支持三种确定性模式。`--all` 与 `--min-length <n>` 互斥；同时传入或 `--min-length` 非正整数时，在参数解析阶段直接返回 `E_USAGE` 错误。
  - 默认模式（`filter: { mode: "实质内容", min_length: 1 }`）：只保留 **Substantive Review（实质内容评价）**，满足任一条件即保留：
    - 主评或追评在剔除 **Platform Placeholder Review（平台占位评价）**、空白、标点/符号/Emoji、纯数字及长度 `>= 2` 的单字重复后，仍有至少 1 个有效字母或汉字；
    - 属于 1–3 星 **Negative Review（中差评，含历史评分与无文字静默中差评）**。
    - 结果：无买家自填正文的 4–5 星纯图/纯视频/纯标签条目会被剔除。该过滤仅基于固定确定性规则，口径独立于拼多多数据中心官方「有效评价」。
  - `--all`（`filter: { mode: "全部", min_length: null }`）：跳过内容过滤，返回本次采集到的全部评价。
  - `--min-length <n>`（`n >= 1` 整数，`filter: { mode: "最小字数", min_length: n }`）：严格要求清洗后的主评或追评有效字数达到 `n` 字及以上才保留，不触发无文字中差评兜底。
- 输出 `{ headline, items, total, fetched_count, filtered_out_count, truncated, filter, window_days, goods_id, stars, hints, mall_id }`：
  - `goods_id` 为 `null` 表示全店，`stars` 为 `null` 表示全部星级。
  - `total` 始终为过滤前的平台报告总数；`fetched_count` 为本次翻页实际采集条数；`filtered_out_count` 为被过滤规则剔除的条数（`--all` 时为 `0`），恒满足 `fetched_count === items.length + filtered_out_count`。
- 截断：最多采集平台可查看的近 2000 条；`truncated: true` 时已达 2000 条采集上限，`headline` 同步报出平台总数、保留条数与 `已采集 <fetched_count> 条，结果已截断`。转述时区分平台 2000 条截断与本地内容过滤剔除。
- 条目字段与 `diagnose reviews` 的 `negative_reviews.items` 相同：商品 ID、评价时间、三项评分、正文、追评、标签、已回复状态和图片数（不含内部 `status` 字段）；正文与追评中的手机号已掩码。
- 列表拉取失败时命令失败。
