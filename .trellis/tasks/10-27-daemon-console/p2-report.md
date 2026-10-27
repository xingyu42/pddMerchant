# P2 daemon 生命周期实施报告

## 结果

已实现显式 `daemon start / stop / status / run`、单实例心跳租约、停止请求、平台信号、5 秒清理硬期限、daemon 浏览器标记与遗留清理，以及当前账号有 open 待办时的 `daemon_not_running`。single 与 batch envelope 中该提醒均最多一条。普通命令和 doctor 保持当前进程执行，doctor 输出沿用原字段。

运行入口支持组件列表，每项提供异步 `start(context)` / `stop()`；按启动逆序清理并处理部分启动失败。P2 使用空列表，P3 可接入 HTTP 组件。`daemon_console_url` 保持未设置，命令返回 `console_url:null`。

分支 `feat/daemon-console`，基于 P1 `72b3269`。本轮未提交，`CLAUDE.md` 未改动，未增加依赖。

## 验证

- 首轮 daemon 定向验证：5 个文件、42 项通过，含重复启动、前台退出、强杀后租约到期接管。
- 扩大验证覆盖四个命令的 v2 契约、live/fixture 成功与失败提醒、batch 去重、doctor 无后台启动、浏览器 marker 参数与平台进程枚举。修复旧警告断言与新增测试所需 fixture 后，通过相关重跑。
- `npm test`：53 个文件通过，871 项通过、1 项平台跳过，总计 872 项，退出码 0。
- `git diff --check`：通过。
- 本机 Windows 执行 fixture 子进程 e2e，使用临时 `PDD_DB_PATH`。真实浏览器残留清理、Linux/macOS 进程枚举与真实宿主服务存活情况保留后续真机验证；平台枚举与过滤已有单元覆盖。
- 项目保持 JavaScript ESM，无构建或类型检查步骤；`npm run lint` 为 no-op，本轮未计入验证。

## 测试接缝

| 接缝 | 行为 |
| --- | --- |
| `PDD_TEST_DAEMON_LEASE_TTL_MS` | fixture 下覆盖租约 TTL，正安全整数毫秒；默认 90000，e2e 使用 3000 |
| `PDD_TEST_DAEMON_HEARTBEAT_MS` | fixture 下覆盖心跳间隔，正安全整数毫秒；默认 30000，e2e 使用 100 |
| `isMockEnabled()` | 上述两项仅在 `PDD_TEST_ADAPTER=fixture` 时读取，live 忽略；非法值回退默认值 |
| `runDaemon({ exit, components, signal, foreground })` | 注入硬退出、组件、取消信号与日志前台模式，避免单测结束测试进程 |
| `cleanupOrphanBrowsers({ listProcesses, kill })` | 注入 `{ pid, commandLine }[]` 与终止函数；fixture 清理直接返回 0 |
| `src/adapter/daemon-process.js` | 隔离 spawn/kill，单测使用模块 mock，验证 detached/windowsHide/stdio/env/unref |

时间覆盖在 `services/daemon-runtime.js` 单点解析，再显式传给 infra 的租约辅助函数。子进程完整继承环境，包括 `PDD_DB_PATH`、fixture 开关与短时间覆盖。

## 设计调整

- 为四个 daemon 命令新增显式 `needsBrowser:false` runner 选项，同时跳过账号解析；保持统一 finalizer。已有命令默认行为保持原样。
- 强制停止在短同步事务中重查 owner token、主机和心跳，再 kill 与 CAS 删除。正常释放与停止请求清理也在同一事务内，保护接替实例。
- 沿用 logger 的 writable destination 与日轮转实现前台 stderr 分流，未扩展 logger API。
- 按本轮范围补充 macOS `ps` 枚举；HTTP 控制台与巡航执行分别留在 P3/P6。

## 改动文件

### 运行代码

- [D:/Dev/pddMerchant/bin/pdd.js](D:/Dev/pddMerchant/bin/pdd.js)
- [D:/Dev/pddMerchant/src/adapter/browser.js](D:/Dev/pddMerchant/src/adapter/browser.js)
- [D:/Dev/pddMerchant/src/adapter/daemon-process.js](D:/Dev/pddMerchant/src/adapter/daemon-process.js)
- [D:/Dev/pddMerchant/src/commands/daemon.js](D:/Dev/pddMerchant/src/commands/daemon.js)
- [D:/Dev/pddMerchant/src/commands/registry/daemon.js](D:/Dev/pddMerchant/src/commands/registry/daemon.js)
- [D:/Dev/pddMerchant/src/commands/runner/batch-executor.js](D:/Dev/pddMerchant/src/commands/runner/batch-executor.js)
- [D:/Dev/pddMerchant/src/commands/runner/fixture-runtime.js](D:/Dev/pddMerchant/src/commands/runner/fixture-runtime.js)
- [D:/Dev/pddMerchant/src/commands/runner/single-lifecycle.js](D:/Dev/pddMerchant/src/commands/runner/single-lifecycle.js)
- [D:/Dev/pddMerchant/src/daemon/run.js](D:/Dev/pddMerchant/src/daemon/run.js)
- [D:/Dev/pddMerchant/src/infra/daemon-state.js](D:/Dev/pddMerchant/src/infra/daemon-state.js)
- [D:/Dev/pddMerchant/src/services/daemon-runtime.js](D:/Dev/pddMerchant/src/services/daemon-runtime.js)
- [D:/Dev/pddMerchant/src/services/daemon.js](D:/Dev/pddMerchant/src/services/daemon.js)
- [D:/Dev/pddMerchant/src/services/views/daemon.js](D:/Dev/pddMerchant/src/services/views/daemon.js)

### 测试

- [D:/Dev/pddMerchant/test/adapter/auth-snapshot-context.test.js](D:/Dev/pddMerchant/test/adapter/auth-snapshot-context.test.js)
- [D:/Dev/pddMerchant/test/adapter/daemon-browser.test.js](D:/Dev/pddMerchant/test/adapter/daemon-browser.test.js)
- [D:/Dev/pddMerchant/test/adapter/daemon-process.test.js](D:/Dev/pddMerchant/test/adapter/daemon-process.test.js)
- [D:/Dev/pddMerchant/test/adapter/merchant-auth-lifecycle.test.js](D:/Dev/pddMerchant/test/adapter/merchant-auth-lifecycle.test.js)
- [D:/Dev/pddMerchant/test/commands/daemon.test.js](D:/Dev/pddMerchant/test/commands/daemon.test.js)
- [D:/Dev/pddMerchant/test/contract/data-contract-v2.test.js](D:/Dev/pddMerchant/test/contract/data-contract-v2.test.js)
- [D:/Dev/pddMerchant/test/daemon/run.test.js](D:/Dev/pddMerchant/test/daemon/run.test.js)
- [D:/Dev/pddMerchant/test/e2e/daemon.e2e.test.js](D:/Dev/pddMerchant/test/e2e/daemon.e2e.test.js)
- [D:/Dev/pddMerchant/test/e2e/merchant-auth.e2e.test.js](D:/Dev/pddMerchant/test/e2e/merchant-auth.e2e.test.js)
- [D:/Dev/pddMerchant/test/e2e/password-relogin.e2e.test.js](D:/Dev/pddMerchant/test/e2e/password-relogin.e2e.test.js)
- [D:/Dev/pddMerchant/test/helpers/daemon-cli.js](D:/Dev/pddMerchant/test/helpers/daemon-cli.js)
- [D:/Dev/pddMerchant/test/infra/retired-auth-schedule.test.js](D:/Dev/pddMerchant/test/infra/retired-auth-schedule.test.js)
- [D:/Dev/pddMerchant/test/services/daemon.test.js](D:/Dev/pddMerchant/test/services/daemon.test.js)

### 规范与任务记录

- [D:/Dev/pddMerchant/.trellis/spec/adapter/browser-runtime.md](D:/Dev/pddMerchant/.trellis/spec/adapter/browser-runtime.md)
- [D:/Dev/pddMerchant/.trellis/spec/architecture/runtime-lifecycle.md](D:/Dev/pddMerchant/.trellis/spec/architecture/runtime-lifecycle.md)
- [D:/Dev/pddMerchant/.trellis/spec/commands/runner-lifecycle.md](D:/Dev/pddMerchant/.trellis/spec/commands/runner-lifecycle.md)
- [D:/Dev/pddMerchant/.trellis/spec/infra/sqlite-storage.md](D:/Dev/pddMerchant/.trellis/spec/infra/sqlite-storage.md)
- [D:/Dev/pddMerchant/.trellis/tasks/10-27-daemon-console/implement.md](D:/Dev/pddMerchant/.trellis/tasks/10-27-daemon-console/implement.md)
- [D:/Dev/pddMerchant/.trellis/tasks/10-27-daemon-console/p2-report.md](D:/Dev/pddMerchant/.trellis/tasks/10-27-daemon-console/p2-report.md)
