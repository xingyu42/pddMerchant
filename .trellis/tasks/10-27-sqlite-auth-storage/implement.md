# 执行计划：认证数据迁移到 SQLite

依据：`prd.md`（需求）和 `design.md`（技术设计）。

## 分工与流程

- **实现**：后端代码由 Codex 编写（通过 codex 插件委派），每次委派只交一个阶段，提示词里写明本任务路径、需要阅读的 `prd.md`、`design.md`、相关 spec，以及本阶段的验收命令。
- **审查**：每个阶段结束后由 Claude 审查，内容包括 diff 范围、规范、契约、安全和测试。审查通过才进入下一阶段；不通过就带着具体问题再委派给 Codex 修改。Claude 不直接改后端代码（spec 和文档除外）。
- **分支**：在 `feat/sqlite-auth-storage` 分支上进行，全部完成并通过最终审查后再合并到 `main`。每个阶段在分支上单独提交一次，方便逐阶段回滚。每次提交前都要征得用户同意。

## 阶段

### P1 基础设施：db / master-key / secret-box / leases

- [ ] `src/infra/db.js`：打开数据库并设置 PRAGMA；用 `user_version` 驱动迁移，建出 v1 schema；提供 `transaction(fn)`，`fn` 返回 Promise 时直接抛错；提供 `get/all/run`；进程退出时关闭连接。
- [ ] `src/infra/paths.js`：新增 `DB_PATH`（`PDD_DB_PATH`）和 `MASTER_KEY_PATH`。暂时不删除旧常量，留到 P3 统一删除。
- [ ] `src/infra/master-key.js`：生成（`wx`、`0o600`）、并发首次生成时的处理、POSIX 权限检查、Windows 上尽力调用 `icacls`、指纹写入与校验、缺失或不一致时报错。
- [ ] `src/infra/secret-box.js`：`seal` / `open`，AAD 格式为 `pdd-cli:v1:<table>:<id>`。
- [ ] `src/infra/leases.js`：`acquire / renew / release / assertOwner`，失效判定规则见 design 5.1。
- [ ] `src/infra/errors.js`：新增 design 第 6 节列出的错误码。
- [ ] `src/infra/logger.js`：`REDACT_KEYS` 增加新的敏感字段名。
- [ ] 为以上模块写单元测试，用例见 design 第 8 节"新增单元测试"。
- **验收**：`npx vitest run test/infra/`（只跑新增测试）通过；`npm test` 全量通过（此时旧代码路径还没动）。
- **审查重点**：除 `db.js` 外，没有任何文件导入 `node:sqlite`；事务里没有 await；错误中不包含密文或明文；租约失效判定与 `auth-lock.js` 的语义一致。

### P2 账号存储与 auth-state 改为读写数据库

- [ ] `src/infra/account-store.js`：商家和消费者账号的增删改查、默认账号、按 identity 查找、slug 生成（复用 `path-slug.js`），以及 ③④ 预留表的最小读写函数。
- [ ] `src/adapter/auth-state.js`：按 `account_id` 读写加密的 storageState 和元数据列；保留 `validateShape` 等非存储类导出。
- [ ] `src/adapter/merchant-auth-storage.js`：改为基于租约 + CAS 提交（design 5.2）。
- [ ] `src/services/auth-account-storage.js`：商家和消费者的 provision 都改为单事务（design 5.4）。
- [ ] 两个 resolver 改为查库，来源只保留 `flag / default / auto-single`。
- [ ] 改造调用方：runner（single 和 batch）、`init`、`login`、`account`、`doctor`、`services/auth.js`、`goods-publish.js`、`runtime-options.js`、`browser.js`。
- [ ] `config.js` 把 `authStatePath` 移入退役字段。
- [ ] `views/account.js` 删除 `has_credential` / `last_refresh_at`。
- [ ] `bin/pdd.js` 增加 Node 版本守卫。
- [ ] 测试接缝改用临时库：`test/setup.js`、`test/helpers/isolated-cli.js`（`seedDb`）。
- [ ] 改写 design 第 8 节列出的现有测试，并补充并发与泄露的验收用例。
- **验收**：`npm test` 全量通过；`test/contract/data-contract-v2.test.js` 通过；在 fixture 模式下手工跑一遍 `login → orders list → --all-accounts → account remove`。
- **审查重点**：
  - design 第 10 节的 S-a ~ S-h 是否全部落实，且没有引入清单以外的语义变化；
  - 提交流程中的 branded 校验、绑定校验、revision 校验是否都还在；
  - 输出中不出现库路径或密钥路径；
  - stdout 只有一行 JSON。

### P3 删除旧存储层

- [ ] 删除 `auth-lock.js`、`account-registry.js`、`consumer-account-registry.js`、`credential-vault.js`，以及 `fixtures/account.js` 中的死导出。
- [ ] 清理 `paths.js` 中旧的账号目录、注册表和 auth-state 路径常量与函数。
- [ ] 删除 PRD N15 列出的环境变量的所有读取点。
- [ ] 删除 `account remove --remove-files` 选项，同步更新 help baseline（`test/fixtures/help/baseline.json`）。
- **验收**：
  - `npm test` 全量通过；
  - `grep -rn "PDD_AUTH_STATE_PATH\|PDD_CONSUMER_AUTH_STATE_PATH\|PDD_ACCOUNTS_DIR\|PDD_CONSUMER_ACCOUNTS_DIR\|PDD_ACCOUNT_REGISTRY_PATH\|PDD_CONSUMER_ACCOUNT_REGISTRY_PATH\|PDD_ALLOW_INSECURE_AUTH_STATE\|PDD_MASTER_PASSWORD" src bin` 无结果；
  - `grep -rn "node:sqlite" src bin | grep -v src/infra/db.js` 无结果；
  - `npx knip` 没有新增未使用的导出。
- **审查重点**：没有残留的分支或注释；help 文案与选项一致。

### P4 旧数据检测、文档与发布元数据

- [ ] `doctor` 旧数据检测（design 第 7 节），并补充测试。
- [ ] `package.json`：`version` 改为 `0.2.0`，`engines` 改为 `>=24`；`CHANGELOG.md` 新增 BREAKING 一节。
- [ ] 文档：README、`CLAUDE.md`、`AGENTS.md`、两个 `.agents/skills`、`skills/pdd-cli/SKILL.md`、`docs/architecture-overview.md`、`docs/goods-publish-api-recon.md`。
- **验收**：`npm test` 全量通过；文档中不再出现旧路径和已删除的环境变量。

### P5 spec 同步（由 Claude 执行）

- [ ] 改写 design 第 9 节列出的 spec 文件：`auth-mall-context.md` 的存储与锁相关条款整体改写，`env-paths.md`、`testing.md`、`runner-lifecycle.md`、`browser-runtime.md`、`domain-service-contracts.md`。
- **验收**：spec 描述与代码一致（逐条对照签名和错误码）。

## 最终审查与合并

- [ ] 逐条核对 PRD 的全部验收标准。
- [ ] 跑一次完整的 `trellis-check`，并对 `src/infra/{db,master-key,secret-box,leases}.js` 做安全审查。
- [ ] `git diff main...feat/sqlite-auth-storage` 范围检查：只包含本任务的改动。
- [ ] 征得用户同意后合并到 `main`，合并后删除 ① 留下的 stash。

## 回滚

- 某个阶段审查不通过：在分支上 `git revert` 该阶段的提交，或者直接让 Codex 在原提交基础上修正。
- 合并后发现问题：revert 合并提交。由于这是破坏性更新、不迁移旧数据，回滚后旧版本代码会重新读取 `data/merchant/` 下的旧文件。只要用户还没删除这些旧文件，旧版本就能直接使用。
