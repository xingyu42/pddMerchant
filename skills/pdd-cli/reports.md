# 经营报表口径

转述 `diagnose *`、`goods traffic`、`goods profit`、`goods receipt` 结果前读本文件。通用规则见 SKILL.md「转述结果」：`headline` 优先、`null` 表示未知、`hints` 原样转述。

## diagnose shop / orders / inventory / promo

- `diagnose shop` 汇总订单 / 库存 / 推广 / 售后四个维度；`--compare` 输出环比，窗口为 `{ start_date, end_date, days }`。`_pct` 指标的 `delta` 是百分点，`delta_pct` 是相对变化率；当前库存和待发货是快照，带 `note: "仅有当前快照，无上期数据"`，无历史对比。
- 销量统计（`diagnose inventory`、`goods segment`）计入待发货、已发货、已收货订单；售后统计（`diagnose orders/shop/after-sales`）使用全部订单。

## diagnose after-sales

- 维度键 `after_sales`；`detail` 含 `total_orders`、`refund_count`、`refund_rate_pct`、`after_sales_count`、`after_sales_rate_pct`、`status_distribution`、`window_days`。
- `after_sales_count` 只计售后处理中订单；两类占比的分母都是采集到的全部订单，空样本为 `null`。
- 店铺汇总取近 7 天首批 50 条订单；单独查询默认近 30 天分页采集，截断和限流写入提示。

## diagnose experience

- `--days` 1–30，默认 7。返回 `snapshot`（星级、较前一天变化、下一星级及排名门槛、行业排名、平台评级、统计日期）、`indicators[]`（指标值、单位、下一星级门槛、平台达标状态）、`consumer_experience_plan`、`trend`。
- 平台星级、评级文案和达标判定按原意转述。
- 趋势截止到平台就绪日期，只保留有数据的日期。比率为百分数，时长为小时或天；用户评价得分排名保留平台原单位。
- 快照失败时命令失败；趋势不可用时 `trend:null`、`status:"数据不完整"` 并附 `hints`。

## diagnose experience-plan

- `--days` 取 1 / 7 / 30 / 90，默认 7，窗口为上海自然日、含今天（`window.start_at` 至 `window.end_at`）；`--page` 默认 1，收费记录每页 10 条。
- `plan_status` 是平台 `configStatus` 原值（已见样本 1 = 计划生效中，其余取值无标签证据），按原值转述。`today_fee_per_order_yuan` 是平台当日动态费率；`items[].service_fee_yuan` 是平台逐单报告的服务费，CLI 不按费率重算。
- 收费记录与页面默认请求一致：只查收费状态「待收费」「收费成功」（不含「收费取消」），按记录创建时间落在窗口内筛选（不是发货时间）。
- `charged_order_count` / `compensated_order_count` 取自平台数据概况；`total` 是上述筛选下的收费记录总数。两者口径可能不同（实测近 7 天 209 对 203），原样分别转述，不互相校正。
- `items[].fee_status` 是平台收费状态原文；`service_status` 为生效中 / 已失效 / 已补偿运费，未登记码为 `未知(<code>)`。金额单位不是元时对应金额为 `null` 并写入 `meta.warnings`。
- `mall_id` 为当前店铺 ID，与其他 diagnose 报表一致。
- 任一上游请求失败时命令失败，业务错误退出码 6、提示为平台原文。

## diagnose customer-service

- `--days` 1–63，默认 30；窗口为上海日期今天减 days 至昨天。口径固定「多多客服-客服数据（人工回复）」，与体验星级口径相互独立。
- `summary` 覆盖整个区间；`trend.items[]` 来自页面加载的最近 31 天中落在窗口内的日期，带类目响应时长参考。
- 比率后缀 `_pct`，响应时长后缀 `_seconds`；无咨询日为 `null`。
- 汇总失败时命令失败；趋势失败时 `trend:null` 并附 hint。

## diagnose reviews

- `--days` 取 30 / 60 / 90 / 180，默认 30。
- `keyword_tags`：平台满意/不满意标签及计数。`issue_types[]`：五类问题正负面计数和平台占比。`negative_reviews`：`{ items, total, truncated }`，为描述评分 1–3 星的中差评，每页 10 条、最多 30 页，翻满时 `truncated:true`。
- 条目含商品 ID、评价时间、三项评分、正文、追评、标签、已回复状态和图片数；平台给出历史评分时三项评分为 `null`。正文中的手机号已掩码为 `138****5678`。
- 三个数据源分别降级为 `null` 并提示，全部失败时命令失败。

## diagnose traffic

- `--days` 1–30，默认 30，截止日为平台就绪日期。
- 逐日访客、浏览、成交指标及平台同行均值、优秀值。`summary.shop_visitor_count` 是逐日访客数之和，跨日有重复访客，转述时说明。
- 返回日期少于窗口天数时，`summary` 只汇总已返回日期，并附提示。
- `today` 是全店今日截至当前的实时区块，独立于逐日 `items` / `summary`。`snapshot_at` 是 CLI 抓取时间，平台不返回快照时间。访客与浏览量来自流量看板实时值；成交字段取按小时累计的最新一行，`as_of_hour` 是该行小时（通常落后当前约 1 小时），`hourly[]` 为逐小时累计值。两组数据刷新时点不同，转述时分开说明，不互相换算。
- 当天还没有成交累计行时，成交字段为 `null`、`hourly: []`。今日数据拉取失败时 `today: null` 并附提示，逐日数据照常返回。

## goods stock

- 只扫描一页商品（`--size` 默认 50）。`items` 为总库存不高于 `threshold` 的商品，加上总库存高于阈值或缺失、但至少一个在售规格库存不高于阈值的商品。
- `low_stock_count` 只计总库存不高于阈值的商品，可能少于 `items` 条数；仅因规格进入告警的商品由 headline 第三行单独计数，两行合计等于 `items` 条数。
- `skus[]` 为该商品全部规格；`low_stock` 只在规格在售（`on_sale: true`）且库存为已知数并不高于阈值时为 true，在售标记未知或库存缺失不触发。`low_stock_sku_count` 是该商品 `low_stock` 规格数；规格数据缺失时 `skus` 与 `low_stock_sku_count` 均为 `null`（区别于零个规格 `[]` / `0`）。
- 「缺货」在商品级和规格级都指库存 `<= 0`。

## goods traffic

- `--days` 取 1 / 7 / 30，默认 30，截至上海昨天，平台原生区间口径；`--goods-id` 按字符串传递。商品明细最多 20 页，截断时 `data_quality.goods_truncated:true`。
- 推广按商品汇总稳定成本推广和全店托管计划，分别给出直接、间接成交、花费和点击。
- `non_promo_order_count` / `non_promo_amount_yuan` = 商品总成交 − 推广直接成交，是 CLI 推算值，平台不提供该拆分。负差额为 `null` 并附提示。
- 推广拉取失败或达到分页上限：推广字段和差值均为 `null`，`data_quality.promo_complete:false`。完整查询中无投放记录的商品推广字段为 0。
- 推广金额单位无法识别时，对应金额为 `null` 并附提示。
- 推广拆分口径来自第三方插件静态分析，尚未经有投放店铺实测；转述拆分结果时附上这句。
- 明文接口失败或返回字体混淆数据时命令报错。

## goods profit

- `--days` 1–90，默认 30。按成团时间统计上海最近 N 个完整自然日，不含当天，`window.end_at` 为排他上界。`--goods-id` 只筛 `items`，`summary` 始终为全店。
- 收入 = 实付 + 平台优惠。退款成功按全额退款且货已退回处理：货本与收入为 0，已发货仍扣全部按单费用，未发货按单费用为 0；发货时间缺失时相关费用为 `null`。未付款取消的收入与成本为 0；售后处理中（10/11）正常计入，并单列 `after_sales_order_count` / `after_sales_revenue_yuan`。
- `gross_profit_yuan` 扣商家成本，`net_profit_yuan` 再扣推广。`gross_margin_pct` / `net_margin_pct` 是有符号百分数，可负、可超过 ±100；零收入时为 `null`。
- 推广花费仅含商品推广报表口径：商品按 goodsId 归属；`summary.promo_spend_yuan` 取全店总计；`shop_promo_spend_yuan` 是未归属到商品的差额，只计入 summary，负差额为 `null` 并附 hint。
- 缺成本或推广失败时利润为 `null`；完整拉取但无该商品推广记录时花费为 0。订单截断或限流时窗口财务为 `null`，保留 `observed_order_count` / `observed_revenue_yuan`，读取 `summary.data_quality` 与 `hints`。
- `cost_updated_at` 是实际使用成本的最大更新时间；`default_fallback_order_count` 是规格未命中、回落默认成本的单数。成本只保留当前值，更新后历史窗口按新成本重算。
- 转述利润时附三条说明：推广仅含商品推广报表口径；仅退款不退货时利润可能高估；商家共担平台补贴时收入与利润可能高估。

## goods receipt

- 预估实收 = 券前价 − 商家出资优惠，是「商品价格管理」页的平台估算值，按 SKU 给出，CLI 不重算；不含技术服务费、平台补贴，也不是订单收入，和 `goods profit` 的收入口径不同。
- 券前价：有活动价时取活动价，`pre_coupon_price_source` 为活动类型（如「限量折扣」），否则为「拼单价」；`group_price_yuan` 始终是拼单价。
- `single` 是买 1 件的预估实收；`multi` 是多件时平均单件预估实收的最低值，`quantity` 为出现最低值的件数，`multi.discounts[].discount_yuan` 是多件合计优惠。件数为 1 表示多件不比单件更低。
- 口径：`caliber` 为「商家出资常规优惠」（默认）或「商家出资所有优惠」（另含非公开优惠、多单立减、商家出资平台券）。转述时必须带上口径，两种口径的数字不能放在一起比较。
- 平台明确无优惠时优惠为 0、`discounts` 为空；`multi: null` 表示平台没给多件场景；`single: null` 同时有 `receipt_single_missing` 警告。
- `meta.warnings`：`receipt_scene_ignored`（平台返回了其他口径的场景，已忽略）、`receipt_sku_incomplete`（补全后 SKU 数少于平台报告数，`sku_count` 可能偏少）。
- 每页最多 10 个商品，CLI 不自动翻页；按 `total` 和 `--page` 读取其余页。查不到的商品 ID 返回空列表、`total` 为 0，不报错。
