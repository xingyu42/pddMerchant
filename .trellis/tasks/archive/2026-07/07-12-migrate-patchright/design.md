# 迁移浏览器运行时到 Patchright：技术设计

## 1. 设计目标

在不改变 pdd-cli 外部命令与认证数据模型的前提下，将唯一生产 Chromium 驱动切换为 Patchright。迁移只改变 adapter 所拥有的浏览器运行时边界，不重构 runner、service、endpoint 或消费者代理策略。

## 2. 已确认约束

- 运行时保持 Node.js `>=18`、纯 JavaScript ESM、无构建步骤。
- 截至 2026-07-12，npm `patchright` 最新版为 `1.61.1`，依赖 `patchright-core@1.61.1`，engines 为 Node `>=18`。
- Patchright 只支持 Chromium；本仓库没有 Firefox/WebKit 生产路径。
- `ghost-cursor-playwright@2.1.0` 在运行时对 Page 使用鸭子类型，但其包内声明并携带 `playwright-core`。该传递依赖允许存在，但不能成为 pdd-cli 的 Chromium 入口。
- 当前工作区的 `src/adapter/browser.js`、`src/commands/doctor.js`、消费者登录和青果代理路径已有未提交修改；迁移必须在这些修改上增量完成。
- checkout 中不存在 `openspec/` 目录或可用的 `pdd-openspec-change-flow` 技能；本迁移保持公开能力不变，由当前 Trellis PRD/design/implement 记录设计与验收。

## 3. 边界与所有权

```text
commands/runner/services
        |
        v
src/adapter/browser.js  ----唯一 Patchright import----> patchright.chromium
        |
        +-- launchBrowser / withBrowser
        +-- createConsumerContext
        +-- getBrowserExecutablePath
        +-- lifecycle registry / cleanup
```

- `src/adapter/browser.js` 是浏览器运行时唯一所有者，也是生产代码中唯一允许导入 `patchright` 的文件。
- `src/commands/doctor.js` 不再直接导入任何浏览器包；它通过 adapter 导出的窄接口读取可执行文件路径。
- services 继续只消费 `{ browser, context, page }` 和 `createConsumerContext()`，不感知 Patchright。
- fixture adapter 保持短路真实浏览器路径，命令级离线测试不启动 Patchright。

## 4. 依赖设计

### 4.1 直接依赖

- 删除 `"playwright": "npm:rebrowser-playwright@..."`。
- 添加精确版本 `"patchright": "1.61.1"`。Patchright 版本与其驱动/浏览器协议绑定，精确 pin 用于避免普通安装时静默跨版本漂移。
- 通过正常 npm 安装更新 lockfile，不手工编辑依赖树。

### 4.2 允许的传递依赖

- `ghost-cursor-playwright` 当前会解析一个 `playwright-core`。这不代表主运行时回退；验收以生产源码无 `playwright` import、顶层 direct dependency 为 `patchright`、实际启动入口只有 adapter 为准。
- 若安装后 `ghost-cursor-playwright` 产生依赖冲突或运行时 Page 不兼容，先在现有行为模拟边界内修复或移除它；不引入第二套鼠标模拟库。

## 5. 浏览器配置设计

### 5.1 保留

- `chromium.launch({ headless: !headed })` 的现有调用语义。
- fresh `browser.newContext()` 模型。
- `storageState` 文件加载及 `saveAuthState()` 保存格式。
- `locale: 'zh-CN'`、`timezoneId: 'Asia/Shanghai'`、现有 viewport/deviceScaleFactor，避免在运行时迁移中顺带改变页面布局契约。
- 消费者 proxy 只传给对应 `browser.newContext()`。

### 5.2 删除或收敛

- 删除显式固定 Chrome 130 UA，让 Patchright/实际浏览器生成匹配的 UA 与 Client Hints。
- 删除项目注入的 `navigator.webdriver`、`window.chrome`、plugins、WebGL 和 Canvas 脚本，以及对应的 `PDD_FINGERPRINT_SEED` 配置、测试和专用文档。Patchright 已拥有驱动级补丁，继续页面级覆盖会制造不一致并触发其 init-script 差异面。
- 默认不再传递 `--disable-blink-features=AutomationControlled`；Patchright 自己拥有该默认参数策略。
- 删除没有被当前运行环境证明必需的 `--disable-gpu`、`--hide-scrollbars`、`--mute-audio` 等手工特征参数。`--no-sandbox`、`--disable-dev-shm-usage` 也不作为默认隐式参数保留；若后续部署环境确有需求，应作为独立、可验证的运行配置提出，而不是混入本迁移。

### 5.3 明确不采用

- 不使用 `launchPersistentContext()`。
- 不设置 `channel: 'chrome'`。
- 不强制 headed，不新增 `userDataDir`。
- 不自定义额外 HTTP headers。

## 6. 生命周期与认证兼容

- `launchBrowser()` 仍返回 `{ browser, context, page }`，调用方接口不变。
- `withBrowser()`、active browser registry 和 `closeAllBrowsers()` 保持既有清理语义。
- `createConsumerContext()` 继续返回带幂等 `close()` 的 `{ context, page }`。
- 认证继续由 `context.storageState({ path })` 产生 `{ cookies, origins }` JSON；不迁移或重写现有认证文件。
- 初始化流程减少 `addInitScript()` 后，相关失败清理测试改为覆盖 `newContext()`/`newPage()` 失败，不丢失 partial-init cleanup 契约。
- Patchright关闭部分 Console CDP 能力，但当前生产代码没有依赖 `page.on('console')`/`page.on('pageerror')`；不新增替代日志通道。

## 7. Doctor 与用户提示

- adapter 提供 `getBrowserExecutablePath()`；doctor 使用该接口检查浏览器安装情况。
- 为兼容 envelope，保留 `data.chromium` 字段和现有 `E_CHROMIUM_MISSING` 错误代码，避免对消费者造成无关破坏。
- 安装提示改为 `npx patchright install chromium`。
- human 文案可以说明“Patchright Chromium”，但不更改 JSON 字段名，字段重命名单独提案。

## 8. 数据流不变式

### 商家路径

```text
runner -> launchBrowser(storageState) -> merchant page
       -> auth/mall/endpoint/XHR -> saveAuthState/close
```

### 消费者直连路径

```text
merchant Browser -> fresh consumer Context(storageState)
                 -> source fetch -> close Context
```

### 消费者代理路径

```text
lease N -> fresh consumer Context(storageState, proxy N)
        -> success or classified failure -> close Context
```

迁移不改变三条路径的重试、冷却、认证删除或流量隔离语义。

## 9. 测试设计

### 静态与依赖验证

- `npm ls patchright patchright-core playwright playwright-core --depth=2`
- 扫描生产代码，确认只有 `src/adapter/browser.js` 导入 `patchright`，且无生产 `playwright` import。
- 检查 lockfile 变更只来自依赖替换及 `ghost-cursor-playwright` 的合理传递依赖。

### 定向自动化测试

- 浏览器配置/清理：`test/adapter/browser-consumer-context.test.js`、`test/pbt/with-browser.pbt.test.js`、`test/pbt/browser-registry.pbt.test.js`。
- auth：`test/auth-state.unit.test.js`、`test/auth-state-v03.unit.test.js`、`test/auth-refresher-lifecycle.unit.test.js`、相关 PBT。
- doctor：`test/doctor-render.unit.test.js`，并新增/调整可执行文件检查单元测试。
- transport：`test/endpoint-route-cleanup.unit.test.js`、`test/endpoint-lifecycle-cleanup.unit.test.js`、`test/pbt/xhr-collector.pbt.test.js`。
- goods publish：`test/goods-publish.unit.test.js`、`test/goods-publish.e2e.test.js`、`test/pbt/goods-publish.pbt.test.js`。
- architecture/output：`test/layering-guard.unit.test.js`、`test/json-purity.test.js`。

### 完整门禁

- `npm test`。
- `npm run lint` 可运行但只是 `echo no-lint`，不得宣称为真实 lint。
- `npm audit --omit=dev` 记录新增运行时依赖的已知漏洞状态。
- 不在自动测试中访问真实 PDD；真实账号 smoke 需要另行明确授权，并遵守首个降级信号即停止。

## 10. 文档迁移

- README 安装、架构简介、错误恢复提示。
- `.env.example` 删除 `PDD_FINGERPRINT_SEED`。
- `docs/architecture-overview.md` 更新运行时与指纹说明。
- 删除或改写 `docs/fingerprint-seed-guide.md`，避免继续推荐已移除的配置。
- 保留 `PlaywrightEndpointClient` 等内部类型名称；它描述 Playwright-compatible Page API，不属于本任务必须重命名的外部契约。

## 11. 风险与回滚

| 风险 | 控制 |
| --- | --- |
| Patchright init/evaluate 行为差异 | 删除手工 init script；运行 evaluate、route、XHR 定向测试 |
| ghost-cursor Page 兼容性 | 单元测试行为模拟；确认其运行时代码不导入 `playwright-core` |
| lockfile 意外大幅变化 | 安装后逐项检查依赖 diff 与 `npm ls` |
| 当前脏工作区重叠 | 先记录现有 diff；只增量编辑，不回退 browser/doctor/auth/goods-publish 改动 |
| 浏览器二进制缺失 | doctor 窄接口检查并给出 Patchright 安装命令 |
| 回归影响商家/消费者共同路径 | targeted tests 后运行完整 `npm test` |

回滚不需要迁移用户数据：恢复依赖、browser adapter、doctor 与文档即可，既有 storageState 保持可用。
