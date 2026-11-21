# 06: `diagnose customer-service` 增加今日实时区块

**What to build:** 在 `diagnose customer-service` 的 `data` 中新增 `today` 区块，输出今日 08–23 点 3 分钟人工回复率、当前待回复人数、`snapshot_at` 及 `05` 确认可用的分时咨询序列；每个回复率值显式标注 `Reply-Rate Caliber`，独立于原有逐日趋势与 `sales` 区块。

**Blocked by:** 02, 05

**Status:** needs-triage

- [ ] `today` 含 `snapshot_at`、回复率及显式 `Reply-Rate Caliber`、待回复人数及 `05` 确认的分时咨询数据，不与逐日趋势和 `sales` 混合
- [ ] headline 新增今日实时客服行（遵循多区块 headline 约定，`today: null` 时省略）
- [ ] 失败降级为 `today: null` 并写入 hint，退出码 0，原有 `summary`、`trend`、`sales` 不变
- [ ] `data-contract-v2` 中 `diagnose.customer-service` 用例覆盖 `today`；合成 fixture、adapter/view/service/e2e 测试覆盖以上行为
- [ ] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [ ] `npm run check` 通过
- [ ] 真实账号只读验证（执行前确认范围）：今日回复率、待回复人数与分时数据与后台一致；结果写入 Comments

## Comments

- 2026-11-22：原 `04-customer-service-today.md` 在拆细 `goods traffic`（03/04）与单列客服分时补测（05）后重编为 06，待 05 侦察完成后细化为 `ready-for-agent`。
