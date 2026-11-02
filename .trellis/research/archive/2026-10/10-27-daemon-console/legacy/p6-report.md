# P6 巡航实施报告

## 结果

- 新增 `createPatrol()` 组件并接入 daemon 默认组件列表，仅 `runtimeConfig.patrolEnabled === true` 时启动。首轮等待带 +/-20% 抖动的间隔；每轮完成后重新计时，避免重叠。
- 按 ID 顺序遍历未停用的商家账号，账号租约 `timeoutMs:0`。被占用时只记录 slug 与固定 code 的 info；账号错误隔离为固定 code 的 warning，继续处理后续账号。
- live 复用 `withMerchantAuthUpdate -> withBrowser({ storageState, ownerTag }) -> verifyStoredMerchant`，记录 rejected/indeterminate，rejected 复用 `reloginInCommand` 的熔断、限频与人工待办规则。没有首页导航或业务接口调用。
- 每账号 120 秒普通预算，`armDeadline` 原样下沉至 `infra/abort.js`，保留 runner 原导出。重登暂停/恢复普通预算，保留其独立 90 秒预算。daemon 停止会中断校验/重登，等待当前浏览器关闭并释放租约，跳过后续账号。
- 完整轮次写 ISO `daemon_last_patrol_at`；中断轮次保留旧值。`daemon status` 与 `/healthz` 已有本地时间投影，本轮通过 e2e 核验展示。

## 持久化选择与设计补充

普通命令在业务执行成功后才重新验证最终快照并提交。巡航只有认证检查，因此校验成功时保留原登录态；密码重登成功沿用既有核心的核验后提交，失败或不确定结果沿用现有 `recordMerchantCheck` 规则。这个选择已写入 design 第 8 节及 runtime-lifecycle spec。

fixture 按普通 fixture runtime 的有效性规则判断，不启动浏览器。`reloginForFixture(accountId, runtime, { tx })` 增加可选的已有事务上下文，供巡航在单次账号租约内复用核心；原二参数调用继续自行持有租约。

测试接缝 `PDD_TEST_PATROL_INTERVAL_MS`：仅 `isMockEnabled()` 为真时接受正安全整数毫秒；非法值回退至配置间隔，live 忽略，仍需显式开启巡航。e2e 使用 100ms，不改公开配置的最小 300000ms 约束。

## 修改文件

- `src/services/patrol.js`
- `src/services/password-relogin.js`
- `src/adapter/merchant-auth-storage.js`
- `src/infra/abort.js`
- `src/commands/runner/single-lifecycle.js`
- `src/daemon/run.js`
- `test/services/patrol.test.js`
- `test/e2e/patrol.e2e.test.js`
- `.trellis/spec/architecture/runtime-lifecycle.md`
- 当前任务的 `design.md`、`implement.md`、`p6-report.md`

## 验证

- 首轮定向 6 个文件、119 项通过；补充停止等待浏览器关闭与每账号 120 秒超时回归后，最终同范围 6 个文件、120 项通过。
- 定向命令：`npx vitest run test/services/patrol.test.js test/e2e/patrol.e2e.test.js test/services/password-relogin.test.js test/adapter/merchant-auth-storage.test.js test/commands/runner-deadline.test.js test/daemon/run.test.js --maxWorkers=2`。
- `npm test -- --maxWorkers=2`：64 个文件通过，969 项通过、1 项平台跳过，总计 970 项，退出码 0。
- `git diff --check` 通过；已核对 import 方向、短同步事务、日志字段与修改范围。

未增加依赖，保持 ESM；未运行真实账号/浏览器验证。项目无构建或类型检查步骤，lint 脚本是 no-op，本轮不计入质量验证。未提交，未修改 `CLAUDE.md` 或 `src/console/`。
