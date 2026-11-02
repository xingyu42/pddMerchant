# Implement — 领域视图层 / 输出契约 v2

单任务分阶段交付（全部阶段完成后才对外切换；不拆子任务，避免出现 v1/v2 混合的中间态被使用）。每阶段结束：`npm test` 全绿 = 回滚点。

## Phase 0 — 上游字段采样（研究，需真实账号只读访问）

- [x] `PDD_DEBUG_RAW=1 node bin/pdd.js orders list --size 3 --json`，并对其中一单 `orders detail`
- [x] `PDD_DEBUG_RAW=1 node bin/pdd.js goods list --size 3 --json`
- [x] `PDD_DEBUG_RAW=1 node bin/pdd.js promo roi --json`（无投放数据则记录为未覆盖）
- [x] 仅提取键名 / 类型 / 枚举值域 / MoneyVO unit / 价格量级 → `research/upstream-schema-2026-10.md`；不落任何真实值
- [x] 对照商家后台页面文字确定状态码中文标签

## Phase 1 — 基础设施

- [x] `src/infra/units.js`：`yuanFromFen`、`parseYuanToFen`（自 `source-sku-normalizer.js:66-75` 抽取）、`toLocalDateTime`、`toLocalDate`、`toPct`、`round` + 单测（含边界：null、字符串数字、负数、>2 位小数）
- [x] `ENVELOPE_VERSION = 2`，替换 `output.js:152,174`、`errors.js:214`、`bin/pdd.js:182`
- [x] `renderTable` 支持 headline + `items`
- [x] `test/contract/data-contract-v2.test.js` 骨架 + 递归规则检查器；临时 `PENDING_COMMANDS` 清单（Phase 6 必须清空）
- [x] `assertEnvelopeShape` 增加 `meta.v === 2`

## Phase 2 — 订单

- [x] `services/views/order.js`：`toOrderView`（list 项）、`toOrderDetailView`，`ORDER_STATUS_LABEL` / 售后状态标签；去 PII
- [x] `orders.list` / `orders.detail` / `orders.stats`（`remote` 改领域名，`status_distribution` 用中文标签，时长 `_hours`，`refund_rate_pct`）+ headline
- [x] `diagnose.funnel` 的 `status_distribution` 同步标签化
- [x] 更新 `test/adapter/orders-contract.test.js`、`test/services/orders-statistics.test.js`、`business-contract.e2e` 订单部分；fixture 改为采样所得的真实字段结构（合成值）

## Phase 3 — 商品

- [x] `services/views/goods.js`：list/stock 项（`price_yuan` 等，`promotion` 投影为必要字段或删除）、template 项（`free_province_need` 语义化）
- [x] `goods.list` / `goods.stock` / `goods.templates` 改为 `{headline, items, total, ...}`；`meta.total/mall` 移回 data
- [x] `goods.segment`：`units_sold_30d` 改为与窗口无关的命名（如 `units_sold` + `window_days`），`summary` 内部字段按规范
- [x] `goods.publish`：live 与 mock 形状统一（`goods-publish.js:85-105` vs `:540-555`）
- [x] 写命令：`--price-yuan`（删除 `--price`）、batch `price_yuan`、回显字段与 headline；`goods-write-contract.test.js` 与 e2e 更新，新增「旧 `--price` → 退出码 2」「batch `field:'price'` → 退出码 2」「29.9 元 → 上游 2990 分」测试

## Phase 4 — 推广与诊断

- [x] `promo.roi`：`rows`/`summary`/`totals` 全部规范化（`netGmv` → `net_gmv_yuan` 等），按采样结论处理 MoneyVO unit；`scenes_type`/`promotion_type` 标签化
- [x] `diagnose.*`：`detail` 字段规范化（`_pct`、`_hours`），`compare.delta_pct` 口径与说明统一，窗口改日期字符串；`issues`/`hints` 保留
- [x] `diagnose/_render.js` 适配；更新 `factual-surface.e2e`、`diagnose-comparison-contract`、`diagnose-facts`、`promo-roi-contract`

## Phase 5 — 店铺与管理命令

- [x] `shops.list`（去掉重复的 `active`/`is_current` 之一，fixture 模式也走 `normalizeMallRecord`）、`shops.current`
- [x] `account.*`、`config.*`、`init`、`login`、`login.consumer`、`doctor`：snake_case + 顶层对象 + headline
- [x] 批量 envelope：`meta.v = 2`，`accounts.<slug>.data` 为 v2 data
- [x] 更新 `merchant-auth.e2e` 等

## Phase 6 — 收口

- [x] 清空 `PENDING_COMMANDS`，契约守卫覆盖全部注册命令
- [x] Spec：`infra/envelope-errors-output.md`（v2 + 字段规范）、`services/domain-service-contracts.md`（视图层）、`commands/command-contracts.md`（headline）、`adapter/fixture-mode.md`（修正过期的 `test/fixtures/endpoints/` 描述）
- [x] `skills/pdd-cli/SKILL.md`：v2 字段规范、`--price-yuan`、「向用户转述优先使用 headline，不复述键名」；`CLAUDE.md` envelope 约定同步
- [x] 删除失效的 `test:endpoints` 脚本（指向不存在的文件）
- [x] 验证：`npm test`；fixture 模式逐命令 `--json` 冒烟；真实账号只读冒烟 `orders list`、`goods list`、`diagnose shop`（写命令仅 dry-run）

## 验证命令

```bash
npx vitest run test/contract/data-contract-v2.test.js
npx vitest run test/infra
npm test
```

## 高风险文件

- `src/services/goods.js`、`src/commands/goods/update/*.js`、`src/commands/registry/goods.js`（线上改价）
- `src/infra/output.js`（全部命令输出出口）
- `src/commands/runner/envelope-finalizer.js`（保留槽位语义）
