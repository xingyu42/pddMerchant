# 02: 只读查询消费者体验提升计划服务费

**What to build:** 新增只读命令 `pdd diagnose experience-plan`，原样报告消费者体验提升计划的状态、当日服务费费率、窗口内收费订单数与运费补偿订单数，以及逐单收费记录（订单号、服务费、收费状态、运费补偿状态、生效时间、发货时间）。所有数值是平台报告值，CLI 不按费率重算。上游接口、请求体和字段以 `docs/research/realtime-and-fee-recon-2026-11-11.md` 第二节为准。

**Blocked by:** 01

**Status:** resolved

上游（page-api，导航页 `https://mms.pinduoduo.com/freight/return_freight`；成功判定为 `success === true` 且 `errorCode === 1000`，注意不是 `1000000`）：
- `/mms-gateway/rfreight/mall_insurance_status`（`{}`）：`configStatus`
- `/mms-gateway/rfreight/mallInsurance/queryAvailableInfo`（`{}`）：`normalService.algoDailyStrategy.price`
- `/mms-gateway/rfreight/postpaid/profits`（`{ farDate: days-1, closerDate: 0 }`）：`orderCount`、`compensationCount`
- `/mms-gateway/rfreight/postpaid/order_insurance_list`（`{ pageSize: 10, pageNumber: page-1, clientType: 1, shippingBeginTime, shippingEndTime }`，毫秒）：`total`、`orderInsurances[]`

同模块的写接口（`close_service`、`pause_service`、`openService`、`refreshServiceStatus`）一律不接入。

命令与输出：
- 选项：`--days`（1 / 7 / 30 / 90，默认 7，parse 阶段校验）、`--page`（默认 1）。列表每页 10 条，与上游一致
- `data`：`headline`、`window`（`days`、`start_at`、`end_at`）、`plan_status`（`configStatus` 原值，无标签证据时输出原值并在字段说明标注）、`today_fee_per_order_yuan`、`charged_order_count`、`compensated_order_count`、`items`、`total`、`page`
- `items[]`：`order_sn`、`service_fee_yuan`（`serviceAmountVO`）、`fee_status`（上游 `feeStatusDesc` 原文）、`service_status`（`displayStatus` 1 = 生效中、2 = 已失效、3 = 已补偿运费，未登记码 `未知(<code>)`）、`effective_at`、`shipped_at`、`is_free`
- 金额对象 `{ unit: "YUAN", value: "<字符串>" }`：`unit` 为 `YUAN` 时按字符串精确转元；其他 unit 输出 `null` 并写 `meta.warnings`
- 收费编号 `batchSn`、`sn`、`mallId`、`uid` 不进入 `data`

- [x] fixture 模式下命令输出上述字段，金额、时间（`_at`，Asia/Shanghai）、标签正确
- [x] 汇总计数与列表 `total` 分别原样输出，不互相校正；字段说明注明两者口径可能不同
- [x] `configStatus` 表示未开通或列表为空时给事实性 headline，退出码 0（未开通的取值没有样本：以"列表为空 + 汇总为 0"作为 fixture 场景，`configStatus` 原样输出）
- [x] 非 `YUAN` 金额输出 `null` 并有 warning
- [x] 上游业务错误退出码 6，提示为上游原文
- [x] 注册到 diagnose registrar；`data-contract-v2` 新增 case；`skills/pdd-cli/SKILL.md` 补一行
- [x] 每个新 endpoint spec 有 fixture 合同测试；e2e 用合成 fixture，订单号为合成值
- [x] `npm test` 通过

## Comments

- 2026-11-11：按浏览器侦察结论细化为 ready-for-agent。运费补偿列表 `compensation_list` 不在本工单范围（与 03 一起评估）。
- 2026-11-11：已在集成分支 feat/region-sku-stock 完成（ce6ba08）。待评审：列表请求未带 queryFeeStatusList；未输出 mall_id；data 额外带 hints。
- 2026-11-11（评审修正）：列表请求改为页面默认参数 `queryFeeStatusList: [1, 2]` + `createBeginTime` / `createEndTime`（上文的 `shippingBeginTime` / `shippingEndTime` 作废，依据见 recon 文档第二节「页面默认参数」）；`data` 增加 `mall_id`；`hints` 保留（`count_caliber` 口径提示）；`plan_status` 原值例外写入 domain-service-contracts。
