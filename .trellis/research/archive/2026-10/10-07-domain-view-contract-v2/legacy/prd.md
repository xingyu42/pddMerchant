# 领域视图层：输出契约 v2，终结上游字段透传

## Goal

LLM 通过 `pdd --json` 消费结果后向人转述时，会大段复述原始字段名（如 `unship12h`、`orderStatus`、`netGmv`），人难以理解。根因是项目没有统一的领域输出模型：部分 endpoint 把拼多多后台对象原样透传为 envelope `data`；其余命令虽已整理，但命名风格、单位、比率口径、顶层形状各不相同，且只有数据没有结论。

本任务建立统一的领域视图（防腐层）与输出契约 v2：`data` 自解释（领域命名、单位入名、枚举中文标签、事实性 headline），并用契约测试防止复发。

## Background

### 上游透传（违反 `.trellis/spec/services/domain-service-contracts.md:195`）

| 命令 | 泄漏点 | 锚点 |
|---|---|---|
| `orders.list` | `orders` = `result.pageItems` 原样 | `src/adapter/endpoints/orders.js:51-54`；`src/services/orders.js:5-7` |
| `orders.detail` | `order` = 上游订单对象原样（含指纹化的收件人字段） | `src/adapter/endpoints/orders.js:89` |
| `orders.stats` | `remote` 沿用上游名 `unship12h` 等；`local.status_distribution` 键为上游状态码 | `endpoints/orders.js:105-114`；`services/orders.js:35-76` |
| `goods.list` / `goods.stock` | `promotion` 为上游对象原样；`sku_price` 等为分且未换算 | `endpoints/goods.js:37-51`；`services/goods.js:19-30` |
| `goods.templates` | `free_province_need` 上游值原样 | `src/services/goods-publish.js:50-59` |
| `promo.roi` | `totals` 为 camelCase 上游名；`scenes_type` 等为枚举码；MoneyVO `unit` 被丢弃 | `src/adapter/endpoints/promo.js:26-85` |
| `diagnose.funnel` | `status_distribution` 键为上游状态码 | `src/services/diagnose/funnel-health.js:14-29` |

### 已整理但不一致

- 命名：`account.*`、`config.*`、`init`/`login`、`doctor.accounts[]` 用 camelCase。
- 顶层：`goods.list`/`goods.stock`/`goods.templates`/`shops.list`/`account.list` 的 `data` 为数组；`orders.*` 的 `mall_id` 在 `data`，`goods.*` 的 `mall`/`total` 在 `meta`。
- 口径：比率多为 0-1，`diagnose.shop --compare` 的 `delta_pct` 为百分数；时间窗为 unix 秒；`goods.segment` 的 `units_sold_30d` 在 `--days≠30` 时名不副实；`goods.publish` live 与 mock 形状不同（`goods-publish.js:85-105` vs `:540-555`）。
- `summary` 键已被 `goods.segment`、`promo.roi`、批量 envelope 用作结构化统计。

### 约束事实

- `raw` 键由 `src/infra/output.js:41-65` 从 stdout 剥离，`PDD_DEBUG_RAW=1` 可在 stderr 取回 → 收紧 `data` 不损失排障信息。
- `meta.v` 在 `output.js:152,174`、`errors.js:214`、`bin/pdd.js:182` 硬编码为 `1`，无测试断言。
- `normalizeRunResult`（`src/commands/runner/envelope-finalizer.js:8-21`）把 `data`/`meta`/`warnings` 视为保留键。
- Fixture 模式下 `runEndpoint` 不调用 `normalize`（`src/adapter/run-endpoint.js:9`）。
- 订单/商品上游真实字段清单在仓库中无记录（`test/fixtures/test-data.js:39-50` 为合成数据）。
- 改价当前为 `--price <cents>`（`src/commands/registry/goods.js:63`），校验仅要求正整数（`src/services/goods.js:79-88`）。
- 受影响测试约 400 条断言（`test/e2e/business-contract|factual-surface|merchant-auth`、`test/commands/goods-write-contract|diagnose-comparison-contract`、`test/adapter/orders-contract`、`test/services/*-contract`）。
- 项目已于 `c6a0b13` 移除自动经营建议/评分。

## Decisions

- D1 消费方：`--json` 唯一消费方是 LLM → 直接切换 v2，不保留 v1 兼容。
- D2 金额：输出与输入统一为元。输出金额键带 `_yuan`；`--price` 删除，改为 `--price-yuan`；batch 价格 `field` 改为 `price_yuan`；旧用法报退出码 2。
- D3 范围：全部注册命令（业务 + 管理）统一纳入 v2。
- D4 交付形态：单任务分阶段（见 `implement.md`），不拆子任务，避免 v1/v2 混合中间态。
- D5 PII：收件人/联系方式/地址字段不进入视图（现状已是指纹，人无法使用，无信息损失）。
- D6 买家留言：`buyer_memo` 保留（发货核对价值高；自由文本可能夹带联系方式，已知并接受；输出仅供本人使用的 LLM）。
- 字段规范、headline、契约守卫、上游采样等技术决策见 `design.md` §2–§7。

## Requirements

- R1 所有命令 `data` 顶层为对象，含 `headline: string[]`（1–3 句中文事实陈述，无建议/评分）。
- R2 所有 `data` 键为 snake_case；金额 `_yuan`（元，2 位）、比率 `_pct`（0-100）、时间 `_at`（`YYYY-MM-DD HH:mm:ss`，Asia/Shanghai）、日期 `_date`、时长 `_hours`/`_seconds`；枚举输出中文标签，未知码为 `未知(<code>)`；缺失为 `null`。
- R3 上游对象不得进入 `data`：每类实体经 `src/services/views/` 白名单投影。
- R4 列表命令形状 `{ headline, items, total, ... }`；业务上下文在 `data`，`meta` 仅技术字段。
- R5 `meta.v = 2`，单一常量来源，覆盖单命令、批量、错误、用法错误四种 envelope。
- R6 `goods update price --price-yuan <元>`（>0，≤2 位小数，精确解析）；`--price` 不再存在；batch `price_yuan`；回显字段同口径。
- R7 契约守卫测试覆盖全部注册命令，自动发现新命令。
- R8 非 `--json` 模式先输出 headline，`items` 渲染为表格；diagnose/doctor 渲染器适配。
- R9 Spec、`skills/pdd-cli/SKILL.md`、`CLAUDE.md` 同步 v2 契约；Skill 明确「向用户转述优先使用 headline，不复述键名」。
- R10 状态标签与金额单位以真实账号只读采样为依据（`research/upstream-schema-2026-10.md`），不落任何真实值。

## Acceptance Criteria

- [ ] AC1（R1/R2/R7）`npx vitest run test/contract/data-contract-v2.test.js` 通过：全部注册命令成功路径的 `data` 满足 headline、snake_case、`_yuan`/`_pct` 规则；新增未覆盖命令会使测试失败。
- [ ] AC2（R3）订单、商品、模板、推广实体数组元素的键集合与视图白名单完全相等；向 fixture 上游条目注入任意额外字段，输出不变。
- [ ] AC3（R2）`orders list --json` 中无 `orderStatus`/`order_status`/`pageItems`/unix 时间戳/分为单位的金额；状态显示为中文标签。
- [ ] AC4（R6）`goods update price --goods-id 1 --price 2999` 退出码 2；`--price-yuan 29.9 --confirm` 向上游提交 2990 分；`--price-yuan 29.999` 退出码 2；batch `field:"price"` 退出码 2。
- [ ] AC5（R5）四类 envelope 的 `meta.v` 均为 2，且 `assertEnvelopeShape` 断言之。
- [ ] AC6（R4）`goods list --json` 的 `data` 为对象且含 `items`/`total`/`mall_id`；`meta` 不再含 `total`/`mall`。
- [ ] AC7（D5）任何命令输出不含收件人姓名/电话/地址相关键。
- [ ] AC8（R8）非 `--json` 模式下 `orders list`、`diagnose shop` 首行起为 headline，无整段 JSON 单元格。
- [ ] AC9（R9）SKILL.md 与 spec 中不再出现 `--price <分>`、`meta.v: 1`；`npm test` 全绿；分层方向人工核查（`test/layering-guard.unit.test.js` 已于 `cc0cb1c` 删除，实施中发现，不可满足原条件）。
- [ ] AC10（R10）真实账号只读冒烟 `orders list`、`goods list`、`diagnose shop` 输出符合 v2 规范。

## Out of Scope

- `--format md` 展示模式、Skill 字段词典（根治后不再需要）。
- 新增业务查询能力或新字段（只重塑现有数据）。
- 改动 envelope 顶层 `{ ok, command, data, error, meta }` 结构与退出码体系。
- 经营建议、评分、好坏判断（`c6a0b13` 边界保持）。
