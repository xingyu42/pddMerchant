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
- **fixture 模式**：`PDD_TEST_ADAPTER=fixture` 用原始上游响应替换传输层，判定与归一化照常执行。
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
src/commands/              registry/ 注册命令树；handler 多为 withCommand() 薄封装
  ├── runner/              withCommand 内部：账号、超时、浏览器、鉴权、店铺、envelope
  └── option-parsers.js    commander 解析期校验
src/daemon/                常驻控制台 HTTP 服务（由 `pdd daemon run` 进入）
    ↓
src/services/              领域编排；views/ 负责输出投影与中文标签
    ↓
src/adapter/               Patchright、endpoint 传输、鉴权、店铺上下文、fixture
    ↓
src/infra/                 envelope、错误、日志、配置、SQLite 存储、单位换算
```

- 只允许向下依赖：infra 不 import 上层，adapter 不 import services，services 不 import commands。
- 现存的跨层直连（向下，允许）：`bin/pdd.js` 引用 `commands/runtime-options.js` 与 `adapter/browser.js` 的 `closeAllBrowsers`；runner、`doctor.js`、`login.js` 直接使用 adapter（浏览器、鉴权、店铺、fixture）；`commands/daemon.js` 引用 `src/daemon/run.js`；`src/daemon/` 只依赖 services。
- `src/services/views/` 只依赖 infra（`units`、`metrics`）与 `services/operating-report.js`。
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
core.js      → init / login / doctor
config.js    → config show / set / unset / validate
shops.js     → shops list / current
orders.js    → orders list / detail / stats
goods.js     → goods list / stock / segment / traffic / profit / receipt / templates / publish
               goods cost list / set / remove / import
               goods update status / price / stock / title / batch
promo.js     → promo roi
diagnose.js  → diagnose shop / orders / inventory / promo / after-sales
               diagnose experience / customer-service / reviews / traffic
account.js   → account add / remove / list / default
daemon.js    → daemon start / stop / restart / status / run
console.js   → console link
```

新增命令只需改命令文件与对应 registrar。

### 3.2 命令层与 Runner (`src/commands/`)

- 多数 handler 是 `withCommand({ name, needsAuth, needsMall, needsBrowser, needsAccount, allowAllAccounts, run, render })` 的薄封装；`init`、`login`、`account`、`config` 直接 `emit()`，不经 runner。
- `_runner.js` 是 facade，实现在 `runner/`：

| 文件 | 职责 |
| --- | --- |
| `single-lifecycle.js` | 单账号执行：`resolveAccount` → `armDeadline` → 三选一（无浏览器 / fixture / live） |
| `batch-executor.js` | `--all-accounts`（仅 `needsAuth`）逐账号执行、抖动间隔、SIGINT 中断、限流冷却归因 |
| `fixture-runtime.js` | fixture 路径：fixture 会话核验、mock 店铺、`buildCommandCtx`（ctx 字段单一来源） |
| `envelope-finalizer.js` | `finalizeSuccess` / `finalizeError` / `emitOnce`，产出 envelope |

- **live 路径**：`withMerchantAuthUpdate`（账号租约）→ `withBrowser` → `checkMerchantSession`（被拒时尝试密码重登）→ 打开商家首页 → 解析/切换店铺 → `createPageSession` + 共享 endpoint client → `run(ctx)` → 关闭页面 → 复核并持久化登录态 → `finalizeSuccess`。
- **解析期校验** (`option-parsers.js`)：`integerArg(min, max)`、`goodsIdListArg`、`withReportDays`、`Option.choices`；非法值在启动浏览器前以 `E_USAGE` 拒绝。

### 3.3 服务层 (`src/services/`)

| 领域 | 模块 |
| --- | --- |
| 订单 | `orders.js` |
| 商品 | `goods.js`（读）、`goods-write.js`（改价/库存/状态/标题/批量）、`goods-segmentation.js`、`goods-sales-matcher.js`、`pricing-validator.js` |
| 商品发布 | `goods-publish.js`、`goods-publish-source-cache.js`、`image-transform.js` |
| 推广 | `promo.js`、`promo-roi.js` |
| 诊断 | `diagnose/`（订单、库存、推广、售后、趋势比较） |
| 经营报表 | `operating-report.js`（报表声明与 days 规则）、`report-windows.js`、`traffic.js`、`goods-traffic*.js`、`customer-service.js`、`reviews.js`、`experience.js` |
| 成本与利润 | `goods-cost*.js`（本地 SQLite 成本）、`goods-profit*.js`（ADR 0004） |
| 预估实收 | `goods-receipt.js`（价格管理页的平台估算值，口径见 GLOSSARY） |
| 鉴权与会话 | `auth.js`（登录流程）、`auth-account-storage.js`（登录态保存）、`merchant-session.js`（命令与巡检的会话核验单一入口）、`password-relogin.js` |
| 账号 | `shops.js`、`account-removal.js`、`doctor-storage.js` |
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
  → PlaywrightEndpointClient.execute               endpoint-client.js：限速、冷却、429 重试
    → send(spec, params, ctx)
        fixture 模式：mockRunEndpoint → 原始上游响应
        page-api：page-api-client.js（页面内签名请求，不捕获 XHR）
        fetch / legacy：endpoint-attempt.js + xhr-collector.js（route 或导航 + trigger + 捕获）
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

- 商家鉴权：`merchant-auth.js`、`merchant-auth-probe.js`、`merchant-auth-storage.js`（租约 + revision CAS 持久化）、`password-login.js` / `password-credential.js`；消费者：`consumer-qr-login.js`、`consumer-identity.js`。
- 店铺上下文：`mall-reader.js` 探测链 mock → state → url → cookie → storage → xhr → dom；`mall-writer.js` 切换店铺，`mall-switcher.js` 为 re-export。
- fixture：`mock-dispatcher.js` 是 facade，`fixtures/core.js` 拥有唯一 fixture cache，`fixtures/endpoint.js` 按 `endpoints/<spec.name>[.<variant>|.page<N>].json` 查找原始响应。

#### 3.4.4 商品发布子模块 (`adapter/goods-publish/`)

| 文件 | 职责 |
| --- | --- |
| `source-scraper.js` | 从消费端商品页抓取源数据（结构化 SKU 维度、属性、价格、图片） |
| `qingguo-proxy.js` | 仅用于源商品抓取的青果代理（ADR 0001） |
| `category-resolver.js` | 外部类目 API 解析类目搜索文本 |
| `form-filler.js` | 商家发布表单填充 |
| `property-mapper.js` / `dynamic-property-template.js` | 源属性与平台模板匹配、动态属性收敛 |
| `source-sku-normalizer.js` | 源 SKU 结构归一化 |
| `image-handler.js` | 图片下载与上传 |
| `risk-detector.js` | 风控弹窗检测 |

#### 3.4.5 常驻进程相关

`daemon-process.js`（后台进程启动）、`takeover.js` / `takeover-dialog.js`（控制台 CDP 接管登录页面）、`latest-frames.js`（画面帧缓存）。

### 3.5 基础设施层 (`src/infra/`)

| 模块 | 职责 |
| --- | --- |
| `output.js` / `errors.js` | envelope 合约、`PddCliError`、退出码映射 |
| `logger.js` | pino + `REDACT_KEYS` 指纹脱敏 |
| `config.js` / `config-management.js` | 配置三层合并（示例基线 → `config.json` → 环境变量）与 zod 校验 |
| `paths.js` | 数据、配置、日志、缓存路径 |
| `db.js` / `master-key.js` / `secret-box.js` | SQLite schema 与迁移、主密钥、登录态加密 |
| `account-store.js` / `account-resolver.js` / `consumer-account-resolver.js` | 账号存取与 `--account` 解析 |
| `leases.js` / `daemon-state.js` | 账号租约、daemon 单实例状态 |
| `goods-cost-store.js` | 商品成本表 |
| `units.js` / `metrics.js` | 分转元、百分比、时间格式与指标投影 |
| `circuit-breaker.js` | 商品发布各阶段的熔断器 |
| `scrape-cooldown.js` / `session-health.js` / `rate-control.js` | 源抓取软封冷却与会话健康评分、写操作限速 |
| `timeouts.js` / `abort.js` | 超时预算与 AbortController 封装 |

---

## 四、常驻 Daemon 与 Web 控制台

- `pdd daemon start|stop|restart|status` 管理后台进程，`pdd daemon run` 前台运行；`pdd console link` 签发控制台登录链接。详见 ADR 0003。
- `src/daemon/`：`server.js`、`routes.js`、`http.js`、`sse.js`（画面推送）、`static.js`（提供 `src/console/public` 静态前端）、`run.js`（组装运行时与巡检）。
- 控制台支持账号状态查看、密码保存、通过 CDP 接管完成扫码/验证码登录；可选巡检（`patrolEnabled`）定期核验商家会话。
- daemon 以 SQLite 租约保证单实例；普通命令、`login`、`doctor` 不启动也不依赖它。

---

## 五、商品发布流程

`publishGoodsFromLink(ctx, goodsUrl, options)`（`services/goods-publish.js`）：

1. 解析商品链接，读取源商品缓存；未命中时用消费者登录态抓取并写入缓存。
2. 校验源数据与 SKU 图片证据。
3. 用外部类目 API 解析类目搜索文本，在商家页面选择类目并创建草稿。
4. 解析运费模板，加载属性模板，构建定价与属性计划，填充表单。
5. 动态属性最多 5 轮收敛；关闭尺码表、写入满件折扣（`fullCountDiscountRate`，默认 0.95）。
6. 严格校验保存请求后保存草稿；仅在 `--confirm` 时提交发布。

fixture 模式下发布流程在服务层短路。

---

## 六、测试架构

### 6.1 目录

```
test/
├── setup.js                 # 全局开启 fixture 模式与临时 DB，禁止真实 patchright 与 fetch
├── adapter/ commands/ console/ daemon/ infra/ services/   # 分层测试
├── contract/                # data-contract-v2.test.js 覆盖全部注册命令
├── e2e/*.e2e.test.js        # fixture 模式下 spawn CLI 子进程
├── fixtures/test-data.js    # 合成 fixture 构造器
└── helpers/                 # isolated-cli（runCli 沙箱）、data-contract 检查器等
```

Vitest 按 `test/**/*.test.js` 自动发现。

### 6.2 Fixture 模式

- `PDD_TEST_ADAPTER=fixture` 时，endpoint client 的 `send()` 改为读取原始上游响应，之后的成功判定、错误映射和 `normalize` 与真实模式相同；`page` 为 `null`。
- 文件名：`endpoints/<spec.name>.json`；分页 `.page<N>.json`（缺失的后续页由 `fixtureListKey` 合成空页）；声明 `fixtureVariantKey` 的 spec 优先读 `.<变体值>.json`。`__throws` 注入业务错误。
- `isolated-cli.js` 把 fixture 写入临时沙箱目录并通过 `PDD_TEST_FIXTURE_DIR` 传给子进程。

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

### 7.2 直接读取的环境变量

| 变量 | 用途 |
| --- | --- |
| `PDD_DB_PATH` | SQLite 路径（默认 `data/pdd.db`，`master.key` 同目录） |
| `PDD_DEBUG_RAW` | 把归一化前的原始 payload 以脱敏 JSONL 写到 stderr |
| `PDD_SCRAPE_SIMULATE` | 源抓取人类行为模拟（默认开启） |
| `PDD_IMAGE_TRANSFORM` | 发布图片处理开关 |
| `PDD_SOURCE_PROXY_PROVIDER` / `PDD_QINGGUO_AUTH_KEY` / `PDD_QINGGUO_AREA` | 源抓取代理（仅 `qingguo`） |

### 7.3 测试专用

`PDD_TEST_ADAPTER`、`PDD_TEST_FIXTURE_DIR`、`PDD_TEST_AUTH_INVALID`、`PDD_TEST_AUTH_INDETERMINATE`、`PDD_TEST_CONSUMER_AUTH_INVALID`、`PDD_TEST_PASSWORD_LOGIN*`、`PDD_TEST_PATROL_INTERVAL_MS`、`PDD_TEST_DAEMON_*`。

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
- `PDD_DB_PATH` 覆盖数据库位置，主密钥始终与数据库同目录；两者都是敏感文件，勿提交，备份恢复须成对保留。
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
| 0001 | 青果代理只用于源商品抓取 |
| 0002 | 严格的 headless 一致性浏览器配置 |
| 0003 | 重新引入显式启动的 daemon 控制台 |
| 0004 | 商品利润报表口径 |

领域术语见根目录 `GLOSSARY.md`；分层与运行时契约见 `.trellis/spec/architecture/`。

---

## 十二、开发规范

- 函数 < 50 行，嵌套 ≤ 3 层，禁用单字母变量（循环计数器除外）。
- `const` 优先，只用 `async/await`（禁止 `.then()` 链）。
- 提交使用带 emoji 的 Conventional Commits：`✨ feat` / `🐛 fix` / `🔧 chore` / `📝 docs` / `♻️ refactor` / `✅ test`。

---

**更新时间**: 2026-11-08
**适用版本**: pdd-cli 0.6.0
