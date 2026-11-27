# pddMerchant 项目架构总览

> 拼多多商家后台 CLI 工具 · 复用商家前端运行时的 Patchright 浏览器自动化
>
> **技术栈**: Node.js ≥ 24 ESM + Commander + Patchright + 内置 SQLite + Vitest
> **核心特性**: 无 TypeScript、无构建步骤，`node bin/pdd.js` 直接运行

---

## 一、项目概览

### 1.1 核心定位

用 Patchright 驱动 Chromium 打开商家后台，在页面内复用商家前端的签名请求客户端（`page-api`）调用业务接口，少数端点用 route / XHR 捕获；结果统一为 **AI 友好的 JSON envelope**（`{ ok, command, data, error, meta }`）。报表只输出事实，不生成经营建议或评分。

### 1.2 关键特性

- **无构建步骤**：ESM 直接运行。
- **统一输出与错误**：envelope v2 + `data` 契约 v2，退出码 0–7，`PddCliError`。
- **fixture 模式**：`PDD_TEST_ADAPTER=fixture`（或在组合根传入 `mode: 'fixture'`）切换至 `fixture-bundle.js` 与 `fixtures/` 提供方，用原始上游响应替换传输层，判定与归一化照常执行。
- **日志脱敏**：`REDACT_KEYS` 指纹化敏感字段。
- **限流保护**：429 按 `[1000, 2000, 4000] ms` 重试；同一 endpoint 连续 `cooldownThreshold` 次限流后冷却 `cooldownMs`（默认 3 次 / 5 分钟）。
- **多账号**：账号与加密登录态存 SQLite，`--account` / `--all-accounts` 选择执行范围。
- **可选常驻控制台**：`pdd daemon` 显式启动 Web 控制台与巡检；普通命令从不依赖它。

---

## 二、分层架构

### 2.1 依赖流向

```
bin/pdd.js                 CLI 入口：全局选项、信号/fatal 处理、wireAction
    ↓
src/runtime/               双顶层组合根（composeCommandRuntime / composeDaemonRuntime）、白名单 env、Live/Fixture Bundle
    ↓
src/commands/              registry/ 注册命令树；handler 均为 withCommand() 薄封装
  ├── runner/              withCommand 内部：envelope-kernel、账号、超时、浏览器、鉴权、店铺、fixture-runtime
  └── option-parsers.js    commander 解析期校验
src/daemon/                常驻控制台 HTTP 服务（由 `pdd daemon run` 进入）
    ↓
src/services/              领域编排；views/ 负责输出投影与中文标签
    ↓
src/adapter/               Patchright、endpoint 传输、鉴权、店铺上下文、fixture 提供方（fixtures/）
    ↓
src/infra/                 envelope、output-sink、错误、日志、配置、SQLite 存储、单位换算
```

- 只允许向下依赖：infra 不 import 上层，adapter 不 import services，services 不 import commands；`src/runtime/` 作为唯一组合根装配跨层 Port 与白名单 env，不向底层回传 env 直读权限。
- 现存的跨层向下直连（允许）：`bin/pdd.js` 引用 `commands/runtime-options.js`、`commands/_runner.js` 与 `infra/runtime-cleanup.js`；runner（`src/commands/runner/`）与 `src/runtime/` 使用 adapter（浏览器、鉴权、店铺、fixture）；`commands/daemon.js` 引用 `src/daemon/run.js`；`src/daemon/` 只依赖 `src/runtime/`、`src/services/` 与 infra。全部非 runner 命令 handler（含 `doctor.js`、`login.js`、`account.js`、`config.js`）均经 services 或 runtime 注入端口访问 adapter。
- `src/services/views/` 只依赖 infra（`units`、`metrics`）与 `services/operating-report.js`。
- **接缝抽象原则**：
  - **多实现才抽象 Port**：仅在真实存在至少两套适配器的外部边界引入 Port（如 `BrowserRuntimePort`、`AuthPort`、`MallPort`、`EndpointTransportPort`、`DaemonProcessPort`、`ConsoleLoginDriverPort`、`CategoryResolverPort`、`MerchantDraftEditorPort`）。
  - **SQLite 保持本地可替代（Local-substitutable）内部接缝**：数据库与存储模块（`db.js`、`account-store.js`、`daemon-state.js`、`goods-cost-store.js`、`leases.js`）直接通过 `PDD_DB_PATH` 在进程或单测间隔离替换，不为单一本地实现包裹冗余仓储 Port。
- **守卫**：原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前靠 review 约束。

---

## 三、核心模块详解

### 3.1 CLI 入口 (`bin/pdd.js`)

- Node ≥ 24 守卫；SIGINT/SIGTERM → 关闭浏览器并以 130/143 退出；未捕获异常输出 envelope。
- 全局选项：`--json`、`--no-color`、`--timeout`、`--mall`、`--headed`、`--verbose`、`--account`、`--consumer-account`、`--all-accounts`。
- `wireAction(cmd, name, runFn, { runtimeConfigPolicy })`：合并全局选项、加载运行配置并初始化日志（`prepareCommandRuntime`），再调用 handler。
- commander 用法错误（未知选项、`invalidArgument` 等）在 `exitOverride` 中转为 `E_USAGE` envelope，退出码 2，不进入 runner。

**命令域注册器** (`src/commands/registry/`，`register(program, wireAction)`)：

```
core.js      → login / doctor
config.js    → config show / set / unset / validate
shops.js     → shops list
orders.js    → orders list / detail / stats / after-sales
goods.js     → goods list / segment / traffic / profit / receipt / reviews / templates / publish
               goods cost list / set / remove / import
               goods update status / price / stock / title / batch
promo.js     → promo roi
diagnose.js  → diagnose shop / experience / customer-service / reviews / traffic
account.js   → account remove / list / default
daemon.js    → daemon start / stop / restart / status / run / link
```

新增命令只需改命令文件与对应 registrar。

### 3.2 命令层与 Runner (`src/commands/`)

- 全部命令 handler（含 `login`、`doctor`、`account`、`config`）都是 `withCommand({ name | command, lifecycle, needsAuth, needsMall, needsBrowser, needsAccount, allowAllAccounts, defaultTimeoutMs, run, render })` 的薄封装，经统一 `envelope-kernel` 完成预设校验（`merchant` / `local` / `maintenance`）、超时预算与单次发射。
- `_runner.js` 是 facade，实现在 `runner/`：

| 文件 | 职责 |
| --- | --- |
| `envelope-kernel.js` | 生命周期预设校验、动态命令名、协作超时预算与单次发射守门 |
| `single-lifecycle.js` | 单账号执行：`resolveAccount` → `armDeadline` → 三选一（无浏览器 / `runtime.mode === 'fixture'` / live） |
| `batch-executor.js` | `--all-accounts`（仅 `needsAuth`）逐账号执行、抖动间隔、SIGINT 中断、限流冷却归因 |
| `command-ctx.js` | `buildCommandCtx` 与行动/守护进程告警附加（`appendActionWarnings`） |
| `fixture-runtime.js` | fixture 路径：消费注入端口或 `FixtureStore` / `fixtures/` 跑完整命令生命周期 |
| `envelope-finalizer.js` | `finalizeSuccess` / `finalizeError` / `emitOnce`，依托 `OutputSink` 产出 envelope |

- **顶层组合根 (`src/runtime/`)**：
  - `env.js`（`parseRuntimeEnv`）：在组合根边界唯一解析并冻结白名单 `PDD_*` / `PDD_TEST_*` 环境变量，`live` 模式忽略 `PDD_TEST_*`。
  - `command-runtime.js`（`composeCommandRuntime`）：按 `mode`（`'live'` | `'fixture'`）动态加载 `bundles/live-bundle.js` 或 `bundles/fixture-bundle.js`，装配 `ports`、`OutputSink`、`clock`、`seal`、`endpointState`、`scrapeCooldown` 与 `scopeRuntime`/`closeAll`（live 不加载 fixture 模块，fixture 不加载 `patchright`）。
  - `daemon-runtime.js`（`composeDaemonRuntime`）：为守护进程与控制台组装同构 `ports`、`consoleApp`、`consoleExtraRoutes`、`routes` 与生命周期操作。
- **live 路径**：`withMerchantAuthUpdate`（账号租约）→ `withBrowser` → `checkMerchantSession`（被拒时尝试密码重登）→ 打开商家首页 → 解析/切换店铺 → `createPageSession` + 共享 endpoint client → `run(ctx)` → 关闭页面 → 复核并持久化登录态 → `finalizeSuccess`。
- **解析期校验** (`option-parsers.js`)：`integerArg(min, max)`、`goodsIdArg`、`goodsIdListArg`、`starsArg`、`withReportDays`、`Option.choices`；非法值在启动浏览器前以 `E_USAGE` 拒绝。

### 3.3 服务层 (`src/services/`)

| 领域 | 模块 |
| --- | --- |
| 订单、售后与分页 | `orders.js`（含跨领域订单窗采集 `collectOrdersWindow`）、`after-sales.js`、`logistics.js`、`pagination.js`（可中止有界分页原语 `collectBoundedPages`） |
| 商品 | `goods.js`（读）、`goods-write.js`（改价/库存/状态/标题/批量）、`goods-segmentation.js`、`goods-sales-matcher.js` |
| 商品发布 | `goods-publish.js`、`goods-publish/source-product-fetcher.js`（`SourceProductFetcher`）、`goods-publish/source-normalizer.js`、`goods-publish/draft-planner.js`、`goods-publish/draft-guard.js`、`goods-publish-source-cache.js` |
| 推广 | `promo.js`（统一导出 `getPromoReport`、`analyzePromoRoi`、`getPromoRoiView`） |
| 诊断 | `diagnose/`（订单、库存、推广、售后、商品采集 `collectAllGoods`、趋势比较与 `summarize*` 纯函数面） |
| 经营报表 | `operating-report.js`（报表声明与 days 规则）、`report-windows.js`、`traffic.js`、`goods-traffic*.js`、`customer-service.js`、`reviews.js`、`experience.js` |
| 成本与利润 | `goods-cost*.js`（本地 SQLite 成本）、`goods-profit.js`（唯一公开视图入口 `getGoodsProfitView`，私有计算/保险/推广子模块内部化，ADR 0004） |
| 预估实收 | `goods-receipt.js`（价格管理页的平台估算值，口径见 GLOSSARY） |
| 鉴权与会话 | `auth.js`（登录流程）、`auth-account-storage.js`（登录态保存）、`merchant-session.js`（命令与巡检的会话核验单一入口）、`relogin-policy.js`、`auto-relogin.js` |
| 店铺、账号、配置与诊断 | `shops.js`、`account.js`（含预演/级联移除）、`config.js`（受管配置校验与读写）、`doctor.js`（`diagnoseEnvironment`，单次按需浏览器核验） |
| 常驻控制台 | `daemon.js`、`daemon-runtime.js`、`patrol.js`、`console-*.js` |

**领域视图** (`services/views/`)：白名单投影、分转元、比率百分数、中文枚举标签与 headline；view 自有词表放在各自文件，共享词表在 `labels.js`，投影辅助在 `_shared.js`。上游对象与 PII 不进入 `data`。

### 3.4 适配器层 (`src/adapter/`)

#### 3.4.1 浏览器 (`browser.js`)

- `launchBrowser({ headed, storageState, ownerTag })`：优先系统 Chrome，仅在明确缺失时回退 Patchright Chromium；`withBrowser(options, fn)` 负责注册与关闭。
- headless 使用 **Headless Consistency Profile**（ADR 0002）：由浏览器版本推导 UA，固定 viewport 1902×984、screen 1920×1080、DPR 1、`zh-CN`、`Asia/Shanghai`，只覆写 `outerWidth`、`outerHeight`、`availHeight` 三个 getter；`--headed` 保持桌面自然环境。
- 人类行为模拟（`behavior-simulator.js`）只用于源商品抓取，`PDD_SCRAPE_SIMULATE=0` 关闭。

#### 3.4.2 Endpoint 传输

```
runEndpoint(page, SPEC, params, ctx)                  run-endpoint.js（共享 client 的薄包装）
  → EndpointClient.execute                         endpoint-client.js：限速、冷却、429 重试
    → EndpointTransportPort.send(spec, params, ctx)
        fixture 模式：createFixtureEndpointTransport → 原始上游响应
        page-api：page-api-client.js（页面内签名请求，不捕获 XHR）
        fetch / legacy：endpoint-attempt.js + xhr-collector.js（共享 endpoint-pages.js 预算裁剪导航 + trigger + 捕获）
    → interpretResponse(spec, …)                     response-interpreter.js：成功判定、限流识别、业务错误映射
    → spec.normalize(raw, params)                    形状校验与稳定结构
```

- 策略由 `endpoint-strategy-resolver.js` 决定；`page-session.js` 的 `createPageSession()` 在同一规范化 URL 1 秒内重复导航时自动开 sibling page。
- **endpoint spec**（`adapter/endpoints/*.js`）常用字段：`name`（同时是 fixture 文件名）、`strategy`、`nav.url`、`apiUrl`、`buildPayload(params, ctx)`、`normalize(raw, params)`、`successRule`、`errorMap` / `errorMapper`、`fixtureListKey`、`fixtureVariantKey`。

```javascript
export const ORDER_LIST = {
  name: 'orders.list',
  fixtureListKey: 'result.pageItems',
  strategy: 'page-api',
  nav: { url: PDD_HOME },
  apiUrl: '/mangkhut/mms/recentOrderList',
  buildPayload: (params = {}) => ({ ...resolveScope(params.scope), pageNumber: params.page ?? 1, /* … */ }),
  normalize: (raw) => {
    const result = readListResult(raw);            // 缺字段抛 responseShapeError，不降级为 0
    return { total: result.totalItemNum, orders: result.pageItems, raw };
  },
  successRule: { mode: 'flag' },
};
```

#### 3.4.3 鉴权与店铺上下文

- 商家鉴权：`auth-port.js`（`AuthPort`）、`merchant-auth.js`、`merchant-auth-probe.js`、`merchant-auth-storage.js`（租约 + revision CAS 持久化）、`password-login.js` / `password-credential.js`、`interactive-login.js`；消费者：`consumer-qr-login.js`、`consumer-identity.js`。
- 店铺上下文：`mall-port.js`（`MallPort`）、`mall-reader.js` 探测链 mock → state → url → cookie → storage → xhr → dom；`mall-writer.js` 切换店铺。
- fixture 提供方（`src/adapter/fixtures/`）：由 `src/runtime/bundles/fixture-bundle.js` 按实例注入；`fixtures/core.js` 拥有按实例持有的 `FixtureStore` 缓存，`fixtures/endpoint.js` 按 `endpoints/<spec.name>[.<variant>|.page<N>].json` 查找原始响应，`fixtures/{auth,browser,daemon,goods-publish,mall}.js` 提供对应仿真端口。

#### 3.4.4 商品发布子模块 (`adapter/goods-publish/`)

| 文件 | 职责 |
| --- | --- |
| `source-scraper.js` | 消费端商品页浏览器观测（提取原始 SKU 维度、属性、价格、图片与风控状态） |
| `qingguo-proxy.js` | 仅用于源商品抓取的青果代理（ADR 0001） |
| `category-resolver.js` | 实例级 `CategoryResolverPort`，外部类目 API 解析类目搜索文本 |
| `merchant-draft-editor.js` | `MerchantDraftEditorPort`（`openDraft` / `populateAndSaveDraft` / `submitDraft`）与声明式 `DraftSession` |
| `draft-editor/` | 商家发布表单填充私有子模块（类目建草稿、SKU/媒体、属性与终态、保存路由、私有可中止写节流） |
| `property-template.js` / `dynamic-property-template.js` | 平台属性模板归一化、动态属性投影与合并 |
| `image-handler.js` | 图片下载与上传 |
| `risk-detector.js` | 风控弹窗检测 |

#### 3.4.5 常驻进程相关

`daemon-process.js`（后台进程启动）、`takeover.js` / `takeover-dialog.js`（控制台 CDP 接管登录页面）、`latest-frames.js`（画面帧缓存）、`console-login-driver.js` / `console-login-fixture.js`（`ConsoleLoginDriverPort` Live/Fixture 适配器）。

### 3.5 基础设施层 (`src/infra/`)

| 模块 | 职责 |
| --- | --- |
| `output.js` / `output-sink.js` / `errors.js` | envelope 合约、单次发射 `OutputSink`、`PddCliError`、退出码映射 |
| `logger.js` | pino + `REDACT_KEYS` 指纹脱敏 |
| `config.js` / `config-management.js` | 配置三层合并（示例基线 → `config.json` → 环境变量）与 zod 校验 |
| `paths.js` / `path-slug.js` / `runtime-cleanup.js` | 数据/配置/日志/缓存路径、slug 规整、进程清理钩子 |
| `db.js` / `master-key.js` / `secret-box.js` | SQLite schema 与迁移、主密钥、登录态加密（local-substitutable 内部存储接缝） |
| `account-store.js` / `account-resolver.js` / `consumer-account-resolver.js` | 账号存取与 `--account` 解析 |
| `leases.js` / `daemon-state.js` | 账号租约、daemon 单实例状态 |
| `goods-cost-store.js` | 商品成本表 |
| `units.js` / `metrics.js` | 分转元、百分比、时间格式与指标投影 |
| `scrape-cooldown.js` | 源抓取软封冷却（实例级注入，消费端抓包与消费端登录共用） |
| `timeouts.js` / `abort.js` / `clock.js` / `candidate-seal.js` / `auth-task.js` | 超时预算、`AbortController`、可注入时钟、候选密封与鉴权任务校验 |

---

## 四、常驻 Daemon 与 Web 控制台

- `pdd daemon start|stop|restart|status` 管理后台进程，`pdd daemon run` 前台运行；`pdd daemon link` 签发控制台登录链接。详见 ADR 0003。
- `src/daemon/`：`server.js`、`routes.js`、`http.js`、`sse.js`（画面推送）、`static.js`（提供 `src/console/public` 静态前端）、`run.js`（组装运行时与巡检）。
- 控制台支持账号状态查看、密码保存、通过 CDP 接管完成扫码/验证码登录；可选巡检（`patrolEnabled`）定期核验商家会话。
- daemon 以 SQLite 租约保证单实例；普通命令、`login`、`doctor` 不启动也不依赖它。

---

## 五、商品发布流程

`publishGoodsFromLink(ctx, goodsUrl, options)`（`services/goods-publish.js`，经 `GoodsPublishPort = { sourceFetcher, categoryResolver, draftEditor }` 编排）：

1. 解析商品链接并通过 `SourceProductFetcher.prepare` 读取源商品缓存；检查运费模板；缓存未命中时用消费者登录态抓取并写入缓存。
2. 校验源数据、SKU 颜色预览图与定价计划（建草稿前纯规划 `planPreDraftPublish`）。
3. 经 `CategoryResolverPort.resolve` 解析类目搜索文本，经 `MerchantDraftEditorPort.openDraft` 选择类目建草稿并提取绑定草稿 ID 的初始属性模板。
4. 构建初始属性计划（`buildInitialPropertyPlan`），由 `MerchantDraftEditorPort.populateAndSaveDraft` 驱动 `DraftSession` 填充表单、完成最多 5 轮动态属性收敛、停用尺码表、写入满件折扣（`fullCountDiscountRate`，默认 0.95）并严格校验保存请求与草稿详情。
5. 仅在 `--confirm` 时委托 `MerchantDraftEditorPort.submitDraft` 提交发布；保存/提交成功后清理源缓存。

fixture 模式下通过无磁盘空源缓存、内存冷却、合成源/类目/模板数据与内存 `DraftSession` 完整穿过上述规划与写安全校验。

---

## 六、测试架构

### 6.1 目录

```
test/
├── setup.js                 # 每测隔离临时 SQLite（PDD_DB_PATH）与 NO_COLOR=1，硬阻断 patchright 与 fetch（不全局注入 PDD_TEST_ADAPTER）
├── runtime/                 # composeCommandRuntime / composeDaemonRuntime 与 parseRuntimeEnv 组合根测试
├── adapter/ commands/ console/ daemon/ infra/ services/   # 分层测试
├── contract/                # data-contract-v2、command-docs、doc-paths、metric-tables 全仓守卫
├── e2e/*.e2e.test.js        # 子进程显式传入 PDD_TEST_ADAPTER=fixture 运行 CLI
├── fixtures/test-data.js    # 合成 fixture 构造器
└── helpers/                 # isolated-cli（runCli 沙箱）、test-ctx、in-memory-ports、data-contract 检查器
```

Vitest 按 `test/**/*.test.js` 自动发现。

### 6.2 无全局单例的组合根与 Fixture 测试接缝

- **进程内无单例测试接缝**：领域与集成测试通过 `composeCommandRuntime` / `composeDaemonRuntime`（显式注入 `mode`、`env`、`overrides`、`streams`、`clock`）、`createTestCtx`（`test/helpers/test-ctx.js`）及 `test/helpers/in-memory-ports.js` 内存端口双实现隔离运行，避免模块级全局状态、`vi.stubEnv('PDD_TEST_*')` 或跨层 `vi.mock`。
- **子进程 Fixture 模式**：`runCli` / `runCliAsync`（`test/helpers/isolated-cli.js`）为每个子进程生成独立沙箱目录与临时 `PDD_DB_PATH`，并在子进程环境显式传入 `PDD_TEST_ADAPTER=fixture` 与 `PDD_TEST_FIXTURE_DIR`。
- `mode: 'fixture'` / `PDD_TEST_ADAPTER=fixture` 时，endpoint client 注入 `createFixtureEndpointTransport` 读取原始上游响应，之后的成功判定、错误映射和 `normalize` 与真实模式相同；`page` 为 `null`。
- 文件名：`endpoints/<spec.name>.json`；分页 `.page<N>.json`（缺失的后续页由 `fixtureListKey` 合成空页）；声明 `fixtureVariantKey` 的 spec 优先读 `.<变体值>.json`。`__throws` 注入业务错误。

---

## 七、配置与环境变量

### 7.1 配置体系

`config/config.example.json`（基线）→ `config/config.json`（本地覆盖，不提交）→ `PDD_*` 环境变量，zod 校验；用 `pdd config show|set|unset|validate` 管理。

| 字段 | 环境变量 | 说明 |
| --- | --- | --- |
| `logLevel` | `PDD_LOG_LEVEL` | 日志级别 |
| `rateLimitQps` / `rateLimitBurst` | `PDD_RATE_LIMIT_QPS` / `_BURST` | endpoint 限速 |
| `cooldownThreshold` / `cooldownMs` | `PDD_COOLDOWN_THRESHOLD` / `_MS` | 连续限流冷却（示例 3 / 300000） |
| `passwordReloginMinIntervalMs` | `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS` | 密码重登最小间隔 |
| `consoleHost` / `consolePort` / `consolePublicUrl` | `PDD_CONSOLE_*` | 控制台监听与公开地址 |
| `patrolEnabled` / `patrolIntervalMs` | `PDD_PATROL_ENABLED` / `_INTERVAL_MS` | 巡检开关与间隔（≥ 5 分钟） |
| `writeRateTokensPerMinute` | `PDD_WRITE_RATE_TPM` | 写操作限速 |
| `scrapeSoftBlockThreshold` / `scrapeSoftBlockCooldownMs` | `PDD_SCRAPE_SOFTBLOCK_*` | 源抓取软封阈值与冷却（示例 2 / 7200000） |
| `categoryApiBase` / `consumerLoginUrl` | `PDD_CATEGORY_API_BASE` / `PDD_CONSUMER_LOGIN_URL` | 外部类目 API、消费者登录页 |
| `mallIdStrictParse` | `PDD_MALL_ID_STRICT_PARSE` | 严格校验店铺 ID |
| `fullCountDiscountRate` | `PDD_FULL_COUNT_DISCOUNT_RATE` | 发布时满件折扣 |
| `timeoutMs` / `defaultMall` | `PDD_TIMEOUT_MS` / `PDD_DEFAULT_MALL` | 可选：默认超时、默认店铺 |

### 7.2 组合根解析的环境变量（`src/runtime/env.js`）与存储路径

| 变量 | 用途 |
| --- | --- |
| `PDD_DB_PATH` | SQLite 路径（默认 `data/pdd.db`，`master.key` 同目录） |
| `PDD_DEBUG_RAW` | 把归一化前的原始 payload 以脱敏 JSONL 写到 stderr |
| `PDD_SCRAPE_SIMULATE` | 源抓取人类行为模拟（默认开启） |
| `PDD_IMAGE_TRANSFORM` | 发布图片处理开关 |
| `PDD_SOURCE_PROXY_PROVIDER` / `PDD_QINGGUO_AUTH_KEY` / `PDD_QINGGUO_AREA` | 源抓取代理（仅 `qingguo`） |

### 7.3 测试专用（仅 `mode === 'fixture'` 下由 `parseRuntimeEnv` 放行）

`PDD_TEST_ADAPTER`、`PDD_TEST_FIXTURE_DIR`、`PDD_TEST_AUTH_INVALID`、`PDD_TEST_AUTH_INDETERMINATE`、`PDD_TEST_CONSUMER_AUTH_INVALID`、`PDD_TEST_PASSWORD_LOGIN*`、`PDD_TEST_PATROL_INTERVAL_MS`、`PDD_TEST_DAEMON_*`；`live` 模式忽略上述测试变量。

---

## 八、数据持久化

```
data/
├── pdd.db                 # SQLite（WAL）：账号、加密登录态、租约、凭据、重登状态、待办动作、控制台令牌与会话、商品成本
├── master.key             # 自动生成的主密钥
└── scrape-cooldown.json   # 源抓取冷却状态
config/config.json         # 本地配置覆盖
log/cli/YYYY-MM-DD.log     # CLI 日志
log/daemon/                # daemon 日志
tmp/goods-publish-source-cache/   # 源商品缓存
```

- 表：`meta`、`accounts`、`auth_states`、`leases`、`credentials`、`relogin_states`、`pending_actions`、`console_tokens`、`console_sessions`、`goods_cost_entries`（`src/infra/db.js`）。
- `PDD_DB_PATH` 覆盖数据库位置（本地可替代内部接缝），主密钥始终与数据库同目录；两者都是敏感文件，勿提交，备份恢复须成对保留。
- 登录态 `{ cookies, origins }` 加密存入 SQLite，使用时在内存解密交给浏览器。认证更新先取账号租约，最终在短事务内按 revision CAS 提交；浏览器与网络等待在事务外。删除账号级联删除相关数据。

---

## 九、错误处理体系

### 9.1 退出码

| 码 | 含义 | 码 | 含义 |
| --- | --- | --- | --- |
| 0 | OK | 4 | RATE_LIMIT |
| 1 | GENERAL | 5 | NETWORK |
| 2 | USAGE | 6 | BUSINESS |
| 3 | AUTH | 7 | PARTIAL |

信号中断另有 130（SIGINT）/ 143（SIGTERM）；批量执行被 SIGINT 中断时为 130。

### 9.2 PddCliError 与 Envelope

```javascript
new PddCliError({ code: 'E_BUSINESS', message, hint, detail, exitCode: ExitCodes.BUSINESS });

{
  ok: false, command: 'goods.publish', data: null,
  error: { code: 'E_BUSINESS', message: '…', hint: '…' },
  meta: { v: 2, exit_code: 6, latency_ms: 0, xhr_count: 0, warnings: [], correlation_id: '…' }
}
```

- 只有 `meta.warnings` 可以增长；`meta.v` 固定为 2。成功时 `meta` 还带 `account`、`account_display_name`、`account_source`。
- 成功时 `data` 遵循契约 v2：恒为对象并含中文事实 `headline`；列表为 `{ headline, items, total, ... }`；键名 snake_case，金额 `_yuan`、比率 0–100 的 `_pct`、时间 `_at`（Asia/Shanghai），枚举为中文标签，缺失为 `null`。详见 `.trellis/spec/infra/envelope-errors-output.md`。

---

## 十、已知边界

### 10.1 商品发布实现边界

下表描述当前代码与自动化测试覆盖，不代表重新执行过生产实单发布验收。

| 功能 | 状态 | 影响 |
| --- | --- | --- |
| 单 SKU 商品 | ✅ 完整支持 | 可正常发布 |
| 多 SKU 规格配置 | ✅ 已验证（颜色/尺码） | 结构化 SKU 按规格值唯一匹配，逐行写入库存、拼单价和单买价；未知维度返回 `E_BUSINESS` |
| 商品详情图上传 | ✅ 已实现并验证 | 逐张等待独立完成响应；部分失败给警告，全部失败停止保存，临时文件始终清理 |
| 商品属性映射 | ✅ 已实现并验证 | 结构化源属性按实时平台模板唯一匹配；必填/重要属性失败关闭，可选属性非唯一时给部分告警 |
| 满件折扣配置 | ✅ 已实现并验证 | 统一配置 `fullCountDiscountRate`（默认 `0.95`），按 `9.5` 折写入并读回，保存请求严格校验 `two_pieces_discount: 95` |

### 10.2 兼容性边界

- `goods.list` 按 `goods_id`、`goodsId`、`id` 顺序映射商品主键；库存匹配保留按 `goods_name` 回退，输出标签「按商品名匹配（一侧缺少商品 ID）」是预期的兼容结果。
- `createPageSession()` 的 sibling page 机制避免页面复用漏掉 XHR，调用方不应绕过该 session。

---

## 十一、架构决策记录（`docs/adr/`）

| ADR | 主题 |
| --- | --- |
| [0001](adr/0001-scope-qingguo-proxy-to-source-fetch.md) | 青果代理只用于源商品抓取 |
| [0002](adr/0002-use-strict-headless-consistency-profile.md) | 严格的 headless 一致性浏览器配置 |
| [0003](adr/0003-reintroduce-explicit-daemon-console.md) | 重新引入显式启动的 daemon 控制台 |
| [0004](adr/0004-goods-profit-reporting-semantics.md) | 商品利润报表口径 |
| [0005](adr/0005-goods-reviews-deterministic-filtering.md) | 商品评价确定性过滤口径 |
| [0006](adr/0006-after-sales-case-and-reason-reporting.md) | 售后单与退款原因查询口径 |
| [0007](adr/0007-dual-composition-roots-and-local-substitutable-sqlite.md) | 双组合根与 SQLite 本地可替代接缝 |
| [0008](adr/0008-closed-command-lifecycle-presets.md) | 三态封闭命令生命周期预设与统一执行内核 |

领域术语见根目录 `GLOSSARY.md`；分层与运行时契约见 `.trellis/spec/architecture/`。

---

## 十二、开发规范

- 函数 < 50 行，嵌套 ≤ 3 层，禁用单字母变量（循环计数器除外）。
- `const` 优先，只用 `async/await`（禁止 `.then()` 链）。
- 提交使用带 emoji 的 Conventional Commits：`✨ feat` / `🐛 fix` / `🔧 chore` / `📝 docs` / `♻️ refactor` / `✅ test`。

---

**更新时间**: 2026-11-25
**适用版本**: pdd-cli 0.6.0
