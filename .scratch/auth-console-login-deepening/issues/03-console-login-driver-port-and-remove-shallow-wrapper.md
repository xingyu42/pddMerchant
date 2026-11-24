# 03: `ConsoleLoginDriverPort`（Live / Fixture / InMemory 三适配器）与删除浅包装

**What to build:** 整文件移除直接改写裸 `session` 可变字段的 `console-login-browser` 薄包装，由 P1-4 向 `composeDaemonRuntime` 直接引入并注册清晰的外部端口 `ConsoleLoginDriverPort`（`openSession` → 全封装 `DriverSessionHandle`，含 `attemptPassword`、`captureQr`、`openTakeover`、`submitSmsCode`、`waitForAcquisition`、`verify`、`close`）与 Fixture 专用 `consoleExtraRoutes`（Live 模式恒为空集并遵循 ADR-0003）。接入三套真实适配器：`LiveConsoleLoginDriver`（复用 `BrowserRuntimePort` 继承 `Runtime Browser Profile`、CDP 5fps 帧流与手势重放、短信输入、同上下文二维码刷新与局部启动失败自清理）、`FixtureConsoleLoginDriver`（零浏览器消费测试剧本、`openFixtureTakeover` 共享手势验证及按 `sessionId` 缓冲完成路由）与 `InMemoryConsoleLoginDriver`；并将 Live 路径既有的“进入 `verifying` 时排空在途二维码刷新并关页后经 `AuthPort.verifyAndSeal` 与 `CandidateSeal` 独立核验”固化为全适配器通用契约。参见 `../spec.md`。

**Blocked by:** 01, runtime-adapter-seams#04

**Status:** ready-for-agent

- [ ] 整文件删除 `console-login-browser` 薄包装，`composeDaemonRuntime` 在 Live 模式结构性省略 `/api/sessions/:id/fixture-complete` 且仅 Fixture 模式注册 `consoleExtraRoutes`
- [ ] `DriverSessionHandle` 将全部浏览器、上下文与接管句柄私有封闭于内部，启动局部失败幂等清理且 `close` 幂等
- [ ] Live、Fixture 与 InMemory 三套适配器均固化“排空在途二维码刷新并关页后再独立核验”通用契约并共享一致手势坐标/时序校验
- [ ] 增补 `LiveConsoleLoginDriver` 定向假页面单测覆盖局部失败清理、排空 QR 后核验与 Profile 继承，且全量测试与 `npm run check` 通过
