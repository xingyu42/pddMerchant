# 03: `ConsoleLoginDriverPort`（Live / Fixture / InMemory 三适配器）与删除浅包装

**What to build:** 整文件移除直接改写裸 `session` 可变字段的 `console-login-browser` 薄包装，由 P1-4 向 `composeDaemonRuntime` 直接引入并注册清晰的外部端口 `ConsoleLoginDriverPort`（`openSession` → 全封装 `DriverSessionHandle`，含 `attemptPassword`、`captureQr`、`openTakeover`、`submitSmsCode`、`waitForAcquisition`、`verify`、`close`）与 Fixture 专用 `consoleExtraRoutes`（Live 模式恒为空集并遵循 ADR-0003）。接入三套真实适配器：`LiveConsoleLoginDriver`（复用 `BrowserRuntimePort` 继承 `Runtime Browser Profile`、CDP 5fps 帧流与手势重放、短信输入、同上下文二维码刷新与局部启动失败自清理）、`FixtureConsoleLoginDriver`（零浏览器消费测试剧本、`openFixtureTakeover` 共享手势验证及按 `sessionId` 缓冲完成路由）与 `InMemoryConsoleLoginDriver`；并将 Live 路径既有的“进入 `verifying` 时排空在途二维码刷新并关页后经 `AuthPort.verifyAndSeal` 与 `CandidateSeal` 独立核验”固化为全适配器通用契约。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** resolved

- [x] 整文件删除 `console-login-browser` 薄包装，`composeDaemonRuntime` 在 Live 模式结构性省略 `/api/sessions/:id/fixture-complete` 且仅 Fixture 模式注册 `consoleExtraRoutes`
- [x] `DriverSessionHandle` 将全部浏览器、上下文与接管句柄私有封闭于内部，启动局部失败幂等清理且 `close` 幂等
- [x] Live、Fixture 与 InMemory 三套适配器均固化“排空在途二维码刷新并关页后再独立核验”通用契约并共享一致手势坐标/时序校验
- [x] 增补 `LiveConsoleLoginDriver` 定向假页面单测覆盖局部失败清理、排空 QR 后核验与 Profile 继承，且全量测试与 `npm run check` 通过

## Comments

- **2026-11-25**（合并提交 `a9808cb46ef1014badb73c5ea9c91b28bc55e23b`）：已合入 `ticket/auth-console-login-deepening-03`（原提交 `9c30219c52304c73e223114ffc3ba48fccdb6a07`，共变更 16 个文件）。删除 `src/services/console-login-browser.js`，向 `composeDaemonRuntime` 引入 `ConsoleLoginDriverPort`（`console-login-driver.js`、`console-login-driver-shared.js`、`console-login-fixture.js` 及 `test/helpers/in-memory-ports.js` 中的 `InMemoryConsoleLoginDriver`）与 `consoleExtraRoutes`（Live 组合根省略 `/api/sessions/:id/fixture-complete`）；固化二维码刷新排空、关页与 `AuthPort.verifyAndSeal` + `CandidateSeal` 核验契约；新增三适配器契约与 Live 假页面单测（`test/adapter/console-login-driver-port.contract.test.js`），同步更新 `.trellis/spec/` 与 `docs/architecture-overview.md`。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `161 passed (161)`、`2575 passed | 1 skipped (2576)`（耗时 `88.41s`）。
