# 认证数据迁移到 SQLite

## Goal

用内置 `node:sqlite` 统一存储认证相关数据，替换现有的“多个 JSON 文件 + 文件锁 + 修订号”存储层，为密码凭据、熔断状态、租约与待办提供事务化存储。这是破坏性更新，不迁移旧数据。

父任务：`10-27-password-relogin-console`。本任务是子任务 ②，依赖 ①；③ 和 ④ 依赖本任务落定的表结构。

## Requirements

### 存储引擎

- N1 使用内置 `node:sqlite`，`package.json` 的 `engines` 改为 `>=24`；不引入 `better-sqlite3` 等原生依赖。
- N2 新增 `src/infra/db.js` 作为唯一的驱动封装层；其他模块不直接 import `node:sqlite`，以便日后替换驱动只改一处。
- N3 启用 WAL 与 `busy_timeout`；写操作统一使用 `BEGIN IMMEDIATE`；需要乐观并发的记录带 `revision` 列。
- N4 库文件默认 `data/pdd.db`，可由 `PDD_DB_PATH` 覆盖。
- N5 schema 版本化（如 `PRAGMA user_version`），建表与后续升级在打开数据库时幂等执行。

### 首期入库范围

- N6 商家账号与消费者账号（取代 `account-registry.js`、`consumer-account-registry.js` 的 JSON 注册表）。
- N7 auth-state（Playwright storageState 的 `cookies` / `origins`）：从库中读出后在内存中交给 `newContext`，不写临时文件。
- N8 为 ③④ 预留并建好以下表：密码凭据、熔断状态、账号租约、daemon 租约、`pending_actions`。字段由本任务 `design.md` 定义，③④ 只追加，不改既有列语义。
- N9 缓存类数据（发布源缓存、抓取冷却、限流状态）不在本期范围内。

### 加密

- N10 密码凭据与 auth-state 中的 Cookie 使用字段级 AES-256-GCM 加密，每条记录随机 IV，AAD 绑定“表名 + 主键”。
- N11 主密钥为首次运行时自动生成的 32 字节随机密钥，存放在 `data/master.key`（POSIX 权限 0600，Windows 设置为仅当前用户可读的 ACL），不放进数据库。
- N12 删除 scrypt 派生与 `PDD_MASTER_PASSWORD`；改造或替换 `src/infra/credential-vault.js`。
- N13 密钥文件丢失或密文无法解密时返回明确错误码，提示重新登录或重新录入密码；不静默返回空值。

### 破坏性变更

- N14 删除基于文件的存储层：`auth-state.js` 的文件读写部分、`auth-lock.js`、两个 JSON 注册表、`paths.js` 中的账号目录函数；以单库事务取代文件锁与修订号。
- N15 删除环境变量：`PDD_AUTH_STATE_PATH`、`PDD_CONSUMER_AUTH_STATE_PATH`、`PDD_ACCOUNTS_DIR`、`PDD_CONSUMER_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH`、`PDD_CONSUMER_ACCOUNT_REGISTRY_PATH`、`PDD_ALLOW_INSECURE_AUTH_STATE`、`PDD_MASTER_PASSWORD`。同步移除依赖显式路径的逻辑（例如 `--all-accounts` 与显式 auth-state 路径互斥的校验）。
- N16 不迁移旧数据：旧 JSON 与 auth-state 文件不读、不删。`doctor` 检测到旧文件时报告“检测到旧版数据，已不再使用，可手动删除”。
- N17 版本号升至 `0.5.0`（与 `CHANGELOG.md` 已有的 V0.1–V0.4 编号连续，2026-10-27 用户确认）；`CHANGELOG.md` 新增 V0.5 BREAKING 一节，说明存储改为 SQLite 且不迁移、删除的环境变量、`engines >=24`、升级方式（重新登录各账号）。

### 测试与契约

- N18 每个测试用例使用独立的临时 `PDD_DB_PATH`；fixture 模式（`PDD_TEST_ADAPTER=fixture`）继续可用。
- N19 现有命令的 envelope 与 data 契约 v2 不变；`REDACT_KEYS` 覆盖新增的敏感字段。
- N20 文档同步：`CLAUDE.md` / `AGENTS.md` / README / `pdd-local-development`、`pdd-adapter-auth-integration` 两个 skill 中涉及旧存储路径和环境变量的描述全部更新。

## Acceptance Criteria

- [ ] 全仓库除 `src/infra/db.js` 外无 `node:sqlite` import。
- [ ] 登录、普通命令、doctor、多账号（`--account` / `--all-accounts`）在 fixture 模式下全部基于 SQLite 跑通。
- [ ] 并发测试：两个进程同时写同一账号，一个成功、另一个得到明确的冲突结果，数据不损坏。
- [ ] 加密测试：库中密文不含明文；篡改密文或 AAD 不匹配时解密失败；密钥文件缺失时返回 N13 的错误码。
- [ ] 删除的环境变量在 `src/`、`bin/` 中无残留引用。
- [ ] `doctor` 能检测到旧版数据并给出提示。
- [ ] `npm test` 全量通过；`test/contract/data-contract-v2.test.js` 通过。
- [ ] CHANGELOG 和文档已同步更新。

## Notes

- 后端代码由 Codex 编写，Claude 审查。
- `design.md` 与 `implement.md` 在 ① 完成后基于干净基线编写。
