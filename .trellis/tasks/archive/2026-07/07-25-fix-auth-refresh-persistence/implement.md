# 实施计划

## 1. Heartbeat 正确性

- [x] 在 `auth-refresher.js` 返回 `redirected` 和最终 URL。
- [x] 首页或 heartbeat 最终进入登录页时判失败。
- [x] 保留失败后 `isAuthValid()` 兜底和仅成功后保存的契约。
- [x] 添加 200 登录跳转误判回归测试、正常成功测试和完整校验兜底测试。

## 2. 条件认证快照保存

- [x] 在 `auth-state.js` 增加文件 revision helper。
- [x] 在同一 auth lock 内比较 revision 并复用原子 `saveAuthState()`。
- [x] 添加未变化成功保存、并发变化跳过、文件缺失/异常边界测试。

## 3. Runner 接入

- [x] live 认证命令启动 browser 前取得 revision。
- [x] 业务成功且附加页面关闭后执行条件保存。
- [x] conflict / I/O failure 追加稳定 warning，不改变成功 envelope。
- [x] 失败、无认证和 fixture 路径保持不保存。
- [x] 保持 exactly-once finalization 和 batch 账号隔离。

## 4. 验证

- [x] `npx vitest run test/auth-refresher-lifecycle.unit.test.js test/auth-state.unit.test.js test/runner-contract.unit.test.js test/daemon-lifecycle.unit.test.js`
- [x] `npx vitest run test/pbt/auth-state.pbt.test.js test/pbt/auth-refresher.pbt.test.js test/pbt/auth-lock.pbt.test.js`
- [x] `npm test`
- [x] `git diff --check`
- [x] 检查 diff 不包含 `data/`、Cookie、token、账号文件或 `pinduoduo/` 内容。

## Review Gate

- [x] 用户确认 PRD、设计和实施范围后，运行 `task.py start` 进入实现阶段。
