# Design — 领域视图层 / 输出契约 v2

## 1. 边界与分层

```
adapter/endpoints/*.normalize   只做「外形校验 + 取出上游结构」，继续挂 raw（stdout 由 stripRaw 剥离）
        ↓
services/views/<entity>.js      领域投影（防腐层）：白名单 + 命名 + 单位 + 枚举标签 + 去 PII
services/<domain>.js            组装命令级结果 + 生成 headline
        ↓
commands/*                      只透传 service 结果，不再拼装上游字段
infra/units.js                  无领域知识的换算原语（元/分、时间、百分比）
```

- 投影放 services：spec 已规定 services 是领域层，且「Raw endpoint payload MUST be normalized before returning to command layer」（`domain-service-contracts.md:195`）。
- Fixture 模式下 `runEndpoint` 直接返回 endpoint 级 fixture（`run-endpoint.js:9`），投影位于其下游 → fixture 模式同样覆盖投影逻辑。
- 依赖方向不变：`commands → services → adapter → infra`；`infra/units.js` 被 services 与 adapter（上货价格解析）共用。

## 2. v2 字段规范（所有命令、所有层级的 `data`）

| 类别 | 规则 | 示例 |
|---|---|---|
| 键名 | 仅 `^[a-z][a-z0-9_]*$`（snake_case） | `display_name`，禁止 `displayName` |
| 金额 | number，元，保留 2 位，键名后缀 `_yuan` | `paid_amount_yuan: 29.9` |
| 时间点 | string `YYYY-MM-DD HH:mm:ss`（Asia/Shanghai），后缀 `_at` | `paid_at` |
| 日期 | string `YYYY-MM-DD`，后缀 `_date` 或窗口 `{start_date,end_date}` | |
| 时长 | number，后缀 `_hours`（1 位小数）或 `_seconds` | `ship_p95_hours` |
| 比率 | number，百分数 0-100，2 位小数，后缀 `_pct` | `refund_rate_pct: 3.12` |
| 倍数 | ROI 保持倍数 number，键名 `roi` | `roi: 2.35` |
| 枚举 | 中文标签 string；未知码 → `未知(<code>)` | `status: '待发货'` |
| 标识 | string | `goods_id: '101'` |
| 缺失 | `null`，不得补 0（沿用 `endpoint-xhr-contracts.md:51-53`） | |
| PII | 收件人/联系方式/地址等字段**不进入视图**（现状本就是指纹，人无法使用） | |

`data` 顶层恒为对象：

- 列表命令：`{ headline, items: [...], total, ...业务上下文 }`（`goods.list`/`goods.stock`/`goods.templates`/`shops.list`/`account.list` 由数组改为此形状）。
- 业务上下文（`mall_id`、`total`、`threshold`、`low_stock_count` 等）回到 `data`；`meta` 只保留技术字段（`v`、`exit_code`、`latency_ms`、`xhr_count`、`warnings`、`correlation_id`、`account*`）。
- 视图对象禁止使用 `data`/`meta`/`warnings` 作为顶层键（`envelope-finalizer.js:8-21` 的保留槽位）；警告继续走 `{ data, warnings }` 返回形状。

## 3. headline

- `data.headline: string[]`，1–3 句中文**事实**陈述，由 service 生成；每个命令（含写命令、管理命令、错误以外的所有成功路径）都必须有。
- 只陈述数量、状态、缺失；禁止建议、评分、好坏判断（`c6a0b13` 边界，`command-contracts.md:88`）。
- 已有结构化 `summary`（`goods.segment`、`promo.roi`、批量 envelope）保持结构化语义，按 §2 规范重命名其内部字段，不与 headline 合并。
- 示例：`orders.list` → `["近 7 天共 128 单，本页 20 单", "待发货 5 单"]`；`goods.update.price` dry-run → `["预演：商品 101 价格将改为 29.90 元，未提交"]`。

## 4. 契约版本

- `src/infra/output.js` 导出 `ENVELOPE_VERSION = 2`；`output.js:152,174`、`errors.js:214`、`bin/pdd.js:182` 四处统一引用。
- `envelope-errors-output.md` 更新为 v2，新增 §2 字段规范作为契约的一部分。

## 5. 写命令输入（D2）

- `goods update price`：删除 `--price <cents>`，新增必填 `--price-yuan <元>`；commander 对未知选项报 `E_USAGE`（退出码 2），旧调用无法被静默接受。
- 解析：字符串精确解析（不做浮点乘法），`>0`、最多 2 位小数，非法 → `E_USAGE`；把 `adapter/goods-publish/source-sku-normalizer.js:66-75` 的 `parseYuanToCents` 抽到 `infra/units.js` 复用，内部仍以分调用上游。
- `goods update batch`：价格变更 `field` 改为 `price_yuan`、`value` 为元；`field: 'price'` → `E_USAGE` 并在 hint 给出新格式。
- 写命令回显（dry-run 与确认结果）的价格字段同为 `price_yuan`。

## 6. 契约守卫（防复发）

- 每个视图模块导出字段白名单，例如 `ORDER_VIEW_FIELDS`。
- 新增 `test/contract/data-contract-v2.test.js`：在 fixture 沙箱中跑**全部已注册命令**的成功路径（含 dry-run），对 stdout envelope 断言：
  1. `meta.v === 2`，`data` 为对象且含非空 `headline: string[]`；
  2. 递归所有键匹配 snake_case；
  3. 名称含 `price|amount|gmv|spend|cost|fee` 的数值键必须以 `_yuan` 结尾；含 `rate|ctr` 的数值键必须以 `_pct` 结尾；
  4. 实体数组元素键集合等于对应视图白名单（多一个上游字段即失败）；
  5. 命令清单从 `registry/` 动态收集，新增命令未覆盖即失败。
- `assertEnvelopeShape`（`test/helpers/envelope-assertions.js:3-10`）增加 `meta.v` 断言。

## 7. 上游字段事实来源（研究前置）

仓库无订单/商品上游真实字段记录（fixture 为合成数据）。实施前用真实账号做**只读**采样（`PDD_DEBUG_RAW=1` 运行 `orders list --size 3`、`orders detail`、`goods list --size 3`、`promo roi`），仅记录：键名、值类型、枚举值域（订单/售后状态码）、MoneyVO 的 `unit/unitCode`、价格字段量级。**不记录**任何订单号、商品 ID、金额值、收件人信息。产出 `research/upstream-schema-2026-10.md`，作为视图白名单、状态标签表、金额单位换算的唯一依据；采样未覆盖的状态码按 `未知(<code>)` 输出。

## 8. 人类可读模式（非 `--json`）

- `renderTable`（`output.js:196-240`）：先输出 headline；`data.items` 存在时渲染为表格，其余标量渲染为键值表。
- diagnose / doctor 自定义渲染器（`diagnose/_render.js`、`doctor.js:92`）适配 v2 键名。
- 批量 envelope 结构不变（`accounts.<slug>.data` 为 v2 data），`meta.v = 2`。

## 9. 兼容与回滚

- 不提供 v1 兼容（D1）。
- 回滚 = 整体回退本任务改动；各阶段完成时全量测试为绿，作为阶段回滚点。
- 风险：LLM 旧记忆仍用 `--price` → 被 usage error 拦截（安全失败）；Skill 同步更新。
