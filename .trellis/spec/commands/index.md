# Commands Spec Index

命令层把 Commander 输入转换成 `withCommand()` action。它不拥有浏览器协议、endpoint 细节、领域聚合算法或输出 finalization。

## 文件

| 文件                                           | 内容                                                        | 使用场景             |
| ---------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| [command-contracts.md](./command-contracts.md) | 命令注册、flags、handler 边界、写操作 `--confirm`           | 新增/修改 CLI 命令   |
| [runner-lifecycle.md](./runner-lifecycle.md)   | `withCommand()`、auth/account/mall、timeout、batch、fixture | 修改命令执行公共行为 |

## Pre-Development Checklist

- [ ] 确认命令属于哪个 domain registrar：`src/commands/registry/*.js`。
- [ ] 命令名使用稳定 dot name，例如 `orders.list`、`goods.update.price`。
- [ ] handler 只解析/校验 options 并调用 service，不直接调用 Playwright。
- [ ] 写操作没有 `--confirm` 时必须 dry-run，不执行平台写入。
- [ ] 输出、exit code、warnings 交给 runner/infra。

## Quality Check

- [ ] 新命令只触碰命令文件、对应 registrar、service/adapter/tests；不把业务塞进 `bin/pdd.js`。
- [ ] `--json` 行为与 human output 均通过 envelope finalizer。
- [ ] usage error 映射为 exit code 2。
- [ ] 子进程 e2e 在 `PDD_TEST_ADAPTER=fixture` 下可运行。
