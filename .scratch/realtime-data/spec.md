# 今日实时数据

Status: needs-triage

## 现象

经营报表只能看到过去的数据，看不到今天：

| 命令 | 数据截止 |
| --- | --- |
| `diagnose traffic` / goods-traffic | 平台就绪日（T-1），`readTrafficWindow` |
| `diagnose customer-service` | 昨天，`windowEndingYesterday` |
| `diagnose experience` | 就绪日（T-1，部分字段延迟两天） |
| `goods profit` | 完整自然日，`completeShanghaiWindow` |

`orders list`、`diagnose reviews` 本来就是滚动窗口，不在本需求范围内。

## 上游明文实时来源（侦察记录，未逐一实测）

来源：`docs/research/traffic-cs-review-recon-2026-10-31.md`

- 全店今日流量：`/sydney/api/mallFlow/queryMallFlowRtData`（`muvRt` / `mpvRt` / `guvRt` / `gpvRt`）
- 全店交易小时趋势：`/sydney/api/mallTrade/queryMallTradeList` 的 `todayRtList`（请求参数只记为「同参」）
- 商品今日：`goodsDataShow/queryGoodsPageOverviewForMms`（今日 / 昨日汇总 + `todayList` 小时趋势）、`goodsDataShow/queryGoodsStatDtr`（单商品今日 / 昨日 + 24 小时趋势）
- 客服今日：08–23 点 3 分钟人工回复率、当前待回复人数、`/desert/stat/getMallHourConsultData`（24 小时）
- 全店多商品今日明细只有字体混淆版（`queryGoodsDetailVOListForMMS` queryType=6），不在范围内

侦察时 `network detail` 被截断在 20000 字符，`queryMallTradeList`、`queryGoodsPageOverviewForMms` 的完整字段未知。

## 店透视参考实现（静态分析，未实测）

来源：`docs/research/diantoushi-region-realtime-2026-11-11.md` 第二节。店透视「店铺报表」选「今日」时：

- `queryMallFlowRtData`、`goodsDataShow/queryGoodsPageRT`：都不带参数，响应键带 `Rt` 后缀。`queryGoodsPageRT` 是全店商品维度的今日汇总（`payOrdrCntRt`、`payOrdrAmtRt`、`goodsFavCnt`、`guv`），可作为 `goods traffic` 不带 `--goods-id` 时的候选，比 `queryGoodsPageOverviewForMms` 多一个选择
- `queryMallTradeList`：请求体 `{ queryType: 6, queryDate: <今天> }`，请求头带 `anti-content`；读 `todayRtList`（回退 `todayPerHourRtList`、`dayList`），含今日成功退款 `sucRfOrdrAmt1d` / `sucRfOrdrCnt1d`
- `mallCoreData/queryAppRecentDataList`：今日 / 昨日逐小时累计（`*Dth` 字段，金额推断为厘），可给 `diagnose traffic` 的今日区块提供同时段昨日对照
- 店透视给今日数据打的时间是本机时间 + 2 分钟，上游没有快照时间；CLI 的 `snapshot_at` 是抓取时间，字段说明里要写清
- 店透视把缺失值补成 0；CLI 按契约输出 `null`

01 侦察应以这几个接口为主，逐个实测字段、单位和是否混淆。

## 约束

- 当天未结束的数据和逐日趋势不能混成同一条序列：今日数据放在独立的 `today` 区块，并输出快照时间 `snapshot_at`
- 遵守 `data` 契约 v2；`today` 是现有命令的新增字段，同步更新各命令的 v2 contract case
- 客服实时值必须标明 Reply-Rate Caliber

## 决定

- 2026-11-11：不新增命令，在现有报表的 `data` 中加 `today` 区块（`diagnose traffic`、`goods traffic`、`diagnose customer-service`）
- `today` 默认输出，走 `report.optional`：拉取失败时为 `null` 并写入 hint，不影响原有的历史数据（inference，待评审确认）

## 拆分

- `issues/01`：侦察（阻塞其余）
- `issues/02`：`diagnose traffic` 的 `today` 区块，同时确立共用写法
- `issues/03`、`04`：`goods traffic`、`diagnose customer-service` 的 `today` 区块，依赖 01 和 02，二者彼此独立
