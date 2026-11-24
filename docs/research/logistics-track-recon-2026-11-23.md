# 正向与退回物流轨迹接口：只读实测

> 2026-11-23 14:43–14:52（Asia/Shanghai），默认商家账号。方法：通过仓库 `executeSingle`（`prepareCommandRuntime` + 账号租约 + CAS 回写，各轮均以 `ok: true`、`warnings: []` 退出）加载已保存登录态并访问商家后台页面，挂载网络监听器捕获取样，并在 `PDD_HOME`（`https://mms.pinduoduo.com`）使用 `executePageApiRequest` 串行只读重放接口（操作间隔 `>= 1.6s`，全程无 `429` / `54001` / `40002` 限流与风控，业务响应 `puaCount: 0`）。
> 脱敏：店铺名、店铺 ID、商品 ID、商品名、订单号、售后单号、运单号、买家及收件人信息、快递员姓名与电话、详细地址及网点地名、图片与音视频 URL 均已剔除或占位替换，仅保留接口路径、参数结构、枚举字典、时间戳单位及匿名化样本时效对照；原始抓包与辅助脚本保存在会话外部临时目录（不进 Git）。

---

## 一、既有接口字段核查

### 1.1 `POST /mercury/mms/afterSales/queryList`

在 `afterSalesType: 2`（退货退款）分页采样的 200 条记录中，列表条目共包含 54 个顶层字段，其中与时间和物流相关的字段仅包括：

- 时间：`createdAt`（10 位 Unix 秒）、`closeTime`（未关闭为 `0`；实测同时出现 10 位 Unix 秒与 13 位 Unix 毫秒，如 `1795338953` 与 `1795401336780`，`src/infra/units.js` 的 `toLocalDateTime` 均兼容）、`expireRemainTime`（剩余秒数，已关闭为空或 `0`）
- 商家发货与退货单号：`sellerAfterSalesShippingStatus`（`0` / `1`）、`sellerAfterSalesShippingStatusDesc`、`reverseTrackingNumber`、`reverseShippingId`、`orderTrackingNumber`、`orderShippingId`、`secondaryTrackingNumber`、`secondaryShippingId`（常规单后四项为 `null`）

`queryList` 返回条目**不包含**正向签收时间、退回签收/到货时间或物流节点轨迹数组。

### 1.2 `POST /mangkhut/mms/orderDetail`

以 `{ orderSn, source: "MMS" }` 抽检 6 条退货退款售后单与 1 条普通已收货对照订单，核验时间与物流相关字段：

- 核心时间：`order_time`、`pay_time`、`group_time`、`confirm_time`、`promise_shipping_time`、`shipping_time`、`receive_time`（均为 10 位 Unix 秒，`0` 表示未发生）。
- 物流基础信息：`shipping_id`、`shipping_name`、`tracking_number`、`shipping_status`、`expressGotStatus`、`logisticsConsoOutBoundTraceInfo`（常规单为 `null`）。
- **关键口径实测**：在抽检的 6 条 `afterSalesType = 2` 退货退款订单中（含已完成退款与待收货状态），**近期 5 条的 `orderDetail.receive_time` 均为 `0`**，仅 1 条 2026-02 历史单（系统自动确认收货 4 天后才发起售后）为非零时间戳。原因是买家在签收快递后、订单自动或手动确认收货之前直接发起退货退款，订单级 `receive_time` 保持为 `0`。

---

## 二、正向物流轨迹实测接口

在订单详情页（`/orders/detail?sn=<orderSn>`）与售后详情页（`/aftersales/aftersale_detail?id=<id>&orderSn=<orderSn>`）捕获到两个正向轨迹查询接口，均可在 `PDD_HOME` 直接经 `executePageApiRequest` 串行调用，无需跳转子页面，且响应 `puaCount: 0`。

### 2.1 首选：`POST /artascope/express/track/query`

- **页面来源**：`/orders/detail` 首屏加载触发。
- **请求体**：
  ```json
  {
    "orderSn": "<order_sn>",
    "source": "mms_order_detail",
    "filterInvalidDefaultTrace": true
  }
  ```
  - 参数边界实测：`source` 必填。仅传 `{ orderSn }` 时接口返回 HTTP 200、`success: true`、`result: null`；传 `source: "mms_order_detail"`、`"mms_after_sales_detail"` 或 `"MMS"` 均可正常返回结果。额外传入 `trackingNumber` / `shippingId` 时仍返回正向物流。
- **返回结构**（`result`）：
  - `orderSn`（string）、`inbound`（boolean）、`queryAgain`（boolean）
  - `wideGotTime`（`"YYYY-MM-DD HH:mm:ss"` 字符串，揽收时间；历史久远订单可能缺失该键）
  - `waybillList[]`：`{ shippingId, shippingName, trackingNumber, shippingPhone }`
  - `traceList[]`（按时间倒序排列）：`{ time, status, info }`
    - `time`：`"YYYY-MM-DD HH:mm:ss"`（Asia/Shanghai）
    - 实测观测到的 `status` 枚举：`""`（商家已发货通知取件）、`GOT`（已揽收）、`DEPARTURE`（发出）、`ARRIVAL`（到达）、`SEND`（派件中）、`IN_CABINET`（入柜 / 到达代收点）、`OUT_CABINET`（取件 / 领取）、`SIGN`（已投递 / 签收）
    - `info`：明文轨迹文案（`puaCount: 0`，内含网点、派件员及电话等 PII）
- **历史留存限制**：2026-11 近期订单返回完整 10–11 个节点；2025-12 与 2026-02 的陈旧历史订单仅返回 1 条 `"商家已发货，正在通知…取件"` 记录（上游快递公司轨迹已过期清理）。

### 2.2 备选：`GET /express_base/mms/track/get`

- **页面来源**：`/aftersales-ssr/detail` 首屏加载触发。
- **请求方式**：`GET /express_base/mms/track/get?orderSn=<order_sn>&source=MMS_TRACK_STATUS`（必须在 URL 查询串传 `orderSn` 与 `source`；缺少时返回 HTTP 400、`errorCode: 999903` `"缺少servlet请求参数"`；追加 `trackingNumber` / `shippingId` 仍返回正向包裹）。
- **返回结构**（`result`）：
  - `shipping_id`、`shipping_name`、`tracking_number`、`phone`、`shipping_status`、`address`、`title`
  - `traces[]`（按时间倒序）：`{ info, time, status, subStatus, postmanContact }`
  - 节点状态差异：仅终态或派件节点较稳定填充 `status`（如 `SIGN`、`SEND`）或 `subStatus`（实测见 `IN_CABINET_401`、`OUT_CABINET_501`），中间揽收/到达/发出节点 `status` 多为空字符串 `""`。

---

## 三、退回（逆向）物流轨迹实测接口

### 3.1 首选纯 JSON `page-api`：`GET /express_base/mms/track/sale_back`

从 `/aftersales-ssr/detail` 前端脚本（`aftersales-ssr/detail.js` 与 `commons.*.mms-aftersales-ssr.js`）提取并实测验证的逆向轨迹专用接口，可直接在 `PDD_HOME` 通过 `executePageApiRequest` 调用，HTTP 200、`success: true`、`error_code: "0"`、`puaCount: 0`。

- **请求方式与参数**：
  - `GET /express_base/mms/track/sale_back?shippingId=<reverseShippingId>&trackingNumber=<reverseTrackingNumber>`
  - 两个必需参数均直接来自现有 `POST /mercury/mms/afterSales/queryList` 返回字段（`reverseShippingId` 与 `reverseTrackingNumber`），无需先访问详情页。
  - **严格参数约束**：必须使用 `GET` 与 camelCase 参数名；改用 snake_case（`tracking_number` / `shipping_id`）或仅传 `afterSalesId` + `orderSn` 返回 HTTP 400、`errorCode: 999903`（缺少 servlet 请求参数）；改用 `POST` 返回 HTTP 405、`errorCode: 999909`（不支持的 HTTP 请求方法）。
- **返回结构**（`result`）：
  - 顶层：`shipping_id`、`shipping_name`、`tracking_number`、`phone`、`shipping_status`、`address`、`traces[]`（按时间倒序）
  - `traces[]` 单条：`{ info, time, status, statusTag, subStatus, clearance_desc, postman_name, postman_contact, district, city, province, cb, pc, address, detections }`
- **实测边界（关键差异）**：
  - `sale_back` 对部分快递公司返回的 `traces[].status` 存在空字符串情况。例如实测中 `shippingId: 1`（申通）的「已揽收」节点、`shippingId: 118`（邮政 EMS）的「已到达」「已代收」节点，`status` 均为 `""`、`subStatus` 为 `null`（仅 `SEND` 节点非空）。
  - 因此若基于 `sale_back` 判定退回包裹「已到货 / 已签收」，需要**`status` 枚举与 `info` 文案联合匹配**，不能只依赖 `status` 字段。

### 3.2 参考数据源：`/aftersales-ssr/detail` SSR 注入字段

访问 `/aftersales/aftersale_detail?id=<id>&orderSn=<orderSn>` 时，服务端会在 `#__NEXT_DATA__`（`props.pageProps.mmsNodeData.aftersaleDetail`）直接注入逆向物流对象（仅作为前端逻辑与字段对照参考，不推荐作为批量采集主路径）：

- 关键字段：`userReverseShippingHasTrace`（boolean）、`speedRefund`（boolean）、`speedRefundStatus`（number，`0` 为普通退货、`3` 为极速退款）、`reverseShippingTrackInfo`（`{ shippingId, shippingName, trackingNumber, shippingTime, shippingTraces[] }`）、`reverseShippingTrackSegInfo`（`{ completeShippingTrackSegCnt, firstShippingTrackInfoVO, secondShippingTrackInfoVO }`，用于两段/换单退货场景）。
- 前端判定规则：实测从 `aftersales-ssr/detail.js` 观测到，平台前端将逆向轨迹首节点 `status` 落入 `["SIGN", "SIGN_ON_BEHALF", "OUT_CABINET"]` 判定为退回已签收。
- 与 `sale_back` 互补：`aftersale_detail` SSR 对韵达/圆通/中通/申通的 `shippingTraces[].status` 会归一化为 `GOT` / `DEPARTURE` / `ARRIVAL` / `SEND` / `SIGN`，且历史久远订单（如 2026-02）仍在 `reverseShippingTrackInfo` 中保留完整 11 个逆向节点；缺点是需逐单整页导航且负载包含收件人、退货地址与音视频 URL 等大量 PII。

---

## 四、PII 与敏感字段排除清单

接入视图层时须严格按白名单投影，以下字段不得进入 CLI 输出与日志：

- 快递与联系方式：`waybillList[].shippingPhone`、`phone`、`receivingPhone`、`postmanContact`、`postman_contact`、`postman_name`
- 地址与站点细粒度文本：`address`、`district`、`city`、`province`；`traces[].info`（或 `traceList[].info`）中的快递员姓名、电话号码、签收人姓名及详细门牌/驿站地址（如必须输出可读轨迹，应先做脱敏或仅输出结构化时间与状态）
- 售后详情补充字段：`afterSalesFlows[].info` 中的退货收件人、电话、退货地址及买家上传图片/视频 URL

---

## 五、时间口径与匿名样本天数对照

下表汇总 5 个匿名退货退款样本（均含 `reverseTrackingNumber`）的实测关键时间节点（均为 `Asia/Shanghai`）：

| 样本 | 类型与状态 | 订单 `shipping_time` | 正向签收/取件（轨迹） | 订单 `receive_time` | 售后 `createdAt` | 退回揽收 `GOT` | 退回到货/签收（轨迹） | 售后 `closeTime` | 正向收货 → 退回签收（天） | 正向收货 → `closeTime`（天） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `R1` | 历史单（`status=5`，超时自动退款） | 2026-02-08 16:14:16 | 无（历史轨迹已过期） | 2026-02-18 16:14:16 | 2026-02-22 08:38:42 | 2026-02-22 18:33:07 | 2026-02-24 18:13:01 (`SIGN`) | 2026-03-09 09:01:13 | `6.00`（按 `receive_time` 计） | `18.70` |
| `T1` | 近期正常退货（`status=5`，`speedRefundStatus=0`） | 2026-11-17 16:55:33 | 2026-11-19 12:42:52 (`OUT_CABINET`) | `null` (`0`) | 2026-11-19 15:27:54 | 2026-11-19 15:58:21 | 2026-11-20 22:58:08 (`SIGN`) | 2026-11-21 22:58:42 | **`1.43`** | `2.43` |
| `T2` | 近期正常退货（`status=5`，`speedRefundStatus=0`） | 2026-11-16 16:37:00 | 2026-11-17 20:44:05 (`SIGN`) | `null` (`0`) | 2026-11-19 01:38:07 | 2026-11-19 20:47:33 | 2026-11-20 21:55:55 (`SIGN`) | 2026-11-21 13:40:55 | **`3.05`** | `3.71` |
| `T3` | 近期极速退款（`status=5`，`speedRefundStatus=3`） | 2026-11-16 16:37:00 | 2026-11-17 13:36:30 (`SIGN`) | `null` (`0`) | 2026-11-18 22:41:56 | 2026-11-23 03:27:47 | 尚未签收（在途 `DEPARTURE`） | 2026-11-23 03:28:04 | `null` | `5.58` |
| `T4` | 近期极速退款（`status=5`，`speedRefundStatus=3`） | 2026-11-19 16:37:53 | 2026-11-20 19:51:07 (`SIGN`) | `null` (`0`) | 2026-11-22 17:15:53 | 2026-11-23 10:35:25 | 尚未签收（刚揽收 `GOT`） | 2026-11-23 10:35:36 | `null` | `2.61` |

*注：`T1` 另有正向入柜时间 `IN_CABINET` 为 `2026-11-18 09:18:17`（买家次日取件）；`R4`（`status=11` 待商家收货）在同轮中也呈现正向 `SIGN` 有时间而 `orderDetail.receive_time = 0` 的相同现象。*

### 口径结论

1. **「收货时间」取数**：常规退货退款单的 `orderDetail.receive_time` 几乎总是 `0`（仅自动确认收货后才申请售后的少数订单非零）。准确的买家收货时间应优先取正向物流轨迹的终态到达/签收时间（`SIGN` / `SIGN_ON_BEHALF` / `OUT_CABINET`，若仅入代收点未取可按口径决定是否回退 `IN_CABINET`），并可保留 `orderDetail.receive_time` 作为对照或过期兜底字段。
2. **「退回物流到货时间」取数**：退回物流到货时间必须取逆向轨迹终态时间（`SIGN` / `SIGN_ON_BEHALF` / `OUT_CABINET` 或代收/到达门店内对应文案）。`afterSales.closeTime` 偏差较大：极速退款场景（`T3`/`T4`）在快递揽收后十余秒即关闭退款，包裹实际尚未寄回；商家延后处理场景（`R1`/`T1`/`T2`）`closeTime` 晚于退回签收 0.66–13 天。
3. **跨度可算性**：对于近期的已完成退货单（如 `T1`/`T2`），可同时通过两个纯 JSON `page-api`（`artascope` 正向 + `sale_back` 逆向）算出精确到小时/天的「正向签收 → 退回签收」间隔天数；若历史太久导致正向轨迹已被快递清理（`R1`）或极速退款包裹尚在途（`T3`/`T4`），对应时间差应显式输出 `null` 并注明原因。

---

## 六、后续接入 `pdd-cli` 可行方案

如需在 `pdd-cli` 中直接查看物流轨迹并输出退回时效天数，建议采用纯 `page-api` 方案（均在 `PDD_HOME` 执行，无需页面导航或 SSR 抓取）：

1. **新增或扩展逐单查询命令**：
   - 方案 A：扩展 `pdd orders detail --sn <sn>` 增加可选参数（如 `--with-track`），或新增 `pdd orders track --sn <sn>`：
     - 调用 `POST /artascope/express/track/query` 获取正向轨迹与 `forward_delivered_at`。
     - 若订单存在售后单（或从 `afterSales/queryList` 读取 `reverseShippingId` + `reverseTrackingNumber`），再调用 `GET /express_base/mms/track/sale_back` 获取退回轨迹与 `reverse_delivered_at`。
     - 视图层计算并输出 `forward_delivered_at`、`reverse_delivered_at` 与 `return_transit_days`（正向签收到退回签收天数），同时支持 `--raw-traces` 或精简轨迹节点（仅保留 `time`、`status`、脱敏摘要，剔除派件员姓名/电话/地址）。
   - 方案 B：在 `pdd orders after-sales` 增加可选轨迹富化模式（受 `EndpointClient` 限流保护控制，建议默认关闭或限定单页/小批量使用，因为每条退货单需额外发起 2 次接口请求：`artascope` 正向 + `sale_back` 逆向）。
2. **状态归一化设计**：
   - 将 `sale_back` 与 `artascope` 节点做统一投影，建立双层签收判定：优先检查 `status`（`SIGN`、`SIGN_ON_BEHALF`、`OUT_CABINET`），当 `sale_back` 返回 `status: ""` 时再结合 `info` 关键字（如「已签收」「已投递」「已代收」「已领取」）补充识别，并在文档与 ADR 中显式标明该口径。
