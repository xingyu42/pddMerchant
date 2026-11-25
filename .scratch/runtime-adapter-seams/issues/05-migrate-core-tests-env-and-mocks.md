# 05: 测试 env 与模块劫持迁移（批次一：adapter / runner / daemon 单测）

**What to build:** 将适配层、命令执行器与守护进程相关的单元测试（包括切换 `PDD_TEST_ADAPTER` 及直接对浏览器、输出、子进程模块做 `vi.mock` 劫持的测例）批量迁移到 `composeCommandRuntime` / `composeDaemonRuntime` 的 `overrides`、显式 `env`、内存 `streams` 与可控 `clock` 注入方式，确保该批单测在不依赖全局环境变量突变与跨层模块劫持的情况下独立并发运行且保持全量 CI 绿色。参见 `../spec.md`。

**Blocked by:** 04

**Status:** resolved

- [x] 适配层、命令执行器与守护进程目录下切换 `PDD_TEST_ADAPTER` 或操作运行时环境变量的测试迁移为显式 `env` / `overrides` 传入
- [x] 针对浏览器、输出发射器与守护进程控制模块的跨层 `vi.mock` 劫持替换为双组合根 `overrides` 与内存 `streams` / `clock` 注入
- [x] 本批迁移后的单测不再依赖全局 `PDD_TEST_ADAPTER=fixture` 即可独立通过并安全并发
- [x] 全量测试与 `npm run check` 保持绿色

## Comments

- 2026-11-25: 已合入 `feat/runtime-adapter-seams`（合并提交 `0c35c76`）。共变更 16 个文件：将 `test/adapter/*`、`test/daemon/*`、`test/commands/*` 与 `test/services/daemon.test.js` 共 15 个批次一单测文件从 `vi.stubEnv('PDD_TEST_*')` 与跨层 `vi.mock`（`browser.js`、`output.js`、`daemon-process.js`、`mock-dispatcher.js`、`mall-port.js`）迁移至双组合根 `overrides` / `env`、内存 `streams` 与 `clock` 注入；移除 `src/adapter/browser.js` 中 `closeAllBrowsers` 的导出。实现侧已验证在脱离全局 `PDD_TEST_ADAPTER=fixture` 条件下批次一单测可独立通过（72 个文件 / 1314 个用例）；合入后在 `feat/runtime-adapter-seams` 执行 `npm run check` 全量通过：`npm run lint`（`knip`）退出码 0；`npm test`（`vitest run`）154 个测试文件全部通过（`154 passed (154)`），2503 个用例通过、1 个 Windows 环境用例跳过（`2503 passed | 1 skipped (2504)`，耗时 `78.95s`）。
