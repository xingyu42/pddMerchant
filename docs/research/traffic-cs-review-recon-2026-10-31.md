# 流量 / 客服 / 评价 — 接口侦察报告

> 数据来源：用户已登录的 Chrome（agent-browser-cli），只读访问 mms.pinduoduo.com 数据中心、多多客服、评价管理（2026-10-31）
> 方法：CDP 网络监听抓取响应体 + 已加载 JS bundle 静态检索请求参数（`SearchData.*`、`goodsEffect.*`、`evaluation.*`、`Aftersales.*`、多多客服 `1.*` / `8.*` chunk）
> 脱敏：店铺 ID、店铺名、商品名、商品 ID、买家昵称/头像、订单号、图片 URL 均未记录；请求头只记录名称；评价正文只给转述
> 范围：免费商家后台；多多情报通等付费工具不在范围内
> 页面上可见的"店透视"面板（商品报表 / 店铺报表 / SKU 分析等）是第三方浏览器插件注入的，与平台接口无关，CLI 应忽略

---

## 〇、结论速览（原始需求逐项）

| 需求指标 | 结论 | 端点 / 说明 |
| --- | --- | --- |
| 店铺 UV（访客数） | **已找到** | `/sydney/api/mallFlow/queryMallFlowOverViewList`（日趋势，明文）；`queryMallFlowRtData`（今日实时，明文）；`/sydney/api/mallScore/queryMallFlowData`（昨日，明文字符串） |
| 自然流量 / 付费流量拆分 | **免费后台未找到** | 流量看板只有访客 / 浏览 / 成交汇总；`SearchData` 和 `goodsEffect` bundle 里没有"流量来源 / 付费流量 / 免费流量"字段或文案 |
| 搜索词热度 | **部分找到** | 只有店铺级"整体商品搜索热度 `srchIndex`"和"整体搜索销售指数 `orderIndex`"（`/sydney/api/mallCoreData/flow/querySearchDataForMms`）。词级热度接口 `/sydney/api/hotWord/queryHotWord`、`queryHotWordCateList` 在 bundle 里有定义，但找不到调用方，也没有页面入口：**未验证** |
| 进店搜索词排行 | **免费后台未找到** | bundle 中没有"进店搜索词 / 搜索词"相关文案和接口 |
| 收藏 | **已找到** | 商品级 `goodsFavCnt`（商品收藏用户数）：`queryGoodsStat` / `queryGoodsStatDtr`（明文），`queryGoodsDetailVOListForMMS`（字体混淆）；店铺关注 `mallFavCnt`：`getMallTradeInfo`（字体混淆） |
| 加购率 | **免费后台未找到** | 已加载 bundle 中"加购"出现 0 次；商品明细只有下单率 `ordrVstrRto`、成交率 `payOrdrRto`、成交转化率 `goodsVcr` |
| 跳失率 | **免费后台未找到** | "跳失"出现 0 次。最接近的是"流量损失指数" `getRunOffUserDetail`（按省份的流失用户指数），口径不同 |
| 3 分钟人工回复率 | **已找到（多套口径）** | `/desert/stat/mallMonthServiceData`（31 天日趋势）、`/desert/stat/mallServiceOverviewData`（区间汇总）、`/sydney/api/customer/queryServiceTrend`（31 天日趋势），详见第四节 |
| 中差评内容 | **已找到** | `/saturn/reviews/list`，按 `descScore`（1-5 星）筛选；列表含正文、追评、图片、平台标签 |
| 评价关键词聚合 | **已找到** | `/saturn/reviews/keywords/agg`（满意 / 不满意标签及计数）、`/saturn/reviews/type/agg`（按问题类型的正负面计数） |

**关键风险：字体反爬。** 本店命中了 `spiderFont` 灰度，多个汇总接口返回的数字是私有区 Unicode 字符（U+E000–U+F8FF），每次加载页面时字体和映射都会变（同一个值 `51` 两次加载分别编码为 `e328 e6f1` 和 `e382 e4c3`）。CLI 应优先使用不加 `spiderFont` 的明文趋势/详情接口，详见第一节。

---

## 一、通用约定

- 除特别注明，端点都是 `POST`、`application/json`，请求头含 `Anti-Content`。外壳为 `{ success, errorCode, errorMsg, result }`，成功时 `errorCode = 1000000`。`/chats/*` 端点的外壳只有 `{ success, result }`
- 就绪日期：数据中心 T+1，本次各个 ReadyDate 都返回 `"2026-10-30"`
- **queryType 枚举**（商品数据、交易数据通用，来自 bundle）：`-1`=realtime，`0`=昨日，`1`=近 7 日，`2`=近 30 日，`3`=自然周，`4`=自然月，`5`=按日，`6`=今日实时，`7`=自定义。注意：`querySearchDataForMms` 使用另一套映射（昨日 0 / 7 日 1 / 30 日 2 / 按日 6）
- **字体混淆机制**（`commons.*.js` 中的 `fetch-plugin-spider`）：
  1. 页面先调用 `/sydney/api/common/checkGray`，`type` 取 5（商品概况）、7（流量看板）、8（商品明细）、9（经营总览）。返回 true 时，请求带上 `{ spiderFont: true }`
  2. 插件 `POST https://api.yangkeduo.com/api/phantom/web/en/ft`，请求体 `{ scene: "cp_b_data_center" }`，返回 `ttf_url`、`web_spider_rule`
  3. 业务请求追加请求头 `webSpiderRule`，页面注入 `@font-face 'spider-font'`。响应中的数值变成**字符串**，数字被替换为私有区字符；`.`、`%` 保持原样
  4. 只有值字段被混淆，`*Pct` / `*Ppr` 环比字段仍然是明文浮点数
  5. `/ft` 失败时，插件会在请求体里加 `sign: "drZtFdOb"` 作为降级请求（只在代码里看到，未验证）
- 受混淆的端点（本次观察到带 `webSpiderRule` 头）：`mallFlow/queryMallFlowOverView`、`goodsDataShow/queryGoodsPageOverView`、`goodsDataShow/queryGoodsDetailVOListForMMS`、`mallTrade/getMallTradeInfo`、`mallScore/queryMallScoreOverView`；代码中还有 `goodsDataShow/queryGoodsPageRT`
- 页面上环比通常显示绝对值加箭头，响应里是带符号的 0-1 比率（例如 `uvPct = -0.1356`，页面显示"较前1日13.56%"）

---

## 二、流量数据（`/sycm/search_data`）

### 2.1 页面

- 子页：流量看板 `/sycm/search_data/plate`（默认）、搜索流量、直播数据、视频数据、营销活动数据、拼单返现数据（后四个与需求无关，没有打开）
- **流量看板**：实时（店铺访客数 / 浏览量、商品访客数 / 浏览量）；数据总览（昨日 / 近 7 日 / 近 30 日 / 按日）：店铺访客数、店铺浏览量、商品访客数、商品浏览量、成交买家数、成交订单数、成交金额、成交转化率、客单价、成交 UV 价值；趋势图可叠加"同行同层均值 / 同行同层优秀值"
- **搜索流量**：整体商品搜索热度、整体搜索销售指数（昨日 / 7 日 / 30 日 / 自定义），外加优化建议卡片。**没有搜索词列表**

### 2.2 端点

| 端点 | 请求体 | 说明 |
| --- | --- | --- |
| `/sydney/api/mallFlow/queryMallFlowOverViewReadyTime` | `{}` | `result` 为就绪日期 `"2026-10-30"` |
| `/sydney/api/mallFlow/queryMallFlowOverViewList` | `{ beginDate, endDate }`（`YYYY-MM-DD`） | **明文**日趋势；前端取 `beginDate = ready - 29 天` |
| `/sydney/api/mallFlow/queryMallFlowOverView` | `{ beginDate, endDate }`，可带 spiderFont | 汇总加环比；本店被**字体混淆** |
| `/sydney/api/mallFlow/queryMallFlowRtData` | 无 | 今日实时：`muvRt`（店铺访客）、`mpvRt`（店铺浏览）、`guvRt`、`gpvRt`，明文整数 |
| `/sydney/api/mallCoreData/flow/querySearchDataForMms` | `{ queryType, queryDate }`；`queryDate` 只在按日时传 | 搜索热度汇总 `overview` 加 7 天 `list` |
| `/sydney/api/mallFlow/getSearchFlowTips` | 无 | 优化建议文案 |
| `/sydney/api/mallFlow/queryMallFlowWhiteList`、`queryLiveGray`、`/sydney/api/common/checkGray {type:7}` | — | 灰度 / 白名单标记 |
| 只有定义没有调用方：`/sydney/api/hotWord/queryHotWord`、`queryHotWordCateList`、`queryHotWordCateListByLvl`、`/sydney/api/mallFlow/getMallFlowData {startDate,endDate}`、`getMallVisitPayPercent {queryDate}`、`/sydney/api/mallFlow/readyDate` | — | 推测是旧版热词 / 流量页的遗留代码；没有页面入口，未调用，**未验证** |

### 2.3 `queryMallFlowOverViewList` 字段（每天一行，`statDate`）

| 字段 | 页面标签 | 样例（10-30） | 单位 |
| --- | --- | --- | --- |
| `uv` / `pv` | 店铺访客数 / 店铺浏览量 | 51 / 60 | 人 / 次 |
| `guv` / `gpv` | 商品访客数 / 商品浏览量 | 51 / 59 | 人 / 次 |
| `payOrdrUsrCnt` / `payOrdrCnt` / `payOrdrAmt` | 成交买家数 / 成交订单数 / 成交金额 | 1 / 1 / 17.9 | 人 / 单 / **元** |
| `payUvRto` | 成交转化率 | 0.0196 | **0-1** |
| `payOrdrAup` | 客单价 | 17.9 | 元 |
| `uvCfmVal` | 成交 UV 价值 | 0.351 | 元/访客 |
| `cfmOrdr*`、`cfmUvRto` | 成团买家数 / 订单数 / 金额 / 客单价 / 成团转化率 | — | 同上 |
| `*1dPln` / `*1dOst` | 同行同层均值 / 同行同层优秀值 | 例如 `uv1dPln=30`、`uv1dOst=122` | 与主字段相同 |

- 响应体被 CDP 截断在 20000 字符，只看到 10-30 到 10-10 的 21 天；完整返回应为 30 天（按前端请求推断）
- 最大日期跨度未验证

### 2.4 `querySearchDataForMms`

| 字段 | 页面 | 样例 | 单位 |
| --- | --- | --- | --- |
| `overview.srchIndex` | 整体商品搜索热度 | 32.4507 | 指数（无量纲） |
| `overview.orderIndex` | 整体搜索销售指数 | 0 | 指数 |
| `overview.srchIndexPct` / `orderIndexPct` | 较前 1 日 | -0.0287 / -1 | 0-1 带符号比率 |
| `list[].srchIndex` / `orderIndex` | 趋势 | — | 指数 |
| `list[].srchIndexPln` / `orderIndexPln` | 同行均值 | 135.89 / 0.2003 | 指数 |

---

## 三、商品数据（`/sycm/goods_effect`）

### 3.1 页面

- **商品概况**（实时 / 昨日 / 7 日 / 30 日 / 周 / 月 / 自定义）：商品访客数、商品浏览量、昨日收藏用户数、被访问商品数、成交金额、成交订单数、成交买家数、成交转化率
- **商品明细**：可按商品 ID 查询，可排序，分页 10/30/50。列：商品访客数、浏览量、成交金额、成交件数、成交订单数、成交买家数、成交转化率、商品收藏用户数、下单率、成交率、流量损失指数
- **数据详情**（弹窗）：单商品指标加小时/日趋势，附评价数据、近 30 日售后数据、近 30 日商品领航员

### 3.2 端点

| 端点 | 请求体 | 明文/混淆 | 说明 |
| --- | --- | --- | --- |
| `goodsDataShow/queryGoodsPageOverViewReadyDate`、`queryGoodsReadyDate` | 无 | 明文 | `"2026-10-30"` |
| `goodsDataShow/queryGoodsPageOverviewForMms` | `{}` | **明文** | 今日 / 昨日汇总（值为字符串，如 `"4.76%"`），加 `todayList` 小时趋势（数值，含 `*1dPln/*1dOst`） |
| `goodsDataShow/queryGoodsPageOverView` | `{ queryType, queryDate }` | 混淆 | 概况卡片 |
| `goodsDataShow/queryGoodsDataDayTrendForMms` | `{ statDate }` 或自定义区间 | 未抓到 | 日趋势（自定义区间） |
| `goodsDataShow/queryGoodsDetailVOListForMMS` | `{ goodsId?, startDate, endDate, queryType, sortCol, sortType, pageNum, pageSize, actVs: 1 }` | 混淆 | 商品明细；今日实时时 `startDate = endDate = 今天` |
| `goodsDataShow/queryGoodsDetailVOList` | 同上，不带 `actVs` | 未抓到 | 灰度关闭时走这个非混淆版本 |
| `goodsDataShow/queryGoodsStatDtr` | `{ goodsId }` | **明文** | 单商品今日 / 昨日汇总，加 24 小时趋势 |
| `goodsDataShow/queryGoodsStat` | 推测为 `{ goodsId }` | **明文** | 单商品 `yesterdayGoodsDetail` / `weekGoodsDetail` / `monthGoodsDetail` 汇总（含 `*Ppr` 环比、`peerPerf*`），加日列表（看到 10-01 起，被截断） |
| `goodsDataShow/goodsDetails/getRunOffUserDetail` | `{ goodsId }` | 未调用 | 流量损失指数，按省份（`province`、`runOffUserCnt`，指数化） |
| `goodsDataShow/queryGoodsProblems` | `{ goodsId }` | 明文 | 商品体检结果（本店为 null） |
| `mallCoreData/queryGoodsAfterSales` | 推测为 `{ goodsId }` | 明文 | 近 30 日售后；**响应里含店铺 ID 和店铺名，必须剔除** |
| `mallCoreData/queryGoodsNavigator` | — | — | 弹窗里的商品领航员 |

`sortCol` 枚举：goodsUv 0、goodsPv 1、payOrdrCnt 2、goodsVcr 3、cfmOrdrRto 4、goodsFavCnt 5、payOrdrGoodsQty 6、payOrdrUsrCnt 7、payOrdrAmt 8、cfmOrdrCnt 9、cfmOrdrGoodsQty 10、fansCnt 11、goodsPtHelpRate 12、ordrVstrRto 13、payOrdrRto 14；`sortType` 0=升序、1=降序。

### 3.3 单商品字段（`queryGoodsStat` / `queryGoodsStatDtr`，明文）

| 字段 | 页面标签 | 单位 |
| --- | --- | --- |
| `goodsUv` / `goodsPv` | 商品访客数 / 浏览量 | 人 / 次 |
| `goodsFavCnt` | 商品收藏用户数 | 人 |
| `payOrdrAmt` / `payOrdrAmtCent` | 成交金额 | **元** / **分**（两个字段同时给出） |
| `payOrdrCnt` / `payOrdrUsrCnt` / `payOrdrGoodsQty` | 成交订单数 / 买家数 / 件数 | — |
| `goodsVcr` | 成交转化率 | 0-1 |
| `ordrVstrRto` | 下单率 | 0-1 |
| `payOrdrRto` | 成交率 | 0-1 |
| `imprUsrCnt` / `cnsltUsrQty` | 曝光人数（推测） / 咨询人数（推测） | 人，本店多为 0 |
| `*Ppr` | 环比 | 0-1 带符号；`-1` 表示降到 0 |
| `peerPerf*` | 同行表现档位（取值 1/2/4） | 整数档位，**含义待确认** |

混淆版明细（`queryGoodsDetailVOListForMMS`）还有 `goodsPtHelpRate`（商品求助平台率）、`cate3AvgGoodsVcr`（三级类目平均转化率）、`*Ytd`（昨日对比值）、`hotGoodsActivityInfo` 等字段；`hdThumbUrl` 和 `adStrategyJumpUrl` 是 URL，不能输出。

---

## 四、经营总览 / 交易数据（只核对 UV 和转化的位置）

| 页面 | 端点 | 含义 |
| --- | --- | --- |
| 经营总览 `/sycm/evaluation` | `/sydney/api/mallScore/queryMallFlowData`（无参，明文字符串） | 昨日 `uv` "51"、`pv` "60"、`srchIndex` "32.45"、`orderIndex`、`totalFansCnt`、`curWeekFansCnt`，以及 `*Pct` 环比 |
| 经营总览 | `/sydney/api/mallScore/queryMallCustomerServiceData`（明文） | `manuReplyRate3Min` "0.00%"、`avgManuReplyDuring`、`manuReceptUsrCnt`、`inquiryOrderRate`、`csSalesAmt`，以及 `*Dod` 环比；`t1StatDate=10-30`、`t3StatDate=10-28` |
| 经营总览 | `/sydney/api/mallScore/queryMallScoreOverView`（混淆） | `dealDataVO`（成交、转化 `goodsVcr1d`）、`serviceDataVO`（退款、介入率） |
| 交易数据 `/sycm/stores_data` | `/sydney/api/mallTrade/getMallTradeInfo`（`{queryType, queryDate, startDate?, endDate?}`，混淆） | 成交金额 / 订单 / 买家、`payUvRto` 成交转化率、`rpayUsrRtoDth` 成交老买家占比、`mallFavCnt` 店铺关注用户数、`uvCfmVal` 访客价值。**不含 UV** |
| 交易数据 | `/sydney/api/mallTrade/queryMallTradeList`（同参，明文数值） | `todayRtList` 等小时趋势 |

结论：UV 在流量看板和经营总览里有；交易数据只有转化率和访客价值，没有 UV。

---

## 五、客服数据

### 5.1 多多客服 → 客服数据（`/mms-chat/overview/service`）

页面：实时（3 分钟人工回复率（08-23 点）、当前待回复人数）、消费者服务体验分、数据总览（近 1 / 7 / 30 天 / 自定义：咨询人数、需人工回复的咨询人数、人工接待人数、3 分钟人工回复率、平均人工响应时长）、近 30 天趋势图（本店铺 / 同类目前 10% 均值 / 同类目整体均值）、分时咨询数据。其他子页：销售数据、客服绩效数据、催付数据、开场白数据。

| 端点 | 方法 / 参数 | 说明 |
| --- | --- | --- |
| `/desert/stat/mallServiceRealTimeData` | GET，无参 | `replyRate3Min`（0-1）、`replyRate3MinThreshold`=0.5、`needReplyUserCnt`、`consultUserCnt`、`manuReceiveUserCnt` |
| `/desert/stat/mallServiceOverviewData` | POST `{ startDate, endDate }`（`yyyy-MM-dd`） | 区间汇总，见下表 |
| `/desert/stat/mallMonthServiceData` | GET，无参 | **固定返回最近 31 天的日趋势**（09-30 到 10-30），前端截取后 30 天 |
| `/desert/stat/getMallHourConsultData` | POST `{ startDate, endDate }` | 24 小时：`hour`、`replyUser3Min`、`unReplyUser3Min` |
| `/fission/functions/mms-chat/least-service-score` | POST | 消费者服务体验分明细（snake_case，含 `cstmr_serv_score` 2.76、各分项分数和排名、求助率），**响应里含店铺 ID 和店铺名，必须剔除** |
| 销售数据：`/desert/stat/mallSalesOverviewData`（POST `{startDate,endDate}`）、`/desert/stat/mallMonthSalesData`（GET） | — | `inquiryOrderUserCnt` 询单人数、`groupUserCnt` 成团人数、`inquiryOrderTransformRate` 询单转化率（0-1）、`csSalesAmount` 客服销售额、`csCanImproveSalesAmount`，以及 `inquiryConfirmRateTop10Avg / TotalAvg` |
| 客服绩效：`/chats/csReport/overview`、`/chats/csReportDetail?starttime&endtime`（GET）、`/desert/stat/mallCsDisputeCs` | — | 按客服账号拆分（`cs_name` 等），**含客服账号名，属于敏感数据**；字段例如 `reply_rate_3_min`、`5min_reply_rate`（0-100）、`reply_30s_rate`、`avg_reply_time` |
| 禁止调用：`/desert/stat/mallServiceDataExport`（下载） | — | — |

自定义区间限制（bundle）：只能选 `[今天-63天, 昨天]`。

`mallServiceOverviewData` / `mallMonthServiceData` 字段：

| 字段 | 页面标签 | 样例（10-24~10-30） | 单位 |
| --- | --- | --- | --- |
| `consultUserCnt` | 咨询人数 | 3 | 人 |
| `needManuReplyConsultUserCnt` | 需人工回复的咨询人数 | 2 | 人 |
| `receiveUserCnt` | 人工接待人数 | 3 | 人 |
| `manuReplyRate3Min` | 3 分钟人工回复率 | 1.0 | **0-1**（前端 ×100） |
| `manuReplyRate30s` | 30 秒回复率 | 1.0 | 0-1 |
| `artificialResponseTime` | 平均人工响应时长 | 14.67 | **秒** |
| `unsatisfiedServeScoreCnt` / `serveRefundCnt` / `complainCsUserCnt` | 不满意评价数 / 服务退款数 / 投诉客服人数 | 0 | 个 / 人 |
| `*Compare` | 较前 N 日 | null | 0-1 |
| 趋势专有：`avgReplyTimeTop10` / `avgReplyTimeTotal` | 同类目前 10% 均值 / 整体均值（响应时长） | 7.07 / 100.08 | 秒 |
| 趋势专有：`avgReply30sRateTop10` / `avgReply30sRateTotal`、`reply30sRateStapleRank`、`reply30sRateCompare` | 同类目 30 秒回复率均值、排名 | 1 / 0.66 | 0-1 / 整数 |

无咨询的日子，本店指标为 `null`（不是 0），同类目均值仍然有值。

### 5.2 数据中心 → 服务数据 → 客服数据（`/sycm/goods_quality/customer`）

| 端点 | 参数 | 说明 |
| --- | --- | --- |
| `/sydney/api/customer/queryReadyDate` | **GET** | `"2026-10-30"` |
| `/sydney/api/customer/querySpecifiedDayServiceQuality` | `{ queryDate }` | 单日：`customerServiceTrendVO.{ in3minRplyUsrRto1d, rplyUsrRto5min1d, avgRplyTime1d, cfmOrdrAmt3d, inqorUsrCnt1dRatio, statDate }`，以及 `cmprP1d*` 较前一天 |
| `/sydney/api/customer/queryServiceTrend` | `{ startDate: ready-30天, endDate: ready }` | `customerServiceTrendVOList` 共 31 行 |

单位：`in3minRplyUsrRto1d`、`rplyUsrRto5min1d`、`inqorUsrCnt1dRatio` 是 0-1；`avgRplyTime1d` 和 desert 的 `artificialResponseTime` 同值（12、16、950），推断单位是**秒**，页面显示为"x.xx分钟"；`cfmOrdrAmt3d` 客服销售额，元（推断）。

**数据缺口语义不一致**：同样是无咨询的日子，这个接口有时给 `null`，有时给 `0`（例如 10-24 和 10-30 全部为 0，10-25 和 10-28 为 null），`avgRplyTime1d` 永远是 0。CLI 无法凭 0 判断"真实为 0"还是"无数据"，应以 desert 接口的 null 为准，或结合 `consultUserCnt` 判断。

### 5.3 3 分钟回复率口径对照（同一店铺，互相不一致）

| 来源 | 值 | 口径 |
| --- | --- | --- |
| desert `mallServiceOverviewData`（10-24~10-30） | 1.0 | 人工回复，区间 |
| desert / sydney 日趋势 10-26、10-27 | 1 / 1 | 单日 |
| 客服页实时（08-23 点） | 0 | 今日 |
| `least-service-score` `in3min_rply_usr_rto_1d`（10-30） | 0.538（7/13，字段名前缀 `aprs_`） | 与 desert 当天 null 冲突，推测为另一口径（例如含售前售后全量会话） |
| 综合体验星级 `aprsIn3minRplyUsrRto1m`（见 pilot 报告） | 0.5 | 近 30 天 |

报表必须注明来源和口径，不能混用。

---

## 六、评价

### 6.1 评价管理（`/goods/evaluation/index`）

页面：评价数据卡片（店铺评价分排名、近 90 日评价数 35、今日评价数）；筛选：评价时间（近 30 / 90 / 180 天 / 自定义）、评价标签（满意 / 不满意，含计数）、用户评价得分（1-5 星）、评价内容（有图片 / 有视频 / 主评有文字 / 有追加评价 / 已举报）、商家回复（已回复 / 未回复）、参与活动、订单编号、商品 ID、关键词；列表"共查询到 34 条数据（未包含默认评价）"。

| 端点 | 请求体 | 说明 |
| --- | --- | --- |
| `/saturn/reviews/list` | `{ startTime, endTime, pageNo, pageSize, goodsId?, orderSn?, keyword?, descScore?: [...], pictureStatus?, videoStatus?, mainReviewContentStatus?, appendStatus?, reportStatus?, replyStatus?: 1\|2, activityIdList? }` | 评价列表；`startTime/endTime` 为 **Unix 秒**；默认近 90 天，从当天 00:00 起算；`pageSize` 默认 10 |
| `/saturn/reviews/keywords/agg` | `{ startTime, endTime, rangeType }` | 平台标签聚合 |
| `/saturn/reviews/type/agg` | 同上 | 问题类型聚合 |
| `/saturn/review/reply/info` | GET `?filter_uid=` | 互动消息计数（`totalNum`、`unreadNum`） |
| `/sydney/api/saleQuality/queryMallDsrVOListSpecialDays` | `{ queryDate }` | 店铺评价分 7 天趋势 |
| `/sydney/api/saleQuality/queryGoodsEvaluateHrVOV2` | 无 | 今日 / 昨日评价数，加 15 天 `list[].nfkNdfltNmlcValidChckPassRevCnt`（有效评价数） |
| `/sydney/api/saleQuality/queryReadyDateForMallDsrVOListSpecialDays` | — | 就绪日期 |
| 禁止调用（写操作）：`/saturn/reviews/merchant`（回评）、`/saturn/review/reply/submit`、`/saturn/reportedReview/edit/createReportedReview`（举报）、`/saturn/review/reply/publish`、`/saturn/review/reply/cancel/publish`、`/saturn/reviews/analyze/survey/answer`、`/saturn/new/goods/reward/update/goods/service`、`/saturn/mall/goods/expert/report/expert`、`/sydney/api/mallScore/clickExpressSmsToast` | — | — |

`rangeType`：近 30 天=1、近 60 天=5、近 90 天=4、近 180 天=3、自定义=-1。筛选项在 bundle 里用 `"descScore-1"` 这类 `key-value` 字符串表示，按 `-` 拆开后放进数组，所以 `descScore` 是数组（元素可能是字符串）。**请求体是根据 bundle 推断的，没有直接观察到**：页面请求库持有原始 `fetch` 引用，页面内 hook 没有捕获到。

`reviews/list` 字段：

| 字段 | 含义 | 处理 |
| --- | --- | --- |
| `totalRows` / `showNum` / `totalNum` | 筛选结果数（不含默认评价） | 输出 |
| `allReviewNum` / `reviewNumThreeMonth` / `reviewNumToday` | 累计 / 近 90 日 / 今日评价数 | 输出（`allReviewNum` 在全店视图为 5089，单品视图为 886） |
| `negNoReplyReviewNum` | 中差评未回复数（按字段名推断） | 输出 |
| `data[].descScore` / `logisticsScore` / `serviceScore` | 描述 / 物流 / 服务评分 | 1-5 星 |
| `data[].score` | 本次全部为 0，含义待确认 | — |
| `data[].comment` / `appendReview` / `reply` | 正文 / 追评 / 商家回复 | 文本，可能含 PII，必须脱敏 |
| `data[].keywords[]` | 平台给这条评价打的标签（如"做工好""质量好"） | 输出 |
| `data[].status` | 取值 2 或 4；4 的那几条显示为"该用户觉得商品很好…"（推测是没有文字的默认文案） | 待确认 |
| `data[].pictures[]` / `video` | 媒体 | 只输出数量，不输出 URL |
| `data[].createTime` | 评价时间 | Unix 秒 |
| `data[].name` / `avatar` / `orderSn` / `orderId` / `specs` / `thumbUrl` / `goodsInfoUrl` / `orderSnapshotInfo` | 昵称（已打码）/ 头像 / 订单号 / 规格 / 图片 | **全部禁止输出** |
| `goodsInfo.negKeywordList` | 单品负面关键词（本次为 null） | 待观察 |
| `goodsOrMallDsr` | 单品视图下为商品评分（4.56） | — |

`keywords/agg`：`positiveKeywordList[] / negativeKeywordList[]`，每项为 `{ keywordName, num }`。本次样例：满意标签"款式精致 4、透气性好 4、外观精美 3、做工好 2 …"，不满意标签"与描述不一致 1"。
`type/agg`：`typeList[]`，每项为 `{ typeName, positive, negative, posAndNeg, proportion }`，`typeName` 取值为商品质量 / 商品描述 / 商品价格 / 商家服务 / 物流问题，`proportion` 是 **0-100 整数**（44 + 56）。

评价内容转述（无个人信息）：一条 4 星评价称透气、有弹性、做工细；其余多为平台默认的好评文案或纯表情。

### 6.2 数据中心 → 服务数据 → 评价数据（`/sycm/goods_quality/comment`）

页面：店铺评价分排名、近 90 日评价数（较前 1 日）、今日评价数；"近 30 日存在有效评价的商品"列表（商品评价分排名、近 30 日评价数、今日评价数），可按商品 ID 查询（最多 10 个）。

| 端点 | 请求体 | 说明 |
| --- | --- | --- |
| `/sydney/api/saleQuality/queryGoodsEvaluateVO` | `{ pageSize, pageNo, sortCol?, sortType?, goodsIdList? }` | `goodsEvaluates[]`：`goodsUnfkUndfltRevCnt1m`（近 30 日有效评价数）、`todayEvaluationCount`、`avgDescRevScr1m` / `avgLgstRevScr1m` / `avgServRevScr1m`（近 30 日描述 / 物流 / 服务均分）、`starless4OrdrDfltRevCnt1m`、`avgAntiDescCtgrpRevScrPct1m`、`avg*Rank`、`goodsStatus`；`mallOprGoodsCntStd` 为总数 |
| `/sydney/api/saleQuality/queryMallDsrVOListSpecialDays` | `{ queryDate }` | 7 天：`mallUnfkUndfltRevCnt3m`（近 90 日评价数 35）、`descOver50RevScr3m` 等、`avg*RevScrStplPct3m`（本店为 **-1，表示无排名的哨兵值**）、`*Ppr` |
| `/sydney/api/saleQuality/queryGoodsEvaluateHrVOV2` | 无 | 同 6.1 |
| `/sydney/api/saleQuality/queryGoodsEvaluateDetailVOList` | `{...}` | 单品评价趋势（未触发） |

数据中心只有评价**数量和评分**，没有评价正文和标签聚合；正文和聚合只在 `/saturn/*`。

---

## 七、数据可用性与注意事项

1. **字体混淆**是最大障碍。可以绕开的明文来源：流量日趋势 `queryMallFlowOverViewList`、今日实时 `queryMallFlowRtData`、昨日 `mallScore/queryMallFlowData`、单品 `queryGoodsStat` / `queryGoodsStatDtr`、小时趋势 `queryGoodsPageOverviewForMms`、交易小时趋势 `queryMallTradeList`。**全店多商品的明细列表只有混淆版**（`queryGoodsDetailVOListForMMS`），要逐个商品调用 `queryGoodsStat`，或者解析 TTF 字形
2. 混淆是否开启取决于 `checkGray` 灰度，其他店铺可能拿到明文；CLI 应检测私有区字符，命中时报"数据不可用"，不能当数字解析
3. 多个响应带 PII 或店铺标识：`queryGoodsAfterSales`、`least-service-score`（店铺 ID 和名称）、`reviews/list`（昵称、头像、订单号）、`csReportDetail`（客服账号名）、商品图 URL。必须在视图层白名单投影
4. 金额：数据中心金额是元（浮点），`queryGoodsStat` 同时给出 `payOrdrAmtCent`（分）；比率几乎都是 0-1；例外是 `type/agg.proportion` 和 `csReportDetail` 的 `5min_reply_rate`，为 0-100
5. 哨兵值：`-1` 表示无数据（`avg*RevScrStplPct3m`），`*Ppr = -1` 表示降为 0
6. 本店流量很小（日 UV 约 30-50，咨询个位数），很多指标为 0 或 null，口径差异难以用本店数据验证
7. 客服页加载时，页面自己发出了 `POST /mercury/popularize/confirm`（弹窗曝光确认）。这是页面自动行为，不是本次操作触发的；CLI 也不应该调用
8. 截断：`network detail` 20000 字符上限，导致 `queryMallFlowOverViewList`、`queryGoodsStat`、`queryGoodsPageOverviewForMms`、`queryMallTradeList` 的完整行数未知

## 八、开放问题

1. `queryMallFlowOverViewList` 和 `queryServiceTrend` 允许的最大日期跨度（前端只请求 30 天）
2. `hotWord/queryHotWord` 是否仍然可用、请求参数是什么（只有 API 定义，没有调用方；不重放请求的话无法验证）
3. `queryGoodsStat` 的完整参数（推测为 `{ goodsId }`），以及日列表的长度
4. `peerPerf*` 档位、`reviews/list` 中 `score` 和 `status` 的语义
5. `least-service-score` 的 `in3min_rply_usr_rto_1d`（`aprs_` 前缀）和 desert `manuReplyRate3Min` 的口径差异
6. `reviews/list` 请求体的实际形态（`descScore` 是数组还是逗号分隔字符串）；需要在 CLI 的页面内 XHR 拦截里实测
7. 字体映射能否稳定解析（每次加载都换 TTF，需要读字形轮廓，不能写死码表）
8. sydney 客服趋势里 `0` 和 `null` 混用的规律
