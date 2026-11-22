# 06: `diagnose customer-service` 增加今日实时区块

**What to build:** 在 `diagnose customer-service` 的 `data` 中新增 `today` 区块，输出今日 3 分钟人工回复率（全天分时；页面横幅注记为咨询人数统计时间范围已由原 08–23 点调整为全天）、当前待回复人数、`snapshot_at`、`as_of_hour` 及 `05` 确认可用的分时咨询序列；每个回复率值显式标注 `Reply-Rate Caliber`，独立于原有逐日趋势与 `sales` 区块。

**Blocked by:** 02, 05

**Status:** resolved

- [x] `today` 含 `snapshot_at`、回复率及显式 `Reply-Rate Caliber`、待回复人数及 `05` 确认的分时咨询数据，不与逐日趋势和 `sales` 混合
- [x] headline 新增今日实时客服行（遵循多区块 headline 约定，`today: null` 时省略）
- [x] 失败降级为 `today: null` 并写入 hint，退出码 0，原有 `summary`、`trend`、`sales` 不变
- [x] `data-contract-v2` 中 `diagnose.customer-service` 用例覆盖 `today`；合成 fixture、adapter/view/service/e2e 测试覆盖以上行为
- [x] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [x] `npm run check` 通过
- [x] 真实账号只读验证（执行前确认范围）：今日回复率、待回复人数与分时数据与后台一致；结果写入 Comments

## Comments

- 2026-11-22：原 `04-customer-service-today.md` 在拆细 `goods traffic`（03/04）与单列客服分时补测（05）后重编为 06，待 05 侦察完成后细化为 `ready-for-agent`。
- 2026-11-22：05 侦察完成（`docs/research/realtime-and-fee-recon-2026-11-11.md` 第七节），定稿接入以下三个端点并置状态为 `ready-for-agent`：
  - `cs.todayRealtime`：`GET /desert/stat/mallServiceRealTimeData`（`page-api` `method: 'GET'`，字段 `consultUserCnt`、`needReplyUserCnt`、`manuReceiveUserCnt`、`replyRate3Min`、`replyRate3MinThreshold`）
  - `cs.todayUnreply`：`GET /chats/cs/unreplyUser/count`（`page-api` `method: 'GET'`，字段 `unreply_num` → `unreply_user_count`）
  - `cs.todayHourConsult`：`POST /desert/stat/getMallHourConsultData` `{ startDate: date, endDate: date }`（`hour` 0..23 格式化为 `"00".."23"`，`replyUser3Min` / `unReplyUser3Min`）
  - `caliber` 显式标注 `'多多客服-实时数据（3 分钟人工回复率）'`；不接入 `querySpecifiedDayServiceQuality`。
- 2026-11-22：默认真实账号只读验证通过：`node bin/pdd.js diagnose customer-service --days 7 --json` 返回 `ok: true`、`exit_code: 0`、`hints: []`、`meta.warnings: []`，验证 `page-api` `GET` 实盘调用成功；`today`（`2026-11-22 04:43:26`）显式标注 `caliber: "多多客服-实时数据（3 分钟人工回复率）"`，凌晨回复率/咨询数为 `null`、`need_manual_reply_user_count: 0`、`unreply_user_count: 0`、`manual_reply_3min_threshold_pct: 50`，`hourly[]` 为 `"00".."23"` 共 24 小时，`headline` 为三行 factual 概括。`npm run check` 通过。
- 2026-11-22：双轴评审修订：为 `today` 增加 `as_of_hour` 并按 `snapshot_at` 上海小时过滤未到达的未来小时（保留 `hour <= snapshotHour`）；按 `realtime-and-fee-recon-2026-11-11.md` §7.1 横幅原话收窄 08–23 点说明至「咨询人数」口径，不再外推至回复率。
