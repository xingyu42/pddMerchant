# 04: 实例级 `createConsoleApp`、纯本地 `console-accounts` 归位与控制台测试去劫持

**What to build:** 收编模块级全局 `sessions` 映射与停机全局调用为实例级 `createConsoleApp`（聚合 `health`、`auth`、`patrol`、`accounts`、`sessions` 并由 `composeDaemonRuntime` 在守护进程启动时装配及在停机时统一清理），彻底移除控制台模块残余测试分支并完整保留 P4 状态机与注册表不变量（16 字节随机 ID、同键串行取代并等待释放、2-key 槽位上限与 429 `E_CONSOLE_BUSY`、12 分钟租约、`add` 空白态零预租约及凭据清理、9 态固定文案与 `verifying` 清空提示、`sms`/`qr` 单飞锁、`takeover`/`sms` 已有账号超时两连熔断、5 分钟 `unref` 终态回收与停机 503 `E_CONSOLE_STOPPING`）。将 `removeConsoleAccount` 迁回纯本地 `console-accounts`（通过注入 `isAccountLoggingIn` 谓词在登录中拒绝删号返回 409 `E_CONSOLE_SESSION_STATE`，并保留 `pdd console link` 零依赖；先沿用既有账号移除逻辑待 `command-lifecycle-unification#04` 统一收口），最后以 `InMemoryConsoleLoginDriver` + 临时 SQLite + 实例 `CandidateSeal` + 可控 `clock` 全面消除控制台 3 组 `vi.mock` 与 200ms 轮询等待。参见 `../spec.md`。

**Blocked by:** 02, 03, runtime-adapter-seams#06

**Status:** resolved

- [x] 模块级全局 `sessions` 与 `runtime.mode === 'fixture'` 分支彻底退出控制台服务，停机流程经 `consoleApp` 实例清理全部会话与 `unref` 定时器
- [x] 完整通过 P4 状态机与注册表不变量单测（涵盖单飞锁、2-key 槽位占用至旧资源释出、`add` 零预租约/双路径、`verifying` 入口清空消息及两连熔断计数边界）
- [x] `console-accounts` 承接纯本地 `removeConsoleAccount`（409 拦截进行中删号，零成本 `pdd console link`），已有账号登录成功统一走注入 `seal` / `commit` 的 `beginReloginAttempt` 与 `saveMerchantLogin`
- [x] 控制台单测彻底清除浏览器/密码重登/二维码 3 组模块劫持与 200ms 轮询等待，CDP / SSE 与控制台/巡航 E2E 及 `npm run check` 全绿

## Comments

- **2026-11-25**（合并提交 `a71721f418e65a5db10d41cd806c1feb5525454c`）：已合入 `ticket/auth-console-login-deepening-04`（原提交 `b0c7939261ab4ad69e8aed6cc1284a398b2b224e`，共变更 15 个文件）。以实例级 `createConsoleApp` 取代模块全局 `sessions` 与残余驱动兜底并经 `composeDaemonRuntime`、`routes.js` 与 `server.js` 接线；将 `removeConsoleAccount` 迁入纯本地 `src/services/console-accounts.js`（带 `isAccountLoggingIn` 409 守卫，保持 `pdd console link` 零依赖）；抽离共享 `createDeterministicTakeoverChannel`；在 `test/services/console-login.test.js` 中采用 `InMemoryConsoleLoginDriver`、临时 SQLite、`CandidateSeal` 与可控 `clock` 全面清除 3 组 `vi.mock` 与 200ms 轮询等待；新增 `test/services/console-accounts.test.js` 并同步更新 `.trellis/spec/services/domain-service-contracts.md`。合入后执行 `npm run check` 通过：`knip` 无多余导出/文件/依赖，Vitest 全量测试 `165 passed (165)`、`2665 passed | 1 skipped (2666)`（耗时 `84.68s`）。
