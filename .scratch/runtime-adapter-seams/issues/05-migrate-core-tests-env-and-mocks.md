# 05: 测试 env 与模块劫持迁移（批次一：adapter / runner / daemon 单测）

**What to build:** 将适配层、命令执行器与守护进程相关的单元测试（包括切换 `PDD_TEST_ADAPTER` 及直接对浏览器、输出、子进程模块做 `vi.mock` 劫持的测例）批量迁移到 `composeCommandRuntime` / `composeDaemonRuntime` 的 `overrides`、显式 `env`、内存 `streams` 与可控 `clock` 注入方式，确保该批单测在不依赖全局环境变量突变与跨层模块劫持的情况下独立并发运行且保持全量 CI 绿色。参见 `../spec.md`。

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] 适配层、命令执行器与守护进程目录下切换 `PDD_TEST_ADAPTER` 或操作运行时环境变量的测试迁移为显式 `env` / `overrides` 传入
- [ ] 针对浏览器、输出发射器与守护进程控制模块的跨层 `vi.mock` 劫持替换为双组合根 `overrides` 与内存 `streams` / `clock` 注入
- [ ] 本批迁移后的单测不再依赖全局 `PDD_TEST_ADAPTER=fixture` 即可独立通过并安全并发
- [ ] 全量测试与 `npm run check` 保持绿色
