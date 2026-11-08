# Architecture Spec Index

本层描述 pdd-cli 的整体结构、依赖方向与一次命令执行的生命周期。任何跨目录移动、命令运行链路改造、共享契约调整，都先读本目录。

## 文件

| 文件                                           | 内容                                                          | 使用场景                                       |
| ---------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| [dependency-flow.md](./dependency-flow.md)     | `commands -> services -> adapter -> infra` 分层与禁止反向依赖 | 移动逻辑、抽工具、改 import                    |
| [runtime-lifecycle.md](./runtime-lifecycle.md) | CLI 启动、注册、runner、endpoint、envelope finalization       | 改 `bin/pdd.js`、`withCommand()`、命令执行链路 |

## Pre-Development Checklist

- [ ] 明确改动涉及哪些层：`bin/`、`src/commands/`（含 `registry/`、`runner/`）、`src/daemon/`、`src/services/`（含 `views/`）、`src/adapter/`、`src/infra/`；`src/console/` 是 daemon 提供的静态前端。
- [ ] 如果跨 3 层以上，先读 `../guides/cross-layer-thinking-guide.md`。
- [ ] 确认没有把 domain 逻辑放入 `bin/pdd.js` 或 `src/infra/`。
- [ ] 确认没有让底层 import 上层（原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前仅靠 review 约束（不要重建该测试，除非另有任务））。
- [ ] 新能力、破坏性变更、架构/安全/性能大改：难以回退且有真实取舍的决策记入 `docs/adr/`，持久契约更新到 `.trellis/spec/`。

## Quality Check

- [ ] `bin/pdd.js` 只负责 CLI 入口、全局选项、signal/fatal handler 与注册调度。
- [ ] command handler 是 `withCommand()` 的薄封装（`init`、`login`、`account`、`config` 直接 `emit()`，不经 runner）；选项取值在 `option-parsers.js` 解析期校验。
- [ ] service 只处理领域编排与归一化，不直接写 stdout。
- [ ] adapter 隔离 Playwright、endpoint 传输（page-api / fetch / legacy）、auth、mall 与 fixture。
- [ ] infra 只提供横切能力与持久化：envelope、errors、logger、config、paths、timeouts、abort、单位换算，以及 SQLite 存储（db、account-store、leases、goods-cost-store 等）。
