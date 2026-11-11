# 03: `goods traffic` 增加今日实时区块

**What to build:** 在 `goods traffic` 的 `data` 中新增 `today` 区块。带 `--goods-id` 时输出该商品今日汇总和小时趋势（候选 `queryGoodsStatDtr`）；不带时输出全店商品今日概况（候选 `queryGoodsPageOverviewForMms`）。具体端点以 01 为准。全店多商品今日明细只有混淆版，不做。

**Blocked by:** 01, 02（复用 02 确立的 `today` 区块写法）

**Status:** needs-triage

- [ ] `today` 含快照时间 `snapshot_at`，原有区间明细不变
- [ ] 上游字符串数值（如 `"4.76%"`）解析失败时输出 `null` 并写入 `meta.warnings`
- [ ] 拉取失败时 `today: null` 并写入 hint
- [ ] `data-contract-v2` 中 `goods traffic` 的 case 覆盖 `today`；e2e 用合成 fixture

## Comments
