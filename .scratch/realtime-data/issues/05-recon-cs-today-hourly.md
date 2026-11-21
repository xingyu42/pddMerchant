# 05: 补测客服今日分时与指定日接口参数

**What to build:** 只读实测 `01` 遗留的两个客服接口（`/desert/stat/getMallHourConsultData`、`/sydney/api/customer/querySpecifiedDayServiceQuality`）传入今天日期的请求参数、响应结构与口径归属，并复核实时回复率与待回复人数接口形态，结论脱敏回写 `docs/research/realtime-and-fee-recon-2026-11-11.md`，为 06 定稿字段与 `Reply-Rate Caliber`。需要真实账号只读访问，执行前确认范围。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 确认 `getMallHourConsultData` 传今天的请求体、是否返回当日分时数据、完整字段与空值形态
- [ ] 确认 `querySpecifiedDayServiceQuality` 传今天的可用性、`Reply-Rate Caliber` 与是否出现私有区混淆字符
- [ ] 复核 `mallServiceRealTimeData` 与 `unreplyUser/count` 响应外壳、空值形态及页面口径文案
- [ ] 结论脱敏写入 `docs/research/realtime-and-fee-recon-2026-11-11.md`（不含店铺 ID、客服账号名、买家信息）并明确 06 的字段与口径建议

## Comments
