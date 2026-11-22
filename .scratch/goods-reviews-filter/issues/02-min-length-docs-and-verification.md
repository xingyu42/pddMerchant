# 02: `pdd goods reviews` 支持 `--min-length <n>`、文档同步与收口验收

**What to build:** 商家或下游 Agent 在 `pdd goods reviews` 上传入 `--min-length <n>`（正整数 `>= 1`）时，严格按清洗后的主评或追评有效字数达到 `n` 字及以上进行筛选（不再保留无文字的 1–3 星中差评），并在输出顶层回显 `filter: { mode: 'min_length', min_length: n }`、`headline` 报出平台总数与达标条数。参数非法或与 `--all` 同时传入时在发起上游请求前立即返回用法错误（`E_USAGE`，退出码 `2`）。同步更新命令说明、CLI 技能文档、服务与命令契约文档以及 ADR 0005 状态，并在用户确认范围后完成真实账号只读核验。完整规格见 `../spec.md` 与 ADR 0005。

**Blocked by:** 01: `pdd goods reviews` 默认实质内容过滤与 `--all` 全量切换

**Status:** ready-for-agent

- [ ] `pdd goods reviews --min-length <n>`（`n` 为 `>= 1` 整数）启用 `min_length` 模式（`filter: { mode: 'min_length', min_length: n }`），仅保留清洗后主评或追评有效字数 `>= n` 的条目（不触发无文字 1–3 星中差评兜底；平台占位文案与长度 `>= 2` 单字重复有效字数均为 `0`）
- [ ] `min_length` 模式下 `headline` 报出平台总数与达标条数（「有效字数 ≥ n 字 X 条」），触达 2000 条截断时仍按 `fetched_count` 报出已采集条数
- [ ] `--all` 与 `--min-length` 同时传入，或 `--min-length` 取 `0`、负数、小数、非数字时，立即返回 `E_USAGE`（退出码 `2`）且零上游请求（`xhr_count === 0`）
- [ ] `--min-length <n>` 可与 `--days`、`--goods-id`、`--stars`、`--json`、`--all-accounts` 正常组合使用
- [ ] CLI E2E + 合成夹具测试及服务/视图测试覆盖 `--min-length` 正常筛选、追评达标、无文字中差评剔除、参数互斥与非法值边界
- [ ] 同步更新 `goods reviews` 命令描述、CLI 技能文档、服务与命令契约文档，并在验收通过后将 ADR 0005 状态更新为 `Accepted`
- [ ] `npm run check` 通过
- [ ] 真实账号只读核验（执行前先与用户确认范围）：对照默认、`--all`、`--min-length` 三种模式下的条数与字段一致性（仅记录脱敏后的统计与字段，不记录买家正文与 PII），结论写入 `## Comments`
