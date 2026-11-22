# 02: `pdd goods reviews` 支持 `--min-length <n>`、文档同步与收口验收

**What to build:** 商家或下游 Agent 在 `pdd goods reviews` 上传入 `--min-length <n>`（正整数 `>= 1`）时，严格按清洗后的主评或追评有效字数达到 `n` 字及以上进行筛选（不再保留无文字的 1–3 星中差评），并在输出顶层回显 `filter: { mode: '最小字数', min_length: n }`、`headline` 报出平台总数与达标条数。参数非法或与 `--all` 同时传入时在发起上游请求前立即返回用法错误（`E_USAGE`，退出码 `2`）。同步更新命令说明、CLI 技能文档、服务与命令契约文档以及 ADR 0005 状态，并在用户确认范围后完成真实账号只读核验。完整规格见 `../spec.md` 与 ADR 0005。

**Blocked by:** 01: `pdd goods reviews` 默认实质内容过滤与 `--all` 全量切换

**Status:** resolved

- [x] `pdd goods reviews --min-length <n>`（`n` 为 `>= 1` 整数）启用 `min_length` 模式（`filter: { mode: '最小字数', min_length: n }`），仅保留清洗后主评或追评有效字数 `>= n` 的条目（不触发无文字 1–3 星中差评兜底；平台占位文案与长度 `>= 2` 单字重复有效字数均为 `0`）
- [x] `min_length` 模式下 `headline` 报出平台总数与达标条数（「有效字数 ≥ n 字 X 条」），触达 2000 条截断时仍按 `fetched_count` 报出已采集条数
- [x] `--all` 与 `--min-length` 同时传入，或 `--min-length` 取 `0`、负数、小数、非数字时，立即返回 `E_USAGE`（退出码 `2`）且零上游请求（`xhr_count === 0`）
- [x] `--min-length <n>` 可与 `--days`、`--goods-id`、`--stars`、`--json`、`--all-accounts` 正常组合使用
- [x] CLI E2E + 合成夹具测试及服务/视图测试覆盖 `--min-length` 正常筛选、追评达标、无文字中差评剔除、参数互斥与非法值边界
- [x] 同步更新 `goods reviews` 命令描述、CLI 技能文档、服务与命令契约文档，并在验收通过后将 ADR 0005 状态更新为 `Accepted`
- [x] `npm run check` 通过
- [x] 真实账号只读核验（执行前先与用户确认范围）：对照默认、`--all`、`--min-length` 三种模式下的条数与字段一致性（仅记录脱敏后的统计与字段，不记录买家正文与 PII），结论写入 `## Comments`

## Comments

- 2026-11-22：离线实现、测试与文档同步已完成（`164eaa1`）。随后完成双轴代码审查：Spec 轴 0 缺陷；Standards 轴提出的 6 项发现（`filter.mode` 改用中文枚举 `'实质内容' | '最小字数' | '全部'`、移除服务层重复的参数解析校验并归还注册层、`CHANGELOG.md` 同步、`option-parsers.js` 提取私有 `preserveParseErrorCommand`、复用 `upstreamReview` 构造 `syntheticReview`、用 `GOODS_REVIEW_FILTER_MODES` 映射消除模式分支重复）已全部在 `3e90e50` 修复并同步更新规格与契约。`npm run check` 全量通过（knip lint 0 错；vitest 130 个测试文件、2208 项通过、1 项 Windows 平台预跳过）。待用户确认范围后执行真实账号只读核验并收口状态。
- 2026-11-22 真实账号只读核验（经用户授权默认账号，全部输出经脱敏校验，未记录评价正文、`goods_id`、`mall_id` 与 PII）：
  - `goods reviews --days 180 --json`（默认）：退出码 `0`、`ok: true`、`warnings: []`、`filter: { mode: '实质内容', min_length: 1 }`、`total: 54`、`fetched_count: 54`、保留 `42` 条（含 `3` 星 `2` 条、`4` 星 `2` 条、`5` 星 `38` 条）、`filtered_out_count: 12`、`truncated: false`、`headline: ["近 180 天全部星级评价 54 条，实质内容 42 条"]`；全部条目键集合严格等于 `REVIEW_FIELDS`。
  - `goods reviews --days 180 --all --json`：退出码 `0`、`ok: true`、`warnings: []`、`filter: { mode: '全部', min_length: null }`、`total: 54`、`fetched_count: 54`、返回 `54` 条（`3` 星 `2` 条、`4` 星 `5` 条、`5` 星 `47` 条）、`filtered_out_count: 0`、`headline: ["近 180 天全部星级评价 54 条"]`；全部条目键集合严格等于 `REVIEW_FIELDS`。
  - `goods reviews --days 180 --min-length 5 --json`：退出码 `0`、`ok: true`、`warnings: []`、`filter: { mode: '最小字数', min_length: 5 }`、`total: 54`、`fetched_count: 54`、保留 `39` 条（`4` 星 `2` 条、`5` 星 `37` 条，每条有效字符数均 `>= 6`）、`filtered_out_count: 15`、`headline: ["近 180 天全部星级评价 54 条，有效字数 ≥ 5 字 39 条"]`；全部条目键集合严格等于 `REVIEW_FIELDS`。
  - `goods reviews --all --min-length 5 --json`：退出码 `2`、`ok: false`、`command: 'goods.reviews'`、`error.code: 'E_USAGE'`。
