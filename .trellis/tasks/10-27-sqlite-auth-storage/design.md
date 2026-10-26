# 设计：认证数据迁移到 SQLite

本文是 `prd.md` 的技术设计。现状盘点来自 2026-10-27 对存储层的只读梳理（模块导出、调用点、持久化结构、事务语义、测试接缝）。

## 1. 现状要点与迁移难点

| 现状 | 新设计中的处理 |
|---|---|
| 每个账号一个 `auth-state.json`，加上商家和消费者两个 `registry.json` | 统一放进一个 SQLite 库 |
| `<file>.lock` 文件锁会**一直持有到整个业务命令或登录结束**（可达数分钟），同主机上只要持有进程的 pid 还活着，锁就永不过期 | SQLite 写事务不能持有这么久，否则会阻塞整个库。改为 **账号租约（lease 行）+ 短事务 CAS 提交** |
| 修订号 = 文件字节的 sha256 | 改为整数 `revision` 列，每次写入加 1 |
| 登录时整个过程持有注册表锁（包括用户扫码的时间），`remove` / `default` 必须等待 | 去掉注册表级锁。最终提交放在单个事务里，对账号是否存在和修订号做 CAS，并发删除时提交冲突，不会把已删除的账号"复活" |
| 登录先写 `_pending/<uuid>.json`，provision 再复制到目标文件，失败时要补偿删除 | 取消 pending 文件：已核验的候选材料只在内存中，provision 一次事务写入 |
| 消费者 slug 每次登录都按昵称重新计算并 rekey | 按 uid 保持 slug 稳定（与商家按 mallId 的做法一致），只更新 `display_name` |
| `credential-vault.js`、`mockAccountRegistry`、`mockDecryptCredential` 是死代码 | 删除 |
| `authStatePath` 是公开配置字段（`PDD_AUTH_STATE_PATH` / `config.json` / `config set`） | 列为退役字段：本地配置里出现时忽略，不报错；`config set authStatePath` 视为未知字段 |

## 2. 模块划分

新增（全部在 infra 层，不认识业务 domain）：

| 模块 | 职责 |
|---|---|
| `src/infra/db.js` | **唯一**导入 `node:sqlite` 的地方。负责打开和关闭、PRAGMA、schema 迁移、`transaction(fn)`、`get/all/run` 辅助函数 |
| `src/infra/master-key.js` | 主密钥文件的生成、读取、权限设置，以及指纹校验 |
| `src/infra/secret-box.js` | `seal(plaintextObj, aad)` 和 `open(envelope, aad)`，使用 AES-256-GCM |
| `src/infra/leases.js` | 租约的 `acquire / renew / release / assertOwner`，取代 `auth-lock.js` |
| `src/infra/account-store.js` | 商家和消费者账号的增删改查，取代两个 JSON 注册表 |

改造：

| 模块 | 改造内容 |
|---|---|
| `src/adapter/auth-state.js` | 改为按 `account_id` 读写库中的 auth-state（加密 blob 加元数据列）。保留 `validateShape`、`PDD_HOME`、`CONSUMER_HOME`、`isConsumerAuthValid` 不变 |
| `src/adapter/merchant-auth-storage.js` | `withMerchantAuthUpdate(accountId, fn, opts)` 改为基于租约，提交改为 CAS |
| `src/services/auth-account-storage.js` | 商家和消费者的 provision 都改为单事务 |
| `src/infra/account-resolver.js` / `consumer-account-resolver.js` | 改为查库；删除 `explicit-path` 与 `unregistered-default` 两个来源 |
| `src/infra/paths.js` | 删除账号目录、注册表和 auth-state 路径相关的常量与函数，新增 `DB_PATH`（读取 `PDD_DB_PATH`）以及 `MASTER_KEY_PATH = join(dirname(DB_PATH), 'master.key')` |
| 调用方 | `commands/account.js`、`init.js`、`login.js`、`doctor.js`、`runner/single-lifecycle.js`、`runner/batch-executor.js`、`runtime-options.js`、`services/auth.js`、`services/goods-publish.js`、`adapter/browser.js` |

删除：`src/infra/auth-lock.js`、`src/infra/account-registry.js`、`src/infra/consumer-account-registry.js`、`src/infra/credential-vault.js`，以及 `src/adapter/fixtures/account.js` 中的死导出。`src/infra/path-slug.js` 保留：slug 仍是给人看的标识，规则不变。

依赖方向保持 `commands → services → adapter → infra`。只有 `db.js` 认识 SQLite，`account-store.js` 和 `leases.js` 通过 `db.js` 访问数据库。

## 3. 数据库

### 3.1 打开与 PRAGMA

- 路径：`DB_PATH`，默认 `data/pdd.db`，可用 `PDD_DB_PATH` 覆盖。主密钥固定放在**数据库同目录**，所以一个 `PDD_DB_PATH` 就能同时隔离库和密钥。
- 每个进程懒加载一个 `DatabaseSync` 实例，进程退出时关闭。
- 打开后依次执行：`PRAGMA journal_mode = WAL`、`PRAGMA synchronous = NORMAL`、`PRAGMA foreign_keys = ON`、`PRAGMA busy_timeout = 5000`。
- `DatabaseSync` 是同步 API，`busy_timeout` 等待期间会阻塞事件循环。所有写事务都必须短小（毫秒级），**禁止在事务内 await 浏览器或网络操作**，`transaction(fn)` 在 `fn` 返回 Promise 时直接抛错。

### 3.2 迁移

- 用 `PRAGMA user_version` 记录 schema 版本，打开数据库时在 `BEGIN IMMEDIATE` 内按版本依次执行迁移，操作幂等。
- 本任务建立 v1。③ 和 ④ 以追加迁移（v2、v3……）的方式加列或加表，不修改既有列的语义。

### 3.3 Schema v1

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);                                   -- 存放 master_key_fingerprint 等元数据

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('merchant','consumer')),
  slug          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  identity      TEXT NOT NULL,       -- merchant: mall_id；consumer: uid
  is_default    INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT,
  last_used_at  TEXT,
  UNIQUE (kind, slug),
  UNIQUE (kind, identity)
);
CREATE UNIQUE INDEX accounts_one_default ON accounts(kind) WHERE is_default = 1;

CREATE TABLE auth_states (
  account_id         INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision           INTEGER NOT NULL,
  state_sealed       TEXT NOT NULL,  -- secret-box 封装的 { cookies, origins } JSON
  bound_mall_id      TEXT,           -- 仅 merchant
  usable             INTEGER NOT NULL DEFAULT 1,
  check_verdict      TEXT,           -- 仅在 verified 提交时写入
  scope              TEXT,
  checked_at         TEXT,
  last_check_verdict TEXT,           -- verified | rejected | indeterminate
  last_check_reason  TEXT,
  last_check_at      TEXT,
  updated_at         TEXT NOT NULL
);

CREATE TABLE leases (
  scope        TEXT NOT NULL,        -- 'account' | 'daemon'（④）
  key          TEXT NOT NULL,        -- account_id 或 'singleton'
  owner_token  TEXT NOT NULL,
  pid          INTEGER NOT NULL,
  hostname     TEXT NOT NULL,
  acquired_at  TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

-- 以下三张表为 ③④ 预留，本任务只负责建表并提供最小读写函数
CREATE TABLE credentials (
  account_id      INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  password_sealed TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE relogin_states (
  account_id                    INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  status                        TEXT NOT NULL CHECK (status IN ('available','awaiting_human','blocked')),
  reason                        TEXT,
  consecutive_takeover_timeouts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at               TEXT,
  updated_at                    TEXT NOT NULL
);

CREATE TABLE pending_actions (
  id          INTEGER PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,         -- 如 'human_verification'
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open','resolved')),
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX pending_actions_one_open ON pending_actions(account_id, kind) WHERE status = 'open';
```

时间统一用 ISO 8601 UTC 字符串。输出层仍然按 data 契约 v2 转换为 `YYYY-MM-DD HH:mm:ss`（Asia/Shanghai）。

## 4. 加密

### 4.1 主密钥（`master-key.js`）

- 文件 `MASTER_KEY_PATH` 的内容为 JSON：`{ "version": 1, "key": "<base64 32 字节>" }`。
- 首次需要时用 `randomBytes(32)` 生成，以 `flag: 'wx', mode: 0o600` 写入。多个进程同时首次运行时，写入报 `EEXIST` 的一方改为读取已存在的文件。
- 权限：POSIX 下读取时检查是否为 0600，不是则报 `E_MASTER_KEY_INSECURE`。Windows 下创建后尽力执行一次 `icacls "<file>" /inheritance:r /grant:r "<USERNAME>:F"`，失败只写日志警告，不阻断。
- 指纹：`sha256(key)` 的前 16 个 hex 字符，在首次初始化库时写入 `meta.master_key_fingerprint`。之后每次打开都要校验：
  - 不一致 → `E_MASTER_KEY_MISMATCH`，提示密钥文件被替换，需要恢复原文件或清空数据库后重新登录。
  - 库里有指纹、但密钥文件不存在 → `E_MASTER_KEY_MISSING`，**不重新生成**，否则旧密文就再也解不开了。
- 以上错误统一 exit 3（AUTH）。

### 4.2 secret-box

- `seal(obj, aad)` → `{ v: 1, iv, tag, ct }`（base64），序列化为 JSON 字符串存入 TEXT 列。
- AES-256-GCM，每次生成 12 字节随机 IV，tag 长 16 字节。AAD 格式为 `pdd-cli:v1:<table>:<account_id>`。由于 `account_id` 是不可变的整数主键，改 slug 不影响解密。
- `open` 遇到任何失败（篡改、AAD 不符、格式错误）都抛 `E_SECRET_DECRYPT_FAILED`（exit 3），错误里不包含任何密文或明文片段。
- 加密范围：`auth_states.state_sealed` 是整个 `{ cookies, origins }`，因为 localStorage 里也可能存 token；`credentials.password_sealed` 由 ③ 使用。账号名、mall_id、uid、校验结论这些元数据**不加密**，方便查询和视图投影。

## 5. 并发：租约 + CAS

### 5.1 账号租约（`leases.js`）

```js
acquireLease(scope, key, { timeoutMs, retryMs = 200, ttlMs, signal }) -> { token }
renewLease(scope, key, token, { ttlMs })
releaseLease(scope, key, token)          // token 不匹配时什么也不做
assertLeaseOwner(scope, key, token)      // 不匹配则抛 E_AUTH_LOCK_LOST
```

- 获取：在一个短的 `BEGIN IMMEDIATE` 事务里读取现有行。没有行或者租约已失效，就写入或覆盖为自己的 token；否则提交事务，等待 `retryMs` 加抖动后重试，直到 `timeoutMs` 用完，抛 `E_LOCK_TIMEOUT`（沿用现有错误码）。
- 失效判定（沿用 `auth-lock.js` 的语义）：
  - 同一主机且 pid 已经不在，立即视为失效；
  - 同一主机且 pid 还活着，即使超过 `expires_at` 也不算失效，避免长时间登录中途被抢；
  - 不同主机，按 `expires_at` 判定。
- `ttlMs` 默认取任务截止时间加 30 秒。④ 的 daemon 会用 `renewLease` 定期心跳续期。
- 只用 `scope = 'account'`、`key = account_id` 取代原来的 auth-state 文件锁，**不再有注册表级的锁**。

### 5.2 `withMerchantAuthUpdate(accountId, fn, opts)`

1. `assertAuthTask`，然后获取账号租约。
2. 读取一次 `auth_states`（解密）和 `revision`，构造 `tx = { accountId, token, revision, state, metadata, ...opts }`。
3. 执行 `await fn(tx)`。此时**不在 SQLite 事务内**，浏览器和网络操作可以放心执行。
4. 释放租约。

提交函数（`commitMerchantCandidate` / `recordMerchantCheck`）在一个短的 `BEGIN IMMEDIATE` 事务里做以下检查，任何一项不满足都回滚：

- 取消信号和截止时间；
- `assertLeaseOwner`；
- `UPDATE auth_states SET … , revision = revision + 1 WHERE account_id = ? AND revision = ?`，`changes() === 0` 视为冲突，沿用 `E_AUTH_STATE_CONFLICT` 这类现有错误码；
- 原有的业务校验全部保留：只接受 branded 候选、`recoveryMallId` 和既有绑定必须匹配、`expectedRevision` 必须一致。

提交成功后更新 `tx.revision` 和 `tx.state`，所以同一个回调里允许多次提交，和现在的行为一样。

### 5.3 Runner

- `single-lifecycle.js` 的整条流程不变：`needsAuth` 命令在 `withMerchantAuthUpdate(accountId)` 内依次执行校验、业务、最终核验、提交。提交冲突或失败仍然降级为 `auth_state_persist_conflict` / `_failed` 警告，不让命令失败。
- `batch-executor.js` 改用 `account-store.listAccounts({ kind: 'merchant' })` 枚举账号，按 `accountId` 逐个调用 `executeSingle`。删除与显式路径互斥的那段校验。

### 5.4 登录与 provision

**商家**（`withMerchantLoginRegistration` + `provisionMerchantAuth` 合并为 `provisionMerchantLogin`）：

1. 开始前记下快照 `initial = { accountId, revision }`：带 `--account` 时取目标账号的值，否则只有在拿到候选、确认 mallId 后才能定位账号，这时 `initial` 为空。
2. 登录流程：已知账号时，在 `withMerchantAuthUpdate(accountId)` 内复用库中已有的状态；新账号则从空状态开始。最终产出 branded 候选（内存中的 storageState）。
3. 用一个 `BEGIN IMMEDIATE` 事务完成所有写入：
   - 按 `identity = mallId` 查找账号。
     - 找到了：如果 `initial` 指向这个账号，校验 revision 一致；如果 `initial` 记录了它存在、但现在已被删除，就报冲突，不重新创建（"不复活"）；
     - 没找到：插入新账号。slug 由 `slugifyStorageName(mallName, { existingSlugs, stableId: mallId })` 生成，已有账号的 slug 不变；表里没有其他商家账号时，设为默认账号。
   - upsert 到 `auth_states`，`revision` 加 1，并写入 `bound_mall_id` 和校验元数据。
   - 更新 `last_login_at`。
4. 不再有 pending 文件，也不需要补偿删除。

**消费者**（`provisionConsumerAuth`）：同样用单个事务完成，按 `identity = uid` 查找账号；已存在则保留 slug，只更新 `display_name`；最后写入 `auth_states`，消费者没有 `bound_mall_id`。

**语义变化**：登录期间，`account remove` / `account default` 不再需要等待。如果某个账号在登录过程中被删除，登录最终提交时会冲突（`E_AUTH_STATE_CONFLICT`），并提示重新执行。

### 5.5 账号解析

- `resolveAccountContext({ account, needsAuth })` 的来源只剩 `flag`、`default`、`auto-single` 三种，返回 `{ accountId, slug, displayName, account, source, warnings }`。
- 库里没有任何商家账号时：`needsAuth` 命令报认证错误，提示先执行 `pdd login`（沿用 `E_AUTH_EXPIRED` 或现有的 `accountRequired` 类错误，由实现时对齐现有错误码）；login/init 则走新账号流程。
- `accountMetaForEnvelope` 不变。

## 6. 调用方改造要点

| 调用方 | 改造 |
|---|---|
| `commands/account.js` | `account add` 走 `provisionMerchantLogin`。`account remove <slug>` 删除账号行，级联删除 auth-state、凭据、熔断状态和待办；**删除 `--remove-files` 选项**。`list/default` 改为查库 |
| `commands/init.js`、`login.js` | 删除显式路径分支、pending 路径和 `deleteAuthState(pending)` 清理 |
| `commands/doctor.js` | 账号检查改为读库：auth-state 存在、能解密、元数据可读，再加只读核验。新增旧数据检测（见第 7 节）。`management-view` 中的计数改为数据库统计 |
| `runtime-options.js` | 删除 `opts.authStatePath ??= runtimeConfig.authStatePath` |
| `infra/config.js` | `authStatePath` 移出 Schema，加入退役字段忽略列表（做法同 `refreshIntervalMs`） |
| `services/goods-publish.js` | 软风控时删除消费者 auth-state，改为按 `account_id` 删库中的行 |
| `adapter/browser.js` | `storageStatePath` 输入改为由调用方传入 `storageState` 对象（① 已保留这项能力）。如果没有其他调用方再使用 `storageStatePath`，删除这个参数和 `loadAuthState` 依赖 |
| `services/views/account.js` | 删除 `has_credential` 和 `last_refresh_at`（`has_password` 由 ③ 添加），调整 `disabled` 等字段的来源 |
| `infra/errors.js` | 新增 `E_MASTER_KEY_MISSING / _MISMATCH / _INSECURE`、`E_SECRET_DECRYPT_FAILED`；删除 `credentialDecryptFailed` 及其提到 `PDD_MASTER_PASSWORD` 的 hint；删除 `E_AUTH_STATE_INSECURE` |
| `infra/logger.js` | `REDACT_KEYS` 增加 `state_sealed`、`password_sealed`、`ct`、`master_key` |
| `bin/pdd.js` | 启动时如果 Node 主版本低于 24，输出一行 envelope 错误（`E_USAGE`，exit 2）并提示升级 |

## 7. 旧数据检测

- `doctor` 检查 `dirname(DB_PATH)` 下是否有 `merchant/stores/registry.json`、`consumer/accounts/registry.json`，或任意 `*/auth-state.json`（只看前两层目录）。
- 检测到时：在 `meta.warnings` 中附 `{ code: 'legacy_storage_detected' }`，headline 增加一句"检测到旧版数据，已不再使用，可手动删除"，不输出任何路径和文件内容。
- 由于检测基于 `dirname(DB_PATH)`，测试使用临时 `PDD_DB_PATH` 时，开发机上真实存在的旧数据不会干扰测试。

## 8. 测试改造

- `test/setup.js`：为每个 worker 设置临时 `PDD_DB_PATH`，替代原来的 6 个路径环境变量。
- `test/helpers/isolated-cli.js`：`runCli({ authState, registry })` 改为在子进程启动前，用测试辅助函数 `seedDb(dbPath, { accounts, authStates })` 往沙箱库里预置数据（密文用沙箱里的主密钥生成）。删除 `--all-accounts` 时去掉 `PDD_AUTH_STATE_PATH` 的特殊处理。
- 新增单元测试：
  - `db`：迁移幂等、`transaction` 回滚、在事务内 await 会抛错。
  - `leases`：互斥、同主机 pid 已死时可抢占、pid 存活时即使过期也不可抢、跨主机按过期判定、超时、取消。
  - `master-key`：生成、并发首次生成、POSIX 权限检查、指纹不一致、密钥缺失。
  - `secret-box`：往返、篡改、AAD 不符。
  - `account-store`：唯一约束、默认账号、级联删除。
- 改写现有测试：
  - `merchant-auth-storage.test.js`：改为验证租约 + CAS 的冲突语义、多次提交和 branded 校验。
  - `merchant-auth-save-failure.test.js`：改为验证提交事务失败时回滚、旧数据不变。
  - `merchant-auth-lifecycle.test.js`、`merchant-account-storage.test.js`：注册、slug 稳定、不复活、按 mallId 复用账号。
  - 消费者 slug 稳定性测试。
  - `data-contract-v2.test.js`、`goods-write-contract.test.js`、`diagnose-comparison-contract.test.js`、`management-view.test.js`、`e2e/merchant-auth.e2e.test.js`：改用沙箱库。
- 并发验收：起两个子进程同时对同一账号提交，一个成功、一个冲突，库完整可读。
- 泄露验收：断言库文件中不包含合成 Cookie 的明文值；断言 stdout、stderr、日志中不出现密文字段。

## 9. 文档与 spec 同步

- spec：
  - `adapter/auth-mall-context.md`（存储与锁相关条款整体改写）
  - `infra/env-paths.md`（删除的环境变量、新增 `PDD_DB_PATH`、默认敏感路径改为 `data/pdd.db` 和 `data/master.key`）
  - `standards/testing.md`（沙箱改为使用 `PDD_DB_PATH`）
  - `commands/runner-lifecycle.md:98`（删除并不存在的 `--auth-state-path` 描述）
  - `adapter/browser-runtime.md`、`services/domain-service-contracts.md:130`
- 文档：
  - README（第 5、170 行）
  - `CLAUDE.md:51`、`AGENTS.md:10`
  - `.agents/skills/pdd-adapter-auth-integration`、`pdd-local-development`
  - `skills/pdd-cli/SKILL.md:238-243`
  - `docs/architecture-overview.md` §7.1、§7.2
  - `docs/goods-publish-api-recon.md:45`
- `CHANGELOG.md`：新增 BREAKING 一节；`package.json` 中 `version` 改为 `0.2.0`，`engines` 改为 `>=24`。

## 10. 需要审阅确认的语义变化

| 编号 | 变化 | 理由 |
|---|---|---|
| S-a | 去掉登录期间的注册表级锁，`remove` / `default` 不再等待登录完成；如果账号在登录中途被删除，登录最终提交时报冲突 | SQLite 单库不适合持有长事务；单事务 CAS 已经能保证"不复活" |
| S-b | 删除 `explicit-path` 和 `unregistered-default` 两个账号来源，没有账号时必须先登录 | 落实 PRD N15；登录总会创建账号记录 |
| S-c | 消费者 slug 按 uid 保持稳定，不再随昵称变化而 rekey | 与商家保持一致，并去掉 rekey 的删除和补偿逻辑 |
| S-d | 删除 `account remove --remove-files`，删除账号时总是级联删除该账号的全部数据 | 数据库里不存在"只删注册项、保留文件"这种状态 |
| S-e | 账号视图删除 `has_credential` / `last_refresh_at` | 这两个字段没有写入方；`has_password` 由 ③ 添加 |
| S-f | `authStatePath` 改为退役配置字段：本地配置里出现时忽略，`config set` 时报未知字段 | 避免旧 `config.json` 导致整个 CLI 因配置无效而无法使用 |
| S-g | 主密钥和数据库放在同一目录，`PDD_DB_PATH` 同时决定两者的位置 | 一个环境变量就能完成隔离，测试更简单 |
| S-h | CLI 启动时检查 Node 版本是否 ≥ 24 | 低版本缺少 `node:sqlite`，会在导入阶段报出难以理解的错误 |
