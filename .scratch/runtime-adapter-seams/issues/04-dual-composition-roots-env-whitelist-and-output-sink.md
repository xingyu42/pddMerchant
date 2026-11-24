# 04: 双 Composition Root 装配、白名单 env 收口与 `OutputSink` / `clock`（Expand）

**What to build:** 建立遵循 ADR-0003 的双顶层组合根：`composeCommandRuntime({ mode, env, overrides, streams, clock, configOptions, runtimeConfigPolicy })`（支持 `'required'` 与 `'maintenance'` 策略、`scopeRuntime` 为 `--all-accounts` 派生共享父级限流与冷却的账号作用域、显式保留只读 `daemonIsRunning` 告警探测并产出 `daemon_not_running`）以及 `composeDaemonRuntime({ mode, foreground, runtimeConfig, env, overrides, clock })`（在 Live 模式下结构性省略 `/api/sessions/:id/fixture-complete` 且忽略测试时序覆盖）。冻结局部接缝 `OutputSink`（`emit`、`hasEmitted`、`writeDebugRaw`、`streams`）与 `clock`（`now`、`sleep`）；将白名单环境变量一次性收敛至双组合根解析并消除 P0-1 自辖 `isMockEnabled()`，分属下游 P0-2 / P1-3 / P1-4 的 7 个既有文件先行机械改读注入的 `runtime.mode === 'fixture'`（保留其结构性分支供归属 Spec 处理，维持 `PDD_DB_PATH`、输出颜色开关与配置合并层现状），且按“零空置占位导出”纪律保持 `knip` 全绿。参见 `../spec.md`。

**Blocked by:** 02, 03

**Status:** resolved

- [x] `composeCommandRuntime` 与 `composeDaemonRuntime` 按冻结签名就位，CLI 与守护进程入口切换经组合根按需装配 Live / Fixture Bundle（Live 零加载夹具、Fixture 零加载 Patchright）
- [x] 白名单环境变量（`PDD_TEST_*`、`PDD_SOURCE_PROXY_*`、`PDD_SCRAPE_SIMULATE`、`PDD_IMAGE_TRANSFORM`、`PDD_DEBUG_RAW`）在组合根以下实现零直读；`PDD_DB_PATH`、颜色开关与配置合并层现状不变
- [x] P0-1 自辖模块彻底清除 `isMockEnabled()`；分属下游 Spec 的 7 个调用文件机械切换为读取 `runtime.mode === 'fixture'`（暂留既有 `isMockEnabled` 导出与分发模块供 T5 前退场，零越界删改下游业务）
- [x] `--all-accounts` 批处理经 `scopeRuntime` 共享父级限流与冷却表并完整保留 `cooldown_inherited_from` 跨账号告警
- [x] `OutputSink`（含 `hasEmitted()`）与可控 `clock` 接入运行时执行链，Live 模式 `composeDaemonRuntime` 结构省略测试路由并忽略测试时序变量
- [x] 全量单测、Fixture E2E（含 JSON envelope v2 同构性与脱敏）及 `npm run check`（零未使用导出）通过

## Comments

- 2026-11-25: 已合入 `feat/runtime-adapter-seams`（合并提交 `1cd930b`）。共变更 72 个文件：新增 `src/runtime/{env,command-runtime,daemon-runtime,bundles/live-bundle,bundles/fixture-bundle}.js`、`src/infra/{clock,output-sink}.js` 与 `src/commands/runner/command-ctx.js`；落地双顶层组合根 `composeCommandRuntime`（支持 `'required'|'maintenance'` 策略、`scopeRuntime` 与 ADR-0003 只读 `daemonIsRunning`）与 `composeDaemonRuntime`（支持 `foreground`、`runtimeConfig`，Live 模式结构省略测试路由并忽略测试时序变量）；白名单 env 解析统一收口于 `parseRuntimeEnv`，清除 P0-1 自辖 `isMockEnabled()` 并将 7 个下游文件机械切换至 `runtime.mode === 'fixture'`；接入 `OutputSink` 与可注入 `clock`；新增 4 套单元测试（`output-sink`、`env`、`command-runtime`、`daemon-runtime`）。合入后执行 `npm run check` 全量通过：`npm run lint`（`knip`）退出码 0；`npm test`（`vitest run`）154 个测试文件全部通过（`154 passed (154)`），2503 个用例通过、1 个 Windows 环境用例跳过（`2503 passed | 1 skipped (2504)`，耗时 `81.48s`）。
