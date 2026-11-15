# 03: `goods profit` 的运费险改用平台实际收取的服务费

**What to build:** `goods profit` 计算成本时，运费险（`insurance_yuan`）不再取商家手填的每单固定值，改为取消费者体验提升计划收费记录里该订单实际的服务费（按订单号对齐）。商品级和全店汇总的运费险、商家成本、毛利、净利随之变化。先更新 ADR 0004。上游接口与事实依据：`docs/research/realtime-and-fee-recon-2026-11-11.md` 第二、五、六节。

**Blocked by:** 02

**Status:** resolved

决定（2026-11-15，用户确认）：
- 收费记录拉全时，订单在记录中找不到 → 运费险记 0（平台未收，例如开通计划之前的订单）
- 手填的 `insurance_yuan` 完全去掉（本工单先停止读取，删除输入输出见 04）
- 收费记录请求用 `pageSize: 100`（2026-11-15 真实账号只读实测 50 / 100 均可用，近 30 天 460 条 5 次请求）

采集：
- 复用 `experiencePlan.orderInsuranceList`：`queryFeeStatusList: [1, 2]`，按创建时间筛选；`pageSize` 改为 100
- 时间范围覆盖利润窗口：`createBeginTime` = 窗口起点前 1 天（订单先创建后成团），`createEndTime` = 窗口终点；单次查询跨度 ≤ 30 天（上游「跨度不能超过一个月」），超出时按段拆分
- 每段翻页直到取满 `total`；设页数上限，触顶记为截断
- 平台只保留近 180 天记录；利润窗口最长 90 天，在范围内

逐单规则（服务费是平台报告值，不按费率重算）：
- 记录「收费成功」：计入该笔服务费，**订单退款也不扣回**（协议 5.1「服务费一经收取将不予退还」）
- 记录「待收费」：订单未退款、未取消时计入；退款或未付款取消时记 0
- 无记录：记 0（仅在收费记录拉全时）
- 未付款取消的订单：0（与现有规则一致）
- 金额对象只认 `unit: "YUAN"`，按字符串精确转分；其他单位该单记 `null` 并写 `meta.warnings`

失败与完整性（与推广费一致）：
- 收费记录拉取失败或被截断：运费险、商家成本、毛利、净利为 `null`，写入 hint，退出码不变
- `summary.data_quality` 增加 `insurance_complete`、`insurance_truncated`

- [x] ADR 0004 的 Costs 一节写明运费险来源、退款不扣回、无记录记 0、拉取失败为 null
- [x] fixture 模式下 `goods profit` 的 `insurance_yuan` 等于对应订单收费记录金额之和；手填 `insurance_yuan` 不再影响结果
- [x] 退款订单：收费成功的服务费仍计入；待收费的记 0
- [x] 无记录订单记 0；收费记录为空列表时全部为 0
- [x] 收费记录接口失败 / 截断时相关金额为 `null`、出现 hint、`data_quality` 标记正确，退出码 0
- [x] 窗口超过 30 天时请求按段拆分，每段 ≤ 30 天（测试断言请求体）
- [x] 非 YUAN 金额该单为 `null` 并有 warning
- [x] `diagnose experience-plan` 的输出不受 `pageSize` 改动影响（仍每页 10 条展示，或改为 100 条并同步文档，二选一并说明）
- [x] `skills/pdd-cli/reports.md`、`domain-service-contracts.md` 的 goods profit 口径同步；CHANGELOG 记录
- [x] `npm test` 通过

## Comments

- 2026-11-11：创建（needs-triage）。
- 2026-11-15：按用户决定重写为 ready-for-agent。运费补偿（`compensation_list`）由平台承担、不是商家成本，不计入利润（用户确认）。
- 2026-11-15：已合入 feat/auto-insurance-fee（5830f5f）。真实账号冒烟：收费记录采集完整（insurance_complete: true），但订单采集 0 单，原因见 05。diagnose experience-plan 改为每页 100 条。
