# 完善 log 日志系统：统一 log/、默认文件与按天轮转

## Goal

把项目运行日志统一落到仓库根目录下的 `log/`，CLI 默认写文件（不再默认污染 stderr），并按本地日历日轮转文件名；daemon 日志从 `data/` 迁出，与业务数据分离。

## Background

任务开始前的原始行为：

- CLI 未配置 `PDD_LOG_DESTINATION` 时，pino 写 **stderr**，与诊断输出/人类可读信息混在一起。
- 仅当显式配置文件路径时才落盘；落盘前不保证创建父目录。
- Daemon 后台默认写 `data/daemon.log`，与 auth/账号状态混在同一目录。
- 无统一 `log/` 约定，无按天轮转。

用户已确认：

1. **策略 B**：CLI 默认写 `log/` 下文件（stdout 仍专供 envelope/人类可读输出）。
2. **需要按天轮转**。

## Requirements

### R1 — 统一目录

- 所有默认运行日志文件 MUST 落在 `<PROJECT_ROOT>/log/`。
- `data/` MUST 不再作为默认日志目录（daemon 日志迁出）。
- `.gitignore` MUST 忽略 `log/`（可保留现有 `*.log`）。

### R2 — CLI 默认落盘（策略 B）

- 加载了 runtimeConfig 的普通 CLI 进程 MUST 默认写入 `log/cli/` 下按天轮转的日志文件。
- 未加载 runtimeConfig 的路径（如 silent bootstrap）MUST NOT 强制创建/写入业务日志文件。
- stdout 在 `--json` 模式下仍 MUST 保持 envelope 纯净（日志不得进 stdout）。

### R3 — Daemon 默认落盘

- 非 foreground 的 daemon MUST 默认写入 `log/daemon/` 下按天轮转的日志。
- foreground daemon MUST 使用 stderr，便于前台观察。
- 日志路径固定；`PDD_LOG_DESTINATION` / `logDestination` 已按产品决策移除，不提供运行时覆盖。

### R4 — 按天轮转

- 默认与显式文件目的地 MUST 按**本地时区**日历日轮转。
- 当日文件名约定为 channel 目录下的 `YYYY-MM-DD.log`：
  - CLI：`log/cli/2026-07-20.log`
  - Daemon：`log/daemon/2026-07-20.log`
- 跨日的长生命周期进程（尤其 daemon）MUST 在日期变化后自动切换到新文件，无需重启。
- 本任务 **不要求** 自动删除历史日志；保留全部按天文件（清理策略另议）。

### R5 — 路径解析与目录创建

- CLI 与 daemon channel 目录 MUST 由 `PROJECT_ROOT` 下的固定路径常量解析。
- 写入前 MUST 确保目标 channel 目录存在。
- 测试可通过内部 `destination` 参数注入 stream 或临时目录，但该参数不是公开运行配置。

### R6 — 兼容与文档

- 脱敏、`withOp`、redaction 契约 MUST 保持不变。
- 更新 `.env.example`、README/架构文档，明确固定日志路径和 foreground stderr 行为。
- 同步 Trellis infra spec（`logging-redaction.md` / `env-paths.md`）中的路径约定。
- 不自动迁移历史 `data/daemon.log` 内容（可在文档中说明新位置）。

### R7 — 测试

- paths 默认值与日期文件名解析有单测。
- logger 默认目的地、目录创建、按天文件名、测试注入 destination、跨日切换有单测。
- 现有 redaction PBT 与严格配置测试 MUST 继续通过；旧 `logDestination` 本地配置键应被严格 schema 拒绝。

## Out of Scope

- 按大小轮转、压缩、远程日志、多进程共享锁优化。
- 自动清理/保留天数策略。
- 把历史 `data/daemon.log` 自动搬迁或合并。
- 引入重量级日志平台或改 envelope 格式。

## Acceptance Criteria

- [x] `LOG_DIR` 默认为 `<PROJECT_ROOT>/log`；daemon 默认路径不再指向 `data/daemon.log`。
- [x] 普通 CLI 写入 `log/cli/YYYY-MM-DD.log`，且 stdout 无日志行。
- [x] 后台 daemon 写入 `log/daemon/YYYY-MM-DD.log`；foreground 使用 stderr。
- [x] 跨日时同一 logger 实例自动切到新日期文件。
- [x] channel 目录在写入前自动创建，日志路径不提供公开配置。
- [x] 旧 `logDestination` 本地配置键由严格 schema 拒绝，旧环境变量不再映射。
- [x] `.gitignore` 含 `log/`；文档与 `.env.example` 描述与实现一致。
- [x] 相关单测、完整测试与 `git diff --check` 通过。

## Notes

- 复杂任务：需 `design.md` + `implement.md`，经确认后再 `task.py start` 进入实现。
- 最终产品决策：移除 `PDD_LOG_DESTINATION` / `logDestination`，不做旧配置迁移。
- 工作提交：`30fda83`。
