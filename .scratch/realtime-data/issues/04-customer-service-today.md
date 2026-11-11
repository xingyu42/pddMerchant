# 04: `diagnose customer-service` 增加今日实时区块

**What to build:** 在 `diagnose customer-service` 的 `data` 中新增 `today` 区块，输出今日 08–23 点 3 分钟人工回复率、当前待回复人数和分时咨询数据。端点与口径以 01 为准。

**Blocked by:** 01, 02（复用 02 确立的 `today` 区块写法）

**Status:** needs-triage

- [ ] `today` 含快照时间 `snapshot_at`，原有逐日趋势不变
- [ ] 每个回复率值标明 Reply-Rate Caliber，不和逐日值混成一条序列
- [ ] 拉取失败时 `today: null` 并写入 hint
- [ ] `data-contract-v2` 中 `diagnose customer-service` 的 case 覆盖 `today`；e2e 用合成 fixture

## Comments
