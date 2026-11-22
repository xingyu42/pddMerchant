# 03: 接入首个确认有价值的独有混淆指标

**What to build:** 将 `01` 盘点并确认高价值的首个独有 `Obfuscated Metric` 通过 `02` 管道端到端接入对应报表命令，按 `data` 契约 v2 输出事实数字；字体或交叉核对失败时仅该指标或区块降级为 `null` 并附明确 hint，不影响原有明文指标。

**Blocked by:** 01, 02

**Status:** deferred

- [ ] 仅输出 `01` 确认且通过明文核对的指标，遵循 `data` 契约 v2
- [ ] 核对失败或字体不可用时降级为 `null` 并附明确 hint，退出码与原有明文区块不变
- [ ] `data-contract-v2`、合成 fixture、adapter/service/view/e2e 测试覆盖正常解码输出与核对失败降级
- [ ] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [ ] `npm run check` 通过
- [ ] 真实账号只读复验（执行前确认范围）：解码值与后台页面或明文锚点一致，结果写入 Comments

## Comments

- 2026-11-22：用户确认暂缓 `02`–`04`（核心指标已有明文替代来源），工单置为 `deferred`。
