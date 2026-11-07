# 架构加深候选与待办

来源：2026-11-07 架构评审（三个只读子代理勘察 → Claude 抽查 → Codex 逐条核查）。
范围：最近 80 次提交的热点（auth / runner / endpoints / views / labels）。
状态说明：**已确认**＝代码层面三方一致；**待验证**＝结构成立，运行后果未复现；**已推翻**＝核查后不成立。全程只读，未运行测试。

## 缺陷类（可独立先修）

### T1 四个端点的 errorMapper 吞掉 40002 风控分类 — 已确认
- `src/adapter/endpoint-client.js:283-296`：`isSuccess` 失败时先用 spec 的 `errorMapper`，返回 code 即抛出，不再走 `createBusinessFailure`。
- `src/adapter/endpoint-client.js:44-60`：`createBusinessFailure` 才给 40002 加 `classification: 'high-frequency-or-risk-control'` 与专用 hint。
- 受影响：`endpoints/traffic.js:34-37`、`customer-service.js`、`experience.js`、`reviews.js:40` 的复制版 `errorMapper`（只返回 `E_BUSINESS`）。
- 期望：这些端点的 40002 与默认路径分类一致。
- 下一步：先写失败测试（40002 响应分别走 traffic spec 与默认路径，比对 `detail.classification` 与 hint），再修。

### T2 diagnose / segment 并发页在 try 前创建，可能泄漏 — 已确认（触发频率未知）
- `src/services/diagnose/reports.js:61-62`、`src/services/goods-segmentation.js:207-208`：两个 `newPage()` 都在 `try` 之前，第二个失败时第一个不关闭。
- 期望：页面创建移入 `try`，或改由候选 C8 的页面租借统一处理。

### T3 控制台 live 密码登录成功分两个事务提交 — 已确认结构，后果待验证
- `src/services/console-login.js:159-170`：fixture 分支在一个 `transaction()` 内提交；live 分支 `saveMerchantLogin` 与 `recordReloginOutcome` 各自提交。
- 待验证：第二次提交失败时账号停留的状态、是否可恢复、是否影响普通命令。
- 关联：候选 C6。

## 加深类（按建议顺序）

### C1 上游响应判定收进一个 module — Strong，先做
- 问题：成功规则由各 spec 自定且有差异（traffic/CS/experience 共用 `SUCCESS_BUSINESS_CODES`；`reviews.js:39` 用 `||`；`goods-publish/form-filler.js:1063` 只认 `error_code===1000000`，草稿保存另接受 `success===true`）；`endpoint-client.js:283` 无 `isSuccess` 即放行；错误映射复制 4 份（见 T1）。
- 附带：`mapWriteBusinessError`（`endpoints/goods.js:58`）与 `mapPublishBusinessError`（`endpoints/goods-publish.js:4`）的 54001 分支在 HTTP 2xx 路径不可达，因为 `classifyRateLimit`（`endpoint-client.js:272`）先执行；但 `services/goods-publish.js:130` 直接调用 mapper。`infra/errors.js:277` `isSuccessResponse` 无调用方。`_executeWithRetry`（`endpoint-client.js:194-309`）116 行。
- 方向：`interpretResponse(spec, { status, raw })` 持有判定顺序、成功码、双写法；spec 只声明 `normalize` 与业务码例外。先集中错误分类，成功规则逐端点核验后再收拢。
- 测试：endpoint-client 目前没有直接测试；改为一张表驱动测试。
- 已推翻：“errorCode=0 由 `page-api-client.js:196-201` 的包装造成”。issue #1 记录了平台真实成功响应就是 `errorCode: 0`。

### C2 fixture adapter 下沉到 transport seam — Strong，依赖 C1
- 问题：`adapter/run-endpoint.js:9` 先判 `isMockEnabled()`，`runner/fixture-runtime.js:70` 注入的 `FixtureEndpointClient` 不执行 `execute`；fixture 在生成时已 normalize（`test/fixtures/test-data.js:16,238`），命令运行时不经过 `isSuccess` / `errorMapper` / 限流分类。
- 无引用代码：`adapter/fixture-parity-diagnostics.js`（201 行）与 `adapter/endpoint-validator.js`（294 行），只有前者引用后者。
- 方向：`transport.send(spec, params, ctx) → { status, raw }`，live 与 fixture 两个 adapter；fixture 存上游原始响应体。
- 迁移成本：`test-data.js` 改存原始体；无 `normalize` 的 spec live 返回 `{ raw }`、fixture 返回原值，需统一。
- **Batch 2 已完成（2026-11-07）**：`PlaywrightEndpointClient.send(spec, params, ctx)` 返回 `{ status, raw, response }`；fixture 与 live 共用重试、`interpretResponse()`、归一化和冷却记账，fixture 跳过令牌等待并支持 `page: null`。
- fixture builders 和测试内端点数据已改为上游原始体；分页列表路径改为 `result.pageItems` 等，后续空页保留 envelope、总数与汇总；`__throws` 保留。删除旧 fixture client、服务层形状标记及两个诊断模块，商家认证 fixture 分支保持原样。
- 验证：`npm test -- --no-cache` → `Test Files  104 passed (104)`；`Tests  1869 passed | 1 skipped (1870)`。输出契约 v2 全部 59 项通过；新增 9 项 transport 回归覆盖错误分类、归一化、分页、缓存和冷却。

### C4 运营报表采集骨架 — Strong
- 问题：可选数据源 try/catch 重复 5 份（`customer-service.js:25`、`reviews.js:40`、`experience.js:21`、`goods-traffic-promo.js:50`、`goods-profit-promo.js:59`），返回值有 null / 空 map / 部分结果之别；`--days` 在 6 个 service 各自校验，`registry/diagnose.js:14` 仍用 `Number`；时间窗 4 个构造、3 种形状；未登记 hint 键输出 `null`（`views/customer-service.js:40`），`views/goods-profit.js:28` 静默过滤，`test/helpers/data-contract.js:52` 不检查 hint 值（当前未发现实际漏登记）。
- 方向：`runReport(ctx, decl, fn)` 提供 `r.window`、`r.optional(hint, fn)`、`r.hint(key)`，days 声明同时生成解析器与帮助文案。
- 附带：`views/labels.js` 35 个导出中 27 个只有单一 src 使用方；`labels.js:114` 与 `:136` 两张原因表同码不同文案（risk_confirm / takeover_timeout / unknown），目前无行为错误证据。

### C6 重登尝试句柄 — Worth exploring，可并入 C3
- 问题：调用方须按顺序取 `credentialUpdatedAt` → `recordReloginAttempt` → `recordReloginOutcome`（返回错误由调用方决定是否抛）；已验证材料有 4 条写入路径。
- 方向：`beginReloginAttempt(tx, { manual })` → `.fail(outcome)` / `.succeed(candidate)`，成功在同一事务内完成（覆盖 T3）。

### C8 并发端点调用的页面租借 — Speculative
- 问题：`diagnose/collectors.js:12`、`diagnose/reports.js:61`、`goods-segmentation.js:207` 在 service 内管理 Playwright 页面，`typeof page?.context` 兼作 fixture 判断；`page-session.js:25` 的 1 秒 TTL 兄弟页只覆盖 fetch/legacy，page-api（`endpoint-client.js:338`）原地导航。两者目的不同（并发隔离 vs 短间隔导航）。
- 方向：`ctx.endpoints.run(spec, params)` 按并发调用租借页面。涉及 TTL 行为，需真实账号验证。

### C3 商家认证检查与恢复收成一个 module — Worth exploring
- 问题：“核验 → 记录 → 重登”在 `runner/single-lifecycle.js:36-49,94-100`、`services/patrol.js:33-70`、`services/auth.js:87-95`、`commands/doctor.js:66-90` 手写；差异部分合理（patrol 先做 HTTP 探测，login 走人工授权，doctor 只报告）。fixture 走平行实现：`password-relogin.js:277` `commitFixtureRelogin` 写 `PDD_FIXTURE_RELOGIN` 标记 cookie，绕过 `assertVerifiedMerchantCandidate` 与 metadata/corrupt 维护（仍做租约与 revision CAS）。`single-lifecycle.js:46` 对同步的 `recordMerchantCheck` 多余 `await`。
- 方向：`withMerchantSession(account, task, { mode }, fn)`；fixture 分支下沉到 adapter 入口。保持进程内调用，不依赖 daemon（ADR-0003）。难点：fixture 模式不启动 browser。
- 已推翻：“重登恢复时丢失 deadline 原值”。`password-relogin.js:212` 读的是 runtime getter（`single-lifecycle.js:175`），预算保留；patrol 使用真实 deadline。

### C7 商品–订单匹配 module — Worth exploring
- 问题：`readGoodsId` / `detectStrategy` / `detectMatchedBy` 在 `diagnose/inventory-health.js:10-84` 与 `goods-segmentation.js:17-42` 重复；segmentation 横向引入 `extractItems`、`buildGoodsKey`，service 直接引入 `labels.js`。
- 方向：`matchSales(goods, orders) → { byGoods, matched_by, ambiguous, warnings }`，封装 `goods_id: null` 回落按名匹配。

### C5 指标投影与“缺失为 null” — Speculative
- 现状：`inventory-health.js:58,187`、`goods-segmentation.js:90`、`services/goods.js:39`、`promo-roi.js:78`、`diagnose/promo-health.js:22` 写 `?? 0`；live 路径已由 `endpoints/goods.js:31-34`、`endpoints/promo.js:129,179` 校验，零曝光 CTR 由 `views/promo.js:41` 输出 null。风险限于 fixture 与直接调用。
- 方向：`metricTable([key, field, kind])` 统一换算、后缀与 null 传播。须保持 ADR-0004 利润口径。

## 顺序

- Claude：T1 → C1 → C2 → T2/T3 → C4 → C6/C3 → C7 → C8 → C5
- Codex：C1 → C2 → C6 → C8 → C4 → C5 → C3 → C7
- 共识：T1 / C1 第一，C2 紧随。

## Batch 6 进度（2026-11-07）

- T3 已复现并修复：控制台 live 密码登录的成功结果写入失败时，旧实现已提交快照（revision 1 → 2）；回归测试现断言快照、账号资料、人工状态及待办整体回滚，尝试时间仍保留。
- C6：`beginReloginAttempt` 统一尝试记录、失败抛错和原子成功提交；使用草稿 tx，提交失败时内存 revision/state/metadata/corrupt 同样保持原值。控制台预检复用带 manual/decrypt 选项的 `decideRelogin`，扫码保留原有封禁语义。
- C3 安全子集：`merchant-session.js` 集中 command/patrol/login/report/snapshot 策略及巡检无浏览器第一阶段；doctor 保持只读。fixture 的免记录预检与独立浏览器编排保留并集中复用，跨进程恢复仍依赖 marker；marker 构造/识别已下沉 adapter。成功恢复改经 `verifyMerchantContext` 生成带品牌候选，再走正式提交与 metadata/corrupt 维护，删除旧 `commitFixtureRelogin` 直接写入路径。
- 保留账号租约/CAS、巡检两次记录与 revision=3、90s 重登预算及 runtime getter 截止时间恢复、last_check/重登/待办转换和 envelope/data v2。定向验证：17 files / 339 passed；最终 `npm test`：`Test Files  112 passed (112)`，`Tests  2000 passed | 1 skipped (2001)`；全程离线 fixture/模拟传输，真实账密、验证码接管、巡检网络行为待账号验证。
