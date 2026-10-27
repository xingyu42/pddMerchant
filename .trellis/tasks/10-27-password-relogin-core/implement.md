# 执行计划：密码重登核心与熔断

## 分工与流程

- 后端代码由 Codex 编写：通过 codex-rescue 子代理派发 `codex-companion.mjs task --write --fresh --prompt-file`，每阶段一份提示文件。
- Claude 负责审查、文档与 spec。
- 每个阶段结束都要做三件事：Claude 审查、跑定向测试和 `npm test`、征得用户同意后提交。
- 分支：`feat/password-relogin-core`，从 main 切出。
- N19 真实账号实验是阶段之间的闸门：P2 完成并提交后执行，P3 必须等实验结束才能开始。执行前要再次向用户确认时间窗口。

## 阶段

### P1 基础：凭据、状态机、错误码、脱敏

- [x] `src/infra/logger.js`：新增 `SECRET_KEYS`，命中时值固定为 `[REDACTED]`（design 第 11 节）。
- [x] `src/infra/errors.js`：新增 `authHumanRequired`、`reloginBlocked`、`reloginFailed`；改写 `passwordLoginFormChanged`；删除 `authChallengeRequired`（design 第 8 节）。
- [x] `src/infra/timeouts.js`：新增 `LOGIN_PASSWORD`。
- [x] `src/infra/config.js`：新增 `passwordReloginMinIntervalMs` / `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS`，默认值同步到 `config.example.json`（若存在）。
- [x] `src/adapter/password-credential.js`（design 第 3 节）。
- [x] `src/services/password-relogin.js`：只实现状态机、`decideRelogin`，以及 ④ 预留的 service 函数（design 5.1、5.2、5.4）。两条入口留到 P3。
- [x] `test/helpers`：新增凭据写入辅助函数。
- [x] 补齐 design 第 13 节中对应这些模块的单元测试。

验证：`npx vitest run test/infra/logger*.test.js test/adapter/password-credential.test.js test/services/password-relogin.test.js`，然后跑 `npm test`。

### P2 密码登录适配器、fixture 模拟与实验脚本

- [x] `src/adapter/password-login.js`：`attemptPasswordLogin`，选择器初版取自 `a468d02^:src/adapter/password-login.js`（design 第 4 节）。
- [x] `src/adapter/fixtures/auth.js` / `mock-dispatcher.js`：`mockPasswordLogin` 及三个 `PDD_TEST_PASSWORD_LOGIN*` 测试变量。
- [x] `scripts/experiments/password-login-probe.mjs`（design 第 12 节；实验完成后已删除）。
- [x] 测试：用 fake page 覆盖每个结果分支，并断言挑战分支在提交之后零点击；实验脚本做静态检查，确认没有写库或提交调用。

验证：跑适配器测试，然后跑 `npm test`。Claude 额外逐行审查实验脚本：输入回显、报告字段、只读请求。

### 闸门：N19 真实账号实验（用户本人执行）

- [x] 向用户确认时间窗口。
- [x] 第 1 次（空白上下文）：短信验证，提交即自动发短信。第 2 次（保留设备状态、去掉 `PASS_ID`）：90s 未识别状态，未收到短信。
- [x] 整理为 `research/real-login-experiment.md`。
- [x] 选择器校准：两次都没有命中挑战元素，暂无可校准的数据；留待 ④ 接管视图观察后补充。
- [x] 实验推翻了"不点击就不发送"的假设：已回到规划修改 design 5.3（重登改为设备延续的上下文）和 14a 节，经用户确认后进入 P3。
- [x] 实验脚本按用户要求删除。

### P3 接入普通命令

- [x] `src/infra/leases.js`：支持 `extendUntil`；`merchant-auth-storage.js` 传入"重登中"判定（design 第 6 节）。
- [x] `single-lifecycle.js`：`armDeadline` 增加 pause/resume，上下文改为可替换，调用 `reloginInCommand`，加入 `appendActionWarnings`。
- [x] `fixture-runtime.js`：失效判定加上标记 Cookie，调用 `reloginForFixture`，加入待办警告。
- [x] `services/password-relogin.js`：实现两条入口（design 5.3）。
- [x] `services/auth-account-storage.js`：实现 `markManualLoginSucceeded`（design 第 7 节）。
- [x] e2e：design 第 13 节列出的全部 fixture 场景，新文件 `test/e2e/password-relogin.e2e.test.js`。

验证：跑新 e2e，再跑 `test/e2e/sqlite-auth-storage.e2e.test.js`、`test/adapter/merchant-auth-storage.test.js`、`test/infra/leases.test.js`，最后跑 `npm test`。

回滚点：本阶段单独提交；回滚后恢复为"失效即提示 `pdd login`"。

### P4 输出：account list、doctor、标签

- [x] `labels.js` 新增两张标签表；`views/account.js` 增加 `has_password` / `password_relogin_status` 并更新 `ACCOUNT_VIEW_FIELDS`。
- [x] `doctor.js` 输出 `password_relogin` 与 `accounts[]` 的新字段，并更新 `renderDoctor`。
- [x] 更新契约测试与视图测试。

验证：`npx vitest run test/contract/data-contract-v2.test.js`，然后跑 `npm test`。

### P5 文档与 spec（Claude）

- [x] design 第 14 节列出的 spec 与文档。
- [x] 更新父任务 PRD 子任务表中 ③ 的状态。

## 最终审查与合并

- [x] 逐条核对 PRD 验收标准。
- [x] 跑 `trellis-check` 全量检查（发现截止时间未转人工的 High 缺陷，已在 `680cef6` 修复）。
- [x] 对 `password-credential.js`、`password-login.js`、`password-relogin.js`、`logger.js` 和实验脚本做安全审查，重点看密码是否会经错误、日志、调试输出或 detail 泄露。
- [x] 用 `git diff main...feat/password-relogin-core` 检查改动范围。
- [x] 用户同意后，在本地以 `--no-ff` 合并到 main，然后归档任务。
