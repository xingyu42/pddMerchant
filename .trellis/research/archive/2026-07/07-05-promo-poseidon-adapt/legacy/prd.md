# 修复 promo 模块适配新版拼多多报表接口

## Goal

拼多多营销中心报表接口（`queryEntityReport` / `queryHourlyRangeReport`）的网关从 `apollo` 改为 `poseidon`，请求体新增 `crawlerInfo` 风控签名，响应金额字段从裸数字变为 `MoneyVO` 结构。当前 promo 模块因此失效：`urlPattern` 拦不到响应，`route handler` 整替请求体擦掉 `crawlerInfo` 被风控拦截，`normalize` 读取的金额字段是对象而非数字。

修复后 `pdd promo search / scene / roi` 三个命令恢复可用，下游 `diagnose`、`action plan`、`goods segment`、`promo-health` 等 7 个消费者零感知。

## Scope

**In Scope（Phase 1 + Phase 2）**：
- `src/adapter/endpoints/promo.js`：两个 endpoint 的 `urlPattern` / `apiUrl` 网关名修正
- `src/adapter/endpoint-client.js`：`_attemptFetch` 的 route handler 改为「保留页面原始 payload + merge 业务字段」模式（A 方案，统一生效）
- `src/services/promo.js`：`normalize` 适配 `MoneyVO` 拍平；删除 `filterByType` / `getSearchPromo` / `getScenePromo`（搜索/场景推广已合并为商品推广，scenesType 恒 9，过滤无意义）
- `src/commands/promo/search.js` + `scene.js`：删除（命令语义已失效）
- `src/commands/registry/promo.js`：移除 search/scene 注册
- 测试 fixture 与单测/e2e/PBT 同步更新

**Out of Scope**：
- 新版管理页 `venus/api/goods/promotion/v3/list` 的对接（不在本次路线）
- ROI 全量拉取策略（OQ2，待实跑有数据后独立评估）

## Requirements

### R1 — 网关名修正
- `PROMO_ENTITY_REPORT.urlPattern` 从 `/apollo\/api\/report\/queryEntityReport/` 改为 `/poseidon\/api\/report\/queryEntityReport/`
- `PROMO_ENTITY_REPORT.apiUrl` 从 `/apollo/api/report/queryEntityReport` 改为 `/mms-gateway/poseidon/api/report/queryEntityReport`
- `PROMO_HOURLY_REPORT.urlPattern` / `apiUrl` 同样改 `apollo` → `poseidon`

### R2 — crawlerInfo 保留（A 方案统一改造）
- `_attemptFetch` 的 route handler 改为：先 `route.request().postData()` 拿页面原始请求体，解析为 `origPayload`，与 `meta.buildPayload()` 结果做 `{ ...origPayload, ...payload }` 超集合并，再 `route.continue({ postData: JSON.stringify(merged) })`
- `buildPayload` 字段优先覆盖页面原始字段（业务参数以项目构造为准）
- 页面生成的 `crawlerInfo` 等签名字段自动透传
- 此改动对所有 fetch-path endpoint 统一生效（goods/orders/promo 共 6 个 endpoint）

### R3 — MoneyVO 拍平
- 新增 `moneyToNumber(moneyVO)` helper：接受 `{unit, value, unitCode}` 或裸数字，返回 `Number(value)`
- `normalize` 中 `totals.gmv / totals.spend / totals.ctr / totals.netGmv / totals.costPerOrder` 等金额字段全部经 `moneyToNumber` 拍平
- `totals.click / totals.impression` 等裸 int 字段保持直接读取
- `entities` 数组每个元素的金额字段同样拍平（结构待 Phase 1b 实跑确认：是 `{spend: MoneyVO}` 还是 `{reportInfo: {spend: MoneyVO}}`）

### R4 — 下游边界（实现选择，非硬约束）
- **当前选择**：service 层输出的 `entities`/`totals` 字段形状与旧版一致（裸数字），`promo-health`、`analyzePromoRoi`、`collectPromoInput`、`action plan`、`goods segment` 等 7 个下游消费者在 Phase 1 无需改动
- **此选择的目的**：Phase 1 聚焦「让 promo 重新能跑」，最小化爆炸半径；不意味着下游边界被永久锁定
- **可重新评估**：新版响应包含 `waivedRefundRate`（退款豁免率）、`bidType`（出价方式）等新维度字段，当前适配器丢弃了这些字段。若下游需要消费新维度，Phase 2 可上移边界让 service 透传原始结构，届时下游 7 个消费者需同步改字段读取路径

## Constraints

- **不破坏 orders/goods 的 fetch-path**：A 方案是超集合并，`{...orig, ...payload}` 只可能多带字段不可能少带；必须通过现有 ~770 测试 + e2e 兜底验证零回归
- **不引入硬编码 crawlerInfo**：`crawlerInfo` 是页面 JS 实时生成的反爬签名，每次请求不同，必须从页面原始 payload 透传，不能硬编码
- **`isSuccess` 不改**：实测 `success=true` 时 `errorCode=1000`（非 0），当前 `isSuccess: (raw) => raw?.result !== undefined` 仍成立，保持不动
- **ESM only，async/await only，无 console.log**，遵循项目 `CLAUDE.md` 编码规范
- **依赖方向**：`commands/ → services/ → adapter/ → infra/`，不反向（`test/layering-guard.unit.test.js` 守护）

## Acceptance Criteria

- [ ] `pdd promo roi --json` 实跑返回非空 `data.rows`（店铺有推广数据时）或正确的空状态（无数据时）
- [ ] `pdd promo search --json` / `pdd promo scene --json` 实跑不报 `E_NETWORK` 超时
- [ ] `npm test` 全量通过（含 promo-roi 单测、boundary PBT、e2e、layering-guard）
- [ ] `moneyToNumber` helper 单测覆盖：MoneyVO、裸数字、null、非对象四种输入
- [ ] route handler merge 逻辑单测覆盖：原始 payload 含 `crawlerInfo` 时被保留、buildPayload 字段覆盖 orig 同名字段
- [ ] 下游 7 个消费者在 Phase 1 零改动（git diff 不触及 `promo-health.js` / `action plan.js` / `segment.js` / `collectors.js` / `promo-roi.js` 的业务逻辑行）—— 这是 Phase 1 的实现选择，非永久约束（见 R4）

## Open Questions

- **OQ1**：`entityReportList[i]` 的内部结构是 `{spend: MoneyVO, ...}` 还是 `{reportInfo: {spend: MoneyVO, ...}}`？当前店铺无投放数据，空数组无法实测。Phase 1 先按「字段直接在元素上（与旧版一致）」假设，Phase 1b 实跑有数据后校正。
- **OQ2**：`pageSize` 上限是多少？Phase 1 暂用 `--size` 默认值（10/50），不主动拉全量。如果后续发现 ROI 分析因分页失真，再 Phase 2 评估「拉全量 vs 循环翻页」策略。
- **OQ3**：是否在 Phase 2 上移适配器边界，让下游消费新版额外字段（`waivedRefundRate`/`bidType`/退款豁免率等）？当前 Phase 1 适配器丢弃这些字段以换取下游零改动；若业务需要新维度评分（如 `promo-health` 用退款豁免率），需重新评估边界位置。
