# 01: 侦察今日实时端点的完整字段与请求参数

**What to build:** 只读实测 `.scratch/realtime-data/spec.md` 列出的实时端点，补齐完整响应字段、请求参数、数值单位、是否字体混淆、数据刷新频率，结论写回 `docs/research/`。需要真实账号，执行前确认范围。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [ ] `queryMallFlowRtData`：全部 `*Rt` 字段、单位、是否带快照时间
- [ ] `queryMallTradeList`：用店透视的 `{ queryType: 6, queryDate }` 实测，确认 `todayRtList` / `todayPerHourRtList` 的完整字段，确认没有截断
- [ ] `queryGoodsPageRT`：全部 `*Rt` 字段，与 `queryGoodsPageOverviewForMms` 对比后选定 `goods traffic` 不带 `--goods-id` 时的数据源
- [ ] `queryGoodsStatDtr`：完整字段；汇总值为字符串（如 `"4.76%"`）时的解析方式
- [ ] `queryAppRecentDataList`：请求参数、`*Dth` 字段、金额单位（店透视按 ÷1000 处理）
- [ ] 客服今日：实时回复率与待回复人数的端点和口径，`getMallHourConsultData`、`querySpecifiedDayServiceQuality` 传今天时的行为
- [ ] 每个端点记录是否命中 `spiderFont`

## Comments
