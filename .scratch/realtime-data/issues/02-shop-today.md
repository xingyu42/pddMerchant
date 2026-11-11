# 02: `diagnose traffic` 增加今日实时区块

**What to build:** `diagnose traffic` 的 `data` 新增 `today` 区块，输出全店今日截至当前的流量和成交：店铺 / 商品访客数与浏览量，成交金额、订单数、买家数、客单价、成交转化率，以及按小时累计的成交趋势。原有逐日 `items`、`summary`、`window` 语义不变，今日数据不并入逐日序列。本工单同时确立三个报表共用的 `today` 区块写法，03、04 复用。上游接口、字段和单位以 `docs/research/realtime-and-fee-recon-2026-11-11.md` 第一节为准。

**Blocked by:** 01

**Status:** resolved

上游（两者都是 page-api，导航页为流量看板，成功码 `errorCode 1000000`）：
- `/sydney/api/mallFlow/queryMallFlowRtData`，请求体 `{}`：`muvRt` / `mpvRt` / `guvRt` / `gpvRt`
- `/sydney/api/mallTrade/queryMallTradeList`，请求体 `{ queryType: 6, queryDate: <上海时区今天> }`：取 `todayRtList`（每小时累计），最新一项为当前累计值

`today` 区块形态（字段名沿用 `diagnose traffic` 现有指标命名）：
- `snapshot_at`：CLI 抓取时间（上游不返回快照时间，字段说明写明这一点）
- `as_of_hour`：交易累计最新一项的小时（`"00"`–`"23"`，缺失为 `null`）
- 流量：`shop_visitor_count`、`shop_page_view_count`、`goods_visitor_count`、`goods_page_view_count`
- 成交（取最新累计行）：`pay_amount_yuan`、`pay_order_count`、`pay_buyer_count`、`avg_order_value_yuan`、`pay_conversion_pct`
- `hourly[]`：`{ hour, pay_amount_yuan, pay_order_count, pay_buyer_count }`，按小时累计

共用写法（03、04 复用）：
- 今日采集走 `report.optional`：流量和交易任一失败时 `today: null`，写入一个 hint（文案说明今日数据拉取失败），历史数据照常输出，退出码不变
- 流量与交易来自两个刷新时点不同的接口，不做交叉计算（例如不用访客数和成交买家数重新算转化率）

- [x] fixture 模式下 `diagnose traffic` 输出 `today`，字段与上面一致，数值与合成 fixture 对应（金额元、比率 0-100）
- [x] `todayRtList` 为空或缺失时成交字段为 `null`、`hourly: []`；流量字段照常输出
- [x] 任一今日接口失败（fixture `__throws`）时 `today: null` 并出现 hint，`items` / `summary` 不受影响，退出码 0
- [x] headline 增加一行今日事实（截至几点的成交金额 / 订单数、访客数）；今日不可用时不加
- [x] `data-contract-v2` 中 `diagnose traffic` 的 case 覆盖 `today` 与 `today.hourly[]` 字段集
- [x] 两个新 endpoint spec 有 fixture 合同测试（参照 `test/adapter/traffic-contract.test.js`）
- [x] `npm test` 通过

## Comments

- 2026-11-11：按浏览器侦察结论细化为 ready-for-agent。同时段昨日对照（`yesterdayRtList`）、成功退款 `sucRfOrdr*`（样例全 `null`）不在本工单范围。
- 2026-11-11：已在集成分支 feat/region-sku-stock 完成（8d29c27）。共用写法为服务层 collectToday（today_unavailable hint）；E_TIMEOUT / E_INTERNAL 沿用 report.optional 规则会使命令失败。
