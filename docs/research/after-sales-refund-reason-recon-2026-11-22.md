# 售后单与退款原因接口：只读实测

> 2026-11-22 17:31–17:43（Asia/Shanghai），默认商家账号。方法：通过仓库 `executeSingle`（`prepareCommandRuntime` + 账号租约 + CAS 回写，各轮均以 `ok: true`、`warnings: []` 退出）加载已保存登录态并访问商家后台相关页面，使用 `executePageApiRequest` 串行只读重放接口（请求间隔 `>= 1.35s`，全程无 429 / 54001 / 40002 限流与风控，响应均无 PUA 字符混淆）。
> 脱敏：店铺名、店铺 ID、商品 ID、商品名、订单号、售后单号、快递单号、买家及收件人信息、地址详情、图片与音视频 URL 均未记录，仅保留接口路径、参数结构、枚举字典、系统原因标签及用于核验口径与单位的样例数值；原始去敏抓包保存在会话外部临时目录（不进 Git）。

---

## 一、既有订单接口核查（`recentOrderList` / `orderDetail`）

### 1.1 `POST /mangkhut/mms/recentOrderList`

在近 90 天时间窗（`pageSize: 50`）下串行对比不同 `afterSaleType` 过滤参数：

| 过滤参数 | `totalItemNum` | 首页 `after_sales_status` 分布 | 首页 `order_status_str` 分布 | 说明 |
| --- | --- | --- | --- | --- |
| `orderType: 0, afterSaleType: 0` | 729 | `null`: 38、`5`: 6、`10`: 4、`11`: 1、`16`: 1 | 已发货，待收货 43 / 已发货，退款成功 6 / 已收货 1 | 除先前记录的 `5/10/11` 外，实测还出现 `16` |
| `orderType: 0, afterSaleType: 2` | 11 | `9`: 1、`10`: 7、`11`: 3 | 已发货，待收货 9 / 已收货 2 | 售后处理中；实测还出现 `9` |
| `orderType: 0, afterSaleType: 4` | 172 | `5`: 50 | 已发货，退款成功 50 | 与 `afterSaleType: 4` 退款筛选语义吻合 |

- 列表每条返回 139 个字段，携带 `after_sales_id`（14 位字符串）与 `after_sales_status`（数字），不包含退款原因字段。

### 1.2 `POST /mangkhut/mms/orderDetail`

以 `{ orderSn, source: "MMS" }` 抽检 `after_sales_status = 5`（退款成功）与 `after_sales_status = 10`（售后处理中）订单各 1 单：

- 详情每条返回 244 个字段，携带 `after_sales_id`、`refundId`、`afterSalesType`（样本均为 `2`）、`subAfterSalesType`（样本为 `null`）、`after_sales_status_code`（数字：`5` / `10`）、`after_sales_status`（中文状态文本，样本长度为 4 / 9 字符）、`after_sales_title`（样本 `null`）、`isFullyRefunded`（`true` / `null`）、`freight_compensate`，不包含退款原因字段。
- **现存映射缺陷**：[order.js](file:///d:/Dev/pddMerchant/src/services/views/order.js) 中的 `toOrderDetailView` 直接复用 `toOrderView` 对 `raw?.after_sales_status` 做 `AFTER_SALES_STATUS_LABEL` 查表；因 `orderDetail` 将数字码放在 `after_sales_status_code`、而 `after_sales_status` 已是中文文案，导致 `orders detail` 对存在售后的订单会回退输出 `未知(<中文文案>)`。

---

## 二、售后工作台接口（`/aftersales/aftersale_list` → `/mercury/mms/afterSales/*`）

通过 `executePageApiRequest` 实测确认：`POST /mercury/mms/afterSales/queryParams` 与 `POST /mercury/mms/afterSales/queryList` 均可在 `PDD_HOME`（`https://mms.pinduoduo.com/home/`）页面直接调用并返回 `200`（`success: true, errorCode: 0, puaCount: 0`），无需预先跳转售后工作台页面。

### 2.1 `POST /mercury/mms/afterSales/queryParams`（枚举与筛选字典）

空对象 `{}` 请求即可返回完整筛选字典：

- **`afterSalesTypeParams`**：`退款: 1`、`退款退货: 2`、`换货: 3`、`补寄: 4`、`维修: 5`
- **`afterSalesStatusParams`**：
  - `进行中售后单`: `[2, 3, 4, 11, 18, 27, 31]`
  - `待商家处理`: `[1, 14, 21, 32]`
  - `待商家收货`: `[11]`
  - `待消费者发货`: `[9, 10, 15, 22]`
  - `平台处理中`: `[2, 3, 7]`
  - `退款成功`: `[5]`
  - `退款关闭`: `[6, 12]`
  - `换货/补寄成功`: `[16]`
  - `换货/补寄关闭`: `[17]`
  - `维修成功`: `[25]`
  - `维修关闭`: `[24]`
- **`reasonCodeParams`**（7 大类及所含编码数）：`七天无理由退货`（8）、`其他原因`（38）、`质量问题`（127）、`商品描述不符`（66）、`发货履约原因`（27）、`少件`（15）、`疑似假货`（4）。
- **其他辅助字典**：`sellerAfterSalesShippingParams`（`未发货: 0`、`已发货: 1`）、`operateTypeParams`（`商家同意退款: 1`、`平台同意退款: 2`、`商家同意退货: 3`、`平台同意退货: 4`）、`logisticsRecallStatusParams`（拦截状态编码 `2–7`）。

### 2.2 `POST /mercury/mms/afterSales/queryList`（核心列表与逐单原因接口）

#### 请求参数实测对照

从页面源码（`main.*.js`）提取筛选序列化逻辑后，经线上只读重放逐项验证：

| 参数字段 | 实测传参形态 | 实测结果与边界 | 误用对照 |
| --- | --- | --- | --- |
| `pageNumber`, `pageSize` | `1`, `100` | 实测 `pageSize: 100` 正常返回 100 条、`errorCode: 0` | — |
| `orderByCreatedAtDesc` | `true` | 按售后申请时间倒序返回 | — |
| `startCreatedTime`, `endCreatedTime` | Unix 秒 | 近 7 天 `34` 条；近 90 天 `194` 条；不传则返回全量 `1583` 条 | 误传 `beginTime`/`endTime` 会被静默忽略，仍返回全量 `1583` |
| `searchText` | 字符串（单号 / 商品 ID 等） | 传单个 `order_sn` 返回 `total: 1` 且与原单号/金额吻合；传 `goods_id` 返回 `total: 179` | 误传 `orderSn`/`goodsId` 会被静默忽略 |
| `afterSalesStatusList` | 数字（或数字串）数组，如 `[5]` | 返回 `total: 1469`，抽检 `20/20` 均为状态 `5` | 误传 `statusList` 会被静默忽略 |
| `afterSalesType` | 标量整数，如 `1`、`2` | 2026-11-22 补测：不传时 `total: 1584`，首页含类型 `1`、`2`。传 `1`（退款）返回 `total: 895`，首页仅含类型 `1`；传 `2`（退货退款）返回 `total: 678`，首页 20 条均为类型 `2`。两次过滤均为 HTTP 200、`success: true` | `[2]` 返回 HTTP 400、`errorCode: 3000000`（参数校验失败）；`afterSalesTypeList: [2]` 被静默忽略，仍为 `total: 1584` |
| `reasonCodeList` | 数字（或数字串）数组，如 `[81]` | 返回 `total: 36`，抽检 `20/20` 均为原因码 `81` | — |
| `quickSearchType` | 页面快捷胶囊枚举（如 `8`、`18`） | 工作台初加载默认传 `quickSearchType: 18`（本账号此时返回 0 条）；不传时查全量 | — |

页面表单源码还支持 `minRefundAmount` / `maxRefundAmount`（分）、`speedRefund`（布尔）、`disputeRefund`（布尔）、`logisticsRecallStatusList`、`merchantAppeal`、`adminJoinWaitMerchantHandle`。CLI 的 `--type` 按 §2.1 字典传递标量整数 `afterSalesType`，`--type all` 省略该字段。

#### 返回条目（`result.list[]`）字段与单位核验

- **核心业务字段**：
  - 标识与商品：`id`（售后单号，number）、`orderSn`、`goodsName`、`goodsSpec`、`goodsNumber`（注：列表项本身不含 `goodsId`，需由检索条件或关联订单获取）
  - 类型与状态：`afterSalesType`、`afterSalesTypeName`（如「退货退款」「未发货退款」「退款」「换货」）、`afterSalesStatus`、`afterSalesTitle`（状态展示标题）、`sellerAfterSalesShippingStatus`、`sellerAfterSalesShippingStatusDesc`（如「已发货」「未发货」）
  - 售后原因：`afterSalesReasonCode`（number）、`afterSalesReasonDesc`（系统原因文案，如「不想要了」「尺码没选对」「质量问题」）
  - 金额（均为整数**分**）：`refundAmount`、`orderAmount`（买家实付）、`receiveAmount`（商家实收）、`returnCouponAmount`、`platformDiscount`
  - 时间与退货物流：`createdAt`（Unix 秒）、`closeTime`（Unix 秒，未关闭为 `0`）、`reverseTrackingNumber`（无单号为空字符串）、`reverseShippingId`
- **单位与口径验证**：
  - 以单号精确对照 `recentOrderList` 与 `queryList`：两处 `order_amount` / `orderAmount` 均为 `1778` 分（17.78 元），`receiveAmount: 1778`，`refundAmount: 1778`。
  - 存在平台补贴的样本中，`orderAmount: 1478` + `platformDiscount: 300` = `receiveAmount: 1778` = `refundAmount: 1778`，确认金额字段统一为整数分且 `receiveAmount` 含平台出资优惠。
- **需剔除/敏感字段**：`thumbUrl`、`mallRemark`、`mallRemarkTag`、`mallRemarkTagName`、`uid`、`returnAddressId`、`recommendReturnAddressId`、`actions`、`expireActionDesc`、`expireRemainTime` 等隐私、商家内部备注或交互字段不进入 CLI 视图。

#### 50 条全量售后单样本原因分布观察

无快捷筛选全量首页 50 条（涵盖 `afterSalesStatus` 5/6/9/10/11/16 与退款/退货退款/换货类型）中观察到的原因码与大类对照：

| `afterSalesReasonCode` | `queryParams.reasonCodeParams` 大类 | `afterSalesReasonDesc` | 样本频次（50 条中） |
| --- | --- | --- | --- |
| `88` | 七天无理由退货 | 不想要了 | 22 |
| `405030` | 未收录 | 尺码没选对 | 14 |
| `81` | 质量问题 | 质量问题 | 4 |
| `95` | 其他原因 | 其他原因 | 3 |
| `79` | 其他原因 | 其他原因 | 3 |
| `111` | 其他原因 | 其他原因 | 1 |
| `196` | 发货履约原因 | 快递一直未送达 | 1 |
| `66` | 七天无理由退货 | 不想要了 | 1 |
| `197` | 七天无理由退货 | 不想要了 | 1 |

实测确认两项关键现象：
1. **多原因码对应同一文案**：如 `88`/`66`/`197` 均展示为「不想要了」，`95`/`79`/`111` 均展示为「其他原因」。
2. **大类字典非完备**：高频原因码 `405030`（「尺码没选对」，50 单中占 14 单）未包含在 `queryParams.reasonCodeParams` 的 7 大类列表中。

---

## 三、售后详情页 SSR 结构对照（`/aftersales-ssr/detail`）

访问 `/aftersales/aftersale_detail?id=<id>&orderSn=<sn>` 会渲染为 Next.js SSR 页面 `/aftersales-ssr/detail`，页面主体信息并非来自独立 JSON 详情 API，而是直接注入在 `#__NEXT_DATA__` 中（`props.pageProps.mmsNodeData.aftersaleDetail`）。

- **客户端辅助 XHR**（均明文、`pua = 0`，在 `PDD_HOME` 也可通过 `executePageApiRequest` 调用）：
  - `/mercury/merchant/afterSales/mergeInfo`（合单信息）
  - `/mercury/appeal/detail/aftersalesid`（申诉记录）
  - `/mercury/fullback/info`（追回/退款金额明细）
  - `/mercury/appeal/checkAppeal`（可申诉校验与申诉原因树）
  - `/mangkhut/mms/orderDetail`、`/fopen/order/detail`（订单与脱敏收件信息）
- **SSR 相对 `queryList` 新增的字段**：`questionType`、`questionDesc`、`questionRemarks`（买家补充备注，本样本为 `null`）、`goodsProblemDesc`、`qualityReasonRefund`（布尔）、`isNoReason`（布尔）、`speedRefund`（布尔）、`afterSalesFlows[]`（协商节点时间线）、`goodsId` 以及 `afterSaleReason.questionsMap`（335 项原因字典）。同时页面负载包含收件人、退货地址、聊天与售后图片 URL 等大量 PII，且需逐单整页导航读取。

---

## 四、数据中心与周边接口（明文，留作独立议题）

以下接口均已实测验证可在无额外混淆的前提下获取，但不纳入本次售后单与退款原因首期实现：

| 入口 / 路径 | 实测接口 | 返回内容 | 与本次需求关系 |
| --- | --- | --- | --- |
| 数据中心 → 售后数据（`/sycm/goods_quality/detail`） | `POST /sydney/api/saleQuality/getReadyDate`<br>`POST /sydney/api/saleQuality/querySaleQualityDetailInfo`<br>`POST /sydney/api/saleQuality/querySaleQualityList`<br>`POST /sydney/api/saleQuality/querySaleQualityTopGoodsDetailList` | 均可在 `PDD_HOME` 经 `page-api` 调用；返回店铺与高退款商品维度的成功退款数/金额、品质退款数/率（`qurfOrdCnt1m`/`qurfOrdRto1m`）、纠纷退款数/率、平台介入数/率及平均退款时长 | 仅提供平台宏观测算指标，无细分退款原因明细；适合作为 `diagnose after-sales` 后续扩展 |
| 售后工作台 → 降商品售后工具 | `GET /api/colombo/rectification/list`<br>`POST /api/colombo/rectification/listv2` | 仅覆盖触发平台预警的商品，提供 `problemLabel`（如「材质描述不符」）、`baseInfo` 与 `adviseInfo` | 仅针对平台主动下发整改的单品，不覆盖全部售后单 |
| 品质诊断（`/pg/mall_quality`） | `POST /genji/warlock/mallQualityAnalysis/queryMallInfo`<br>`POST /genji/warlock/mallQualityAnalysis/queryGoodsInfo`<br>`POST /whistle/alarm/queryMallAlarm` | 店铺品质预警、差评率、负向反馈率及商品违规统计 | 偏向品质违规监控，非逐单退款原因 |
| 售后申诉（`/orders/appeals/aftersale/order`） | `POST /auncel/mms/appeal/queryCanAppealInfoList` | 含 `reasonCode` / `reasonDesc`、`refundAmount`、`receiveAmount`、`canCargoAppealAmount` | 仅覆盖可申诉订单子集（如极速退款申诉、维权申诉） |
