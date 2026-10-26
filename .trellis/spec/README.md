# pdd-cli Trellis Spec

本目录是 `pddMerchant` / `pdd-cli` 的项目专属 Trellis code-spec。它从项目代码、测试、`README.md`、`CLAUDE.md` 与 `docs/` 中提炼，目标是让后续 AI/开发者在实现前能直接读取“可执行契约”，而不是依赖聊天记录或模板化前端规则。

## Spec 分层

| 目录                                       | 作用                                                                | 先读场景                                              |
| ------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------- |
| [`architecture/`](./architecture/index.md) | CLI 分层、单向依赖、运行时生命周期                                  | 跨层改动、移动代码、调整命令执行流                    |
| [`commands/`](./commands/index.md)         | Commander 注册、命令 handler、`withCommand()` 契约                  | 新增/修改 CLI 命令、全局/命令 flags                   |
| [`services/`](./services/index.md)         | 领域服务、归一化、业务规则、goods publish                           | 新增领域逻辑、调整 orders/goods/promo/diagnose/action |
| [`adapter/`](./adapter/index.md)           | Playwright、XHR/fetch 捕获、endpoint specs、fixture mock、auth/mall | 接入或修改平台接口、浏览器行为、鉴权/店铺上下文       |
| [`infra/`](./infra/index.md)               | envelope、exit codes、错误、日志脱敏、路径/env                      | 输出契约、错误映射、日志、配置、敏感数据              |
| [`standards/`](./standards/index.md)       | ESM 编码风格、测试、依赖策略                                        | 通用实现、测试选择、依赖新增                          |
| [`guides/`](./guides/index.md)             | 思考清单，不是实现契约                                              | 需求模糊、跨层/复用风险判断                           |

## 项目硬契约

- Runtime：Node.js ESM，纯 JavaScript，无 TypeScript、无 build step。
- 入口：`bin/pdd.js`。
- 依赖方向：`commands -> services -> adapter -> infra`，禁止反向引用；原 `test/layering-guard.unit.test.js` 已在 `cc0cb1c` 删除，分层目前仅靠 review 约束（不要重建该测试，除非另有任务）。
- 输出：所有命令必须保留 envelope `{ ok, command, data, error, meta }`（`meta.v: 2`）；`--json` stdout 必须是一行 JSON；`data` 遵循输出契约 v2（见 `infra/envelope-errors-output.md`），由 `test/contract/data-contract-v2.test.js` 覆盖全部注册命令。
- 错误：统一使用 `PddCliError` 与 `ExitCodes`，退出码只允许 0-7。
- 日志：运行时代码禁止 `console.log`；使用 `src/infra/logger.js` 或 `ctx.log`，敏感值必须指纹脱敏。
- 测试：Vitest + fixture adapter；真实浏览器外部依赖必须能在 `PDD_TEST_ADAPTER=fixture` 下测试核心行为。

## 任务规划与 Code-Spec 的边界

- Trellis task (`.trellis/tasks/<task>/`) 负责需求、设计、实施计划、评审和任务状态。
- Trellis spec (`.trellis/spec/`) 负责实现时的 code-spec：签名、字段、env、错误矩阵、测试点、反模式。
- 新能力、破坏性变更或架构/安全/性能大改应先创建 Trellis 任务并完成规划评审；任务激活后再读取本目录对应 code-spec。

## 使用规则

1. 改命令前读 `commands/` + 受影响的 `services/` / `adapter/` / `infra/`。
2. 改 endpoint、auth、mall、fixture 前读 `adapter/`。
3. 改输出、错误、日志、路径或 env 前读 `infra/`。
4. 改测试或新增依赖前读 `standards/`。
5. 学到新的可复用契约时，更新相应 spec；不要把具体实现规则塞进 `guides/`。
