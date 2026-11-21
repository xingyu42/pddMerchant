# 05: 补测客服今日分时与指定日接口参数

**What to build:** 只读实测 `01` 遗留的两个客服接口（`/desert/stat/getMallHourConsultData`、`/sydney/api/customer/querySpecifiedDayServiceQuality`）传入今天日期的请求参数、响应结构与口径归属，并复核实时回复率与待回复人数接口形态，结论脱敏回写 `docs/research/realtime-and-fee-recon-2026-11-11.md`，为 06 定稿字段与 `Reply-Rate Caliber`。需要真实账号只读访问，执行前确认范围。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 确认 `getMallHourConsultData` 传今天的请求体、是否返回当日分时数据、完整字段与空值形态
- [x] 确认 `querySpecifiedDayServiceQuality` 传今天的可用性、`Reply-Rate Caliber` 与是否出现私有区混淆字符
- [x] 复核 `mallServiceRealTimeData` 与 `unreplyUser/count` 响应外壳、空值形态及页面口径文案
- [x] 结论脱敏写入 `docs/research/realtime-and-fee-recon-2026-11-11.md`（不含店铺 ID、客服账号名、买家信息）并明确 06 的字段与口径建议

## Comments

- 2026-11-22：真实账号只读实测完成，结论已写入 `docs/research/realtime-and-fee-recon-2026-11-11.md` 第七节：
  - `GET /desert/stat/mallServiceRealTimeData` 与 `GET /chats/cs/unreplyUser/count` 为明文 `errorCode: 1000000`，凌晨无咨询时 `consultUserCnt` / `replyRate3Min` / `manuReceiveUserCnt` 为 `null`、`needReplyUserCnt: 0`、`unreply_num: 0`、`replyRate3MinThreshold: 0.5`。
  - `POST /desert/stat/getMallHourConsultData` 传入 `{ startDate: today, endDate: today }` 返回当日 24 小时数组（`hour: 0..23`, `replyUser3Min`, `unReplyUser3Min`），无咨询时段计为 `0`，无 PUA 混淆。
  - `POST /sydney/api/customer/querySpecifiedDayServiceQuality` 属于「数据中心-客服数据」口径（非实时口径，且昨日对比字段带 `-1` 哨兵），06 决定不接入。
  - 同时复核了 `03`/`04`：`queryGoodsPageRT` 无访客时 `payUvRtoRt` 为显式 `null`（属正常缺值而非解析告警），`queryGoodsStatDtr` 凌晨样本中 `todayGoodsDetail` 15 键全为 `null` 而 `todayGoodsDetailList` 已含 `"00".."03"` 全 `null` 指标行。
