# 02: `diagnose traffic` 增加今日实时区块

**What to build:** 在 `diagnose traffic` 的 `data` 中新增 `today` 区块，输出全店今日截至当前的访客 / 浏览，以及交易小时趋势。字段以 01 的侦察结论为准。本工单同时确立三个报表共用的 `today` 区块写法（`snapshot_at` 为抓取时间、`report.optional` 失败为 `null` 加 hint），03、04 复用。

**Blocked by:** 01

**Status:** needs-triage

- [ ] `today` 含快照时间 `snapshot_at`（`YYYY-MM-DD HH:mm:ss`，Asia/Shanghai）
- [ ] 今日数据不并入原有逐日序列，原有字段和窗口语义不变
- [ ] 拉取失败时 `today: null` 并写入 hint，历史数据照常输出
- [ ] 金额 `_yuan`、比率 `_pct`，缺失为 `null`；headline 补一行今日事实
- [ ] `data-contract-v2` 中 `diagnose traffic` 的 case 覆盖 `today`；e2e 用合成 fixture

## Comments
