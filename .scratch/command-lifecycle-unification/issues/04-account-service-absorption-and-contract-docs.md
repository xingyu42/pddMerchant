# 04: `account.*` 领域下沉、吸收 `account-removal` 与依赖流/契约文档收口

**What to build:** 建立统一账号领域服务承载 `account.{list,add,remove,default}`（通过 `withCommand` 的 `local` 预设统一接入执行内核并消除 4 处样板代码：`account list` 消费 `relogin-policy` 零解密重登摘要，`account add` 委托有头商家登录并附带 `credentials_not_saved_headed_login` 告警，`account remove` 保留默认 dry-run 预演与无解密关联足迹统计以支持主密钥错配可删，`account default` 统一位置参数/`--slug` 提取与 `E_USAGE` 拦截）。严格按 `T3 → T4` 顺序在 `auth-console-login-deepening#04` 之后吸收合并 15 行的 `account-removal` 浅模块，并同步将 `console-accounts` 中的账号删除委托导入切换至统一账号领域服务；最后更新依赖流规范（收回第 35–37 行对 `doctor`/`login` 直连适配器例外授权）、命令契约文档、运行生命周期文档及受影响技能路径引用，确认全仓非执行器命令层向适配器导入边归零。参见 `../spec.md`。

**Blocked by:** 03, auth-console-login-deepening#04

**Status:** resolved

- [x] `account.{list,add,remove,default}` 全部经 `withCommand` 统一信封内核运行，保留主密钥损坏可删、dry-run 预演、告警字段及 `E_USAGE` 契约且消除 4 处样板重复
- [x] 吸收合并 `account-removal` 浅模块，同步更新 `console-accounts` 对账号删除的导入源并删除孤立浅测与失效模块文件
- [x] 更新依赖流规范（lines 35–37 收回 `doctor`/`login` 例外）、命令契约、运行生命周期与相关 `SKILL.md` 引用路径，全仓检查确认非 runner 命令层零 `adapter/` 直接导入
- [x] 全量单元测试（含旧直接调用命令抛错测例改为断言信封或直测领域）、`data-contract-v2`、`doc-paths` 与 `npm run check` 全绿

## Comments

- Merged `ticket/command-lifecycle-unification-04` (`e9777c23384b99ec688100d8aeaf51332f64fd3a`) into `feat/phase3-lifecycle-and-cleanup` via `--no-ff` merge commit `ba1bf90b6eee0563b560d96e4c86b8df09ace1fc`.
- Verification: `npm run check` passed 100% (`npm run lint` / `knip` exited 0; `npm test` / Vitest passed `179 passed (179)` files, `2792 passed | 1 skipped (2793)` tests in 81.10s).
