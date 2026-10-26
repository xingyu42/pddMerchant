# Architecture Spec Index

本层描述 pdd-cli 的整体结构、依赖方向与一次命令执行的生命周期。任何跨目录移动、命令运行链路改造、共享契约调整，都先读本目录。

## 文件

| 文件                                           | 内容                                                          | 使用场景                                       |
| ---------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| [dependency-flow.md](./dependency-flow.md)     | `commands -> services -> adapter -> infra` 分层与禁止反向依赖 | 移动逻辑、抽工具、改 import                    |
| [runtime-lifecycle.md](./runtime-lifecycle.md) | CLI 启动、注册、runner、endpoint、envelope finalization       | 改 `bin/pdd.js`、`withCommand()`、命令执行链路 |

## Pre-Development Checklist

- [ ] 明确改动涉及哪些层：`bin/`、`src/commands/`、`src/services/`、`src/adapter/`、`src/infra/`。
- [ ] 如果跨 3 层以上，先读 `../guides/cross-layer-thinking-guide.md`。
- [ ] 确认没有把 domain 逻辑放入 `bin/pdd.js` 或 `src/infra/`。
- [ ] 确认没有让底层 import 上层（原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前仅靠 review 约束（不要重建该测试，除非另有任务））。
- [ ] 新能力、破坏性变更、架构/安全/性能大改：先走 OpenSpec proposal。

## Quality Check

- [ ] `bin/pdd.js` 只负责 CLI 入口、全局选项、signal/fatal handler 与注册调度。
- [ ] command handler 是 `withCommand()` 的薄封装。
- [ ] service 只处理领域编排与归一化，不直接写 stdout。
- [ ] adapter 隔离 Playwright、XHR、auth、mall、endpoint 与 mock fixture。
- [ ] infra 只提供横切能力：envelope、errors、logger、paths、timeouts、abort。
