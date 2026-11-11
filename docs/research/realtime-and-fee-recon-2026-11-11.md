# 今日实时数据与消费者体验提升计划服务费：只读实测

> 2026-11-11 19:30 前后，用户已登录的 Chrome（agent-browser-cli）。方法：页面自身请求的 CDP 抓包；`/sydney/api/*` 和 `/desert/*` 另在页面上下文用不带签名的 `fetch` 直接 POST 复核
> 脱敏：订单号、收费编号、售后单号、店铺 ID、商品 ID、商品名均未记录；数值只保留说明口径所需的样例
> **风控**：对 `/vodka/v2/mms/query/display/mall/goodsList` 做不带签名的 `fetch` 重放，立即返回 `error_code 54001 操作太过频繁` 并附 `verifyAuthToken`。vodka 接口必须走页面签名客户端（page-api），不能裸调；本次未再重试

## 一、今日实时（`realtime-data` 01）

所有接口都是明文，响应外壳 `{ success, errorCode: 1000000, errorMsg, result }`；不带 `Anti-Content` 的 POST 也能拿到（实现时仍走 page-api，与现有端点一致）。上游**均不返回快照时间**。

| 端点 | 请求 | 结果 |
| --- | --- | --- |
| `/sydney/api/mallFlow/queryMallFlowRtData` | POST `{}`（流量看板页面原生调用） | `result`：`muvRt` / `mpvRt` / `guvRt` / `gpvRt`，整数，只有这 4 个字段 |
| `/sydney/api/mallTrade/queryMallTradeList` | POST `{ queryType: 6, queryDate: "<今天 YYYY-MM-DD>" }` | `todayRtList[]`（按小时**累计**，`hr` "00"..当前小时）、`yesterdayRtList[]`（24 项）、`todayPerHourRtList[]` / `yesterdayPerHourRtList[]`（每小时**增量**：`payOrdrCnt` / `payOrdrUsrCnt` / `payOrdrAmt`）、`dayList: null`、`delayData`。累计行字段：`payOrdrAmt`（元，浮点）、`payOrdrCnt`、`payOrdrUsrCnt`、`payOrdrAup`（元）、`payUvRto`（0-1）、`rpayUsrRtoDth`、`sucRfOrdrAmt1d` / `sucRfOrdrCnt1d`（今日成功退款，样例中为 `null`）、`mallFavCnt`、`uvCfmVal` 及一组 `*Pct`（样例全为 `null`）。完整响应约 22.5 KB |
| `/sydney/api/goodsDataShow/queryGoodsPageRT` | POST `{}` | 全店商品汇总，**值全是格式化字符串**：`payOrdrAmtRt: "745.36"`（千分位逗号，如 `"1,203.64"`）、`payOrdrCntRt: "39"`、`payUvRtoRt: "9.55%"`、`guvRt`、`gpvRt`、`vstGoodsCntRt`。不带 `Rt` 的同名字段是**昨日全天**（与交易接口 `yesterdayRtList` 末项一致） |
| `/sydney/api/mallCoreData/queryAppRecentDataList` | POST `{}` | `todayData[]` / `yesterdayData[]`，按小时累计（`date` "00".."23"）：`guvDth`、`gpvDth`、`payOrdrCntDth`、`payOrdrUsrCntDth`、`payUvRto`；金额 `payOrdrAmtDth` 为**厘**，同时给 `payOrdrAmtDthCent`（分），客单价 `payOrdrAupDth` / `payOrdrAupDthCent` 同理 |
| `/sydney/api/goodsDataShow/queryGoodsStatDtr` | POST `{ goodsId }` | 单商品：`todayGoodsDetail` / `yesterdayGoodsDetail`（`statDate`，`payOrdrAmt` 元 + `payOrdrAmtCent` 分，`payOrdrCnt`、`payOrdrUsrCnt`、`payOrdrGoodsQty`、`goodsUv`、`goodsPv`、`ordrVstrRto` / `payOrdrRto` / `goodsVcr`（0-1）、`goodsFavCnt`、`imprUsrCnt`、`cnsltUsrQty`），以及 `todayGoodsDetailList[]` / `yesterdayGoodsDetailList[]`（按 `statHr` 累计） |
| `/desert/stat/mallServiceRealTimeData` | GET，无参数（客服数据页原生调用） | `replyRate3Min`（0-1，样例 1.0）、`replyRate3MinThreshold`（0.5）、`needReplyUserCnt`、`consultUserCnt` / `manuReceiveUserCnt`（样例 `null`） |
| `/chats/cs/unreplyUser/count` | GET | `result.unreply_num` |
| `/desert/stat/getMallHourConsultData` | POST（页面默认请求返回的 20–23 点有数据，是**前一天**） | `list[]`：`hour`、`replyUser3Min`、`unReplyUser3Min`；传今天的行为未验证 |

口径差异（同一时刻）：
- 商品访客 `queryMallFlowRtData.guvRt` = 377，`queryAppRecentDataList.todayData` 最新小时 `guvDth` = 357，`queryGoodsStatDtr.todayGoodsDetail.goodsUv` = 374（单商品店铺）。实时接口与小时快照的刷新时点不同，不能混成一条序列
- 交易累计 `todayRtList` 最新 `hr` 落后当前时间约 1 小时

对 `realtime-data` 工单的影响：
- 02（`diagnose traffic`）：`queryMallFlowRtData` + `queryMallTradeList(queryType 6)`；可选用 `yesterdayRtList` 做同时段昨日对照
- 03（`goods traffic`）：带 `--goods-id` 用 `queryGoodsStatDtr`；不带用 `queryGoodsPageRT`，需要解析千分位和百分号字符串
- 04（客服）：`mallServiceRealTimeData`（回复率口径为"客服数据页实时"）+ `unreplyUser/count`；分时数据要先确认传今天的请求参数

## 二、消费者体验提升计划服务费（`experience-plan-fee` 01）

页面：`https://mms.pinduoduo.com/freight/return_freight`（"消费者体验"）。页面显示"计划生效中""今日服务费 1.11元/单"、数据概况（收费订单数、已获运费补偿订单数，可选今天 / 昨天 / 近 7 / 30 / 90 天 / 自定义）、收费记录（最多近 180 天）、运费补偿记录、操作记录。

页面 bundle 中同模块还有**写接口**：`/mms-gateway/rfreight/close_service`、`pause_service`、`openService`（开通）、`mallInsurance/refreshServiceStatus`。一律不调用。

| 端点 | 请求体（来自页面 bundle） | 响应 |
| --- | --- | --- |
| `/mms-gateway/rfreight/mall_insurance_status` | 无 | `configStatus`（样例 1）、`restartTime`、`pauseRestartMode` 等 |
| `/mms-gateway/rfreight/mallInsurance/queryAvailableInfo`、`validInfo` | 无 | `normalService.algoDailyStrategy`：`priceType`、`price` / `smallPrice` / `largePrice`，均为 `{ unit: "YUAN", value: "1.11", unitCode: 1 }`（**当日费率**，动态） |
| `/mms-gateway/rfreight/postpaid/profits` | `{ farDate, closerDate }`：距今天数，近 7 天为 `[6, 0]`，今天 `[0, 0]`，昨天 `[1, 1]` | `{ orderCount, compensationCount }` |
| `/mms-gateway/rfreight/postpaid/order_insurance_list` | `{ pageSize: 10, pageNumber: <从 0 开始>, orderSnList?, batchSnList?, newStatusList?, queryFeeStatusList, clientType: 1, shippingBeginTime?, shippingEndTime?, createBeginTime?, createEndTime? }`（时间为毫秒） | `{ total, orderInsurances[] }`；每项：`orderSn`、`sn`（`<orderSn>-MI`）、`batchSn`（收费编号）、`serviceAmountVO` / `costVO`（`{ unit: "YUAN", value: "1.11" }`）、`status`、`feeStatusDesc`（"收费成功"）、`displayStatus`、`effectiveTime`（毫秒）、`ineffectiveTime`、`shippingTime`（毫秒）、`isFree`、`hasDiscount`、`discount`、`insuranceMode` |
| `/mms-gateway/rfreight/postpaid/compensation_list` | `{ pageSize: 10, pageNumber: <从 0 开始>, orderSnList?, compensationReasonList?, afterSalesIdList?, statusList?, clientType: 1, shippingBeginTime?, shippingEndTime? }` | `{ total, compensations[] }`；每项：`orderSn`、`afterSalesId`、`amountVO`（补偿金额，元，如 "2.55" / "5.01"）、`status` / `displayStatus`（5）、`copy`（"已补贴运费"）、`compensationReason`、`shippingTime`（毫秒） |
| `/mms-gateway/rfreight/postpaid/coupon/query` | 无 | 福利券列表（样例为空） |

状态枚举（bundle）：收费状态 1 = 待收费、2 = 收费成功、3 = 收费取消（文案按 bundle 推断）；服务状态 1 = 生效中、2 = 已失效、3 = 已补偿运费。

页面默认参数（静态 bundle 分析补充）：收费记录列表默认发送 `queryFeeStatusList: [1, 2]`（1 = WaitFee 待收费、2 = FeeSuccess 收费成功；3 = FeeCancel 不查），时间窗口用 `createBeginTime` / `createEndTime`（毫秒，默认今天减 6 天 00:00:00 至今天 23:59:59），不按发货时间筛选。`diagnose experience-plan` 据此对齐请求。

结论：
- **有逐单数据**，按 `orderSn` 能和订单对齐 → `experience-plan-fee` 03（接入 `goods profit`）可做
- 服务费逐单金额动态（今日 1.11 元/单，随日费率变化）；运费补偿是另一条收入，按售后单记录
- 收费记录只保留近 180 天；"近 7 天收费订单数 209"与列表 `total` 203 不一致，口径（下单 / 发货 / 生效时间）未确认
- 退款后服务费是否退还、`status` 其余取值的实际样本未见（样例全部为收费成功 / 生效中）

## 三、SKU 库存（`sku-stock` 冒烟补充）

从商品列表页 React 状态读取（页面自己的签名请求结果，未重放）：`goods_list[].sku_list[]` 字段为 `spec`、`newSpec`、`skuId`（数字）、`skuQuantity`（数字）、`skuSoldQuantity`、`outSkuSn`、`isOnsale`（**布尔**）、`normalPrice`、`groupPrice`、`activityGroupPrice`、`skuThumbUrl`、`specIdList`、`reserveQuantity`、`isSkuLowQuantity` 等。样例商品 18 个规格，`skuQuantity` 合计 1386，商品 `quantity` 1387，相差 1，原因未确认。商品对象另有 `sku_count`、`is_goods_low_quantity`。

## 四、CLI 真实账号只读冒烟（2026-11-11 23:50 前后）

在集成分支 `feat/region-sku-stock` 上用默认账号运行，全部只读：

| 命令 | 结果 |
| --- | --- |
| `goods stock` | 退出码 0。18 件在售商品无一总库存 ≤ 10，3 件因在售规格库存 ≤ 10 进入告警（低库存规格 14 个，其中 8 个库存为 0）；`sku_id` 为字符串，`on_sale` 为布尔 |
| `orders list` | 退出码 0。20 条订单的 `province` / `city` / `district` 全部有值（如「广东省」），输出中没有收件人、手机号、地址类键 |
| `orders detail --sn` | 退出码 0。省市区为字符串，唯一命中 `receive` 的键是 `received_at` |
| `diagnose traffic --days 7` | 退出码 0。`today` 正常：23:53 抓取时 `as_of_hour` 为 `"22"`，`hourly` 23 项 |
| `diagnose experience-plan --days 7` | 首次退出码 6：经 page-api 的成功响应是 `success: true, errorCode: 0`（浏览器抓包为 `1000`），成功规则只认 `1000`。改为接受 `[0, 1000]` 后退出码 0：费率 1.11 元/单，汇总收费 209 单、补偿 23 单，列表 `total` 208 |

新事实：
- `rfreight` 模块经 page-api 返回 `errorCode: 0`，与 #1（流量接口）同类；接入新模块时成功码要同时接受 `0`
- 未发货订单的收费状态为「待收费」且 `shipped_at` 为 `null`，推断服务费在发货后才收取

## 五、《消费者体验提升计划》协议原文要点（V2.5.3）

来源：`mallInsurance/queryProtocolInfo` 返回的 `protocolHtmlLink`（公开页面，2026-11-12 读取）。只摘与报表口径相关的条款，原文措辞：

- 3.1 平台基于基础特权向商家收取服务费，同时提供基础特权和附加特权（退货包运费 / 运费补偿）
- 3.2 服务费标准由平台根据店铺历史经营情况（商品质量、售后服务等）确定，并可能随经营情况调整，以商家后台页面展示的价格为准 → 费率是平台报告值，CLI 只能原样报告，不能按规则推算
- 3.3 商家授权平台或合作方从店铺资金（保证金、活动保证金、货款等）中**直接扣除服务费和运费补偿**，具体扣费规则以页面前端显示为准
- 4.2 店铺资金不足以支付服务费或运费补偿时，视为主动退出本计划
- 5.1 **服务费一经收取不予退还**；每笔订单最多获得一次同类型补偿
- 5.2 平台可按交易历史、信用、风控策略决定具体订单是否补偿、补偿金额与形式

对 `experience-plan-fee` 03（接入 `goods profit`）的影响：
- 已收取（「收费成功」）的服务费在订单退款后**不退还**，利润计算里退款订单仍要扣这笔服务费；「待收费」订单在未发货取消时是否转为「收费取消」只有 bundle 枚举（3 = FeeCancel），没有样本
- 3.3 写明运费补偿也从店铺资金扣除。补偿究竟由商家承担还是包含在服务费里，协议没有说清；需要在资金中心 / 对账中心找到扣款流水才能确认，确认前 03 不能把补偿当作收入或成本
- 页面内「运费补偿流程」等弹窗文案在 bundle 中经过字符混淆，本次未读取

## 六、服务费费率的切换时点（CLI 真实账号只读，2026-11-12 00:30 前后）

方法：`diagnose experience-plan --days 30` 共 374 条收费记录（38 页），抽取第 1、9、11、13、15、17、19、28、38 页，按 `effective_at`（运费补偿生效时间，约等于下单时间）对照 `service_fee_yuan`。

| 日期 | 单笔服务费（元） |
| --- | --- |
| 10-22 | 1.92 |
| 10-30 | 1.99 |
| 11-06、11-07 | 1.16 |
| 11-08 | 1.12 |
| 11-09 至 11-11 | 1.11 |
| 11-12 00:27 当前费率 | 1.11 |

费率变化处的相邻记录：
- 11-07 22:01:13 为 1.16 → 11-08 02:28:07 为 1.12
- 11-08 23:29:04 为 1.12 → 11-09 01:14:40 为 1.11

结论与限度：
- 抽到的每个自然日内只有一个费率，两次变化都发生在跨零点的区间内，**与"按自然日更新"一致**；切换时刻只被夹在 22:01–02:28 与 23:29–01:14 两个区间里，**没有证据精确到 0 点**
- 单笔服务费按**生效时间（下单）当天的费率**锁定，与发货时间无关：11-08 23:29 生效、11-09 18:58 发货的订单收 1.12（11-08 费率），同批 11-09 01:14 生效的订单收 1.11
- 11-12 00:27 的费率与 11-11 相同（1.11），无法区分"0 点已更新但值未变"和"尚未更新"
- 要精确到时刻，需要在某个费率变化的日子里找到 00:00 前后几分钟内的记录，或在 0 点前后各查一次 `queryAvailableInfo`

另：`order_insurance_list` 按创建时间筛选时跨度上限为一个月，`--days 90` 返回 `运费补贴生效时间跨度不能超过一个月`；`--days` 已去掉 90。
