# SQLite Account and Auth-State Storage

## 1. Scope / Trigger

适用于修改 `src/infra/db.js`、`master-key.js`、`secret-box.js`、`leases.js`、`account-store.js`、`src/adapter/auth-state.js`，或任何读写账号、登录态、凭据、熔断状态、待办的代码。商家认证检查与提交流程见 [auth-mall-context.md](../adapter/auth-mall-context.md) 第 8 节。

自 0.5.0 起，账号和登录态只存在于 SQLite；旧的 JSON 注册表、`auth-state.json` 文件、文件锁和 `credential-vault` 已删除，不迁移、不读取。

## 2. Signatures

```text
data/pdd.db          默认数据库（PDD_DB_PATH 覆盖）；never commit
<dirname(DB)>/master.key   主密钥，始终与数据库同目录；never commit，与库一起备份/恢复
```

```js
// src/infra/db.js — 全仓库唯一 import 'node:sqlite' 的文件
openDatabase(path = databasePath ?? DB_PATH) -> DatabaseSync   // 懒加载单连接；WAL、synchronous=NORMAL、foreign_keys=ON、busy_timeout=5000；按 user_version 迁移
closeDatabase()                                 // 连接 generation +1；process exit 时自动调用
transaction(callback) -> result                 // BEGIN IMMEDIATE；callback 返回 Promise 直接抛错
get(sql, ...params) / all(...) / run(...)
isInTransaction() / getDatabasePath() / getDatabaseGeneration()

// src/infra/master-key.js
getMasterKey() -> Buffer(32)   // 按 (数据库路径, generation) 记忆；首次生成写 meta.master_key_fingerprint

// src/infra/secret-box.js
aad(table, id) -> 'pdd-cli:v1:<table>:<id>'
seal(obj, aad) -> string        // JSON { v:1, iv, tag, ct }，AES-256-GCM，12 字节随机 IV
open(sealed, aad) -> obj        // 任何失败 -> E_SECRET_DECRYPT_FAILED

// src/infra/leases.js
acquireLease(scope, key, { timeoutMs = 30000, retryMs = 200, ttlMs = timeoutMs + 30000, signal, extendUntil, deadlineAt }) -> { token }
// extendUntil() -> ms | null：原等待预算耗尽时调用，返回更晚的时间戳则继续等待；始终受 deadlineAt 约束
renewLease(scope, key, token, { ttlMs }) / releaseLease(scope, key, token) / assertLeaseOwner(scope, key, token)

// src/infra/account-store.js
listAccounts({ kind = 'merchant', includeDisabled = false })
getAccount(slug, { kind, allowDisplayName }) / getAccountById(id) / findAccountByIdentity(kind, identity)
insertAccount({ kind, identity, displayName, lastLoginAt, lastUsedAt }, { setDefault })
updateAccount(id, { displayName, lastLoginAt, lastUsedAt, disabled }) / setDefaultAccount(slug, { kind }) / removeAccount(slug, { kind })
getCredential / putCredential(accountId, passwordSealed) / deleteCredential  // putCredential 的 updated_at 严格单调递增
getReloginState / putReloginState(accountId, { status, reason, consecutiveTakeoverTimeouts, lastAttemptAt })
listPendingActions / insertPendingAction / resolvePendingAction
ensureOpenPendingAction(accountId, { kind, reason }) -> id        // 同 kind 已有 open 行时返回已有 id
resolveOpenPendingActions(accountId, kind = null) -> changes      // kind 为 null 时关闭全部 open 行

// src/adapter/password-credential.js（明文 { v:1, login_name, password }，AAD aad('credentials', accountId)）
savePasswordCredential / loadPasswordCredential / hasPasswordCredential / deletePasswordCredential

// src/adapter/auth-state.js
loadAuthState(accountId, { allowCorrupt }) -> { accountId, exists, state, revision, metadata, corrupt }
getAuthStateRevision(accountId) -> number      // 无行为 0
saveAuthStateSnapshot(state, accountId, { expectedRevision }) -> newRevision
deleteAuthState(accountId) -> { removed, existed }
authStateConflict() -> PddCliError(E_AUTH_STATE_CONFLICT)
```

Schema v1 表：`meta`、`accounts`、`auth_states`、`leases`、`credentials`、`relogin_states`、`pending_actions`（完整 DDL 见 `src/infra/db.js` 的 `SCHEMA_V1`）。后续任务只能以 v2、v3… 追加迁移，不修改既有列语义。

## 3. Contracts

- 只有 `src/infra/db.js` 可以 import `node:sqlite`；其他模块经 `db.js` 访问数据库。
- 事务必须短小且同步：**禁止在事务内 await 浏览器、网络或任何 Promise**。浏览器/网络工作在两个事务之间完成。
- `accounts`：`UNIQUE(kind, slug)`、`UNIQUE(kind, identity)`，每个 kind 最多一个默认账号。`identity` 商家为 mall_id、消费者为 uid。slug 由 `slugifyStorageName(displayName, { existingSlugs, stableId: identity })` 生成，生成后不随显示名变化。
- 账号 ID 由 `meta.account_sequence` 单调分配，删除后不复用。原因：AAD 绑定账号 ID，复用 ID 会让被删账号的旧密文在新账号下仍可解开。
- `removeAccount` 删除账号行，外键 `ON DELETE CASCADE` 一并删除 auth_states、credentials、relogin_states、pending_actions。不存在"只删账号、保留登录态"的状态。
- 加密范围：`auth_states.state_sealed` 封装整个 `{ cookies, origins }`；`credentials.password_sealed` 封装 `{ v:1, login_name, password }`，登录名（通常是手机号）一起加密，表结构不变。账号名、mall_id、uid、校验结论等元数据以明文列存储，便于查询与视图投影。
- 主密钥文件为 `{ "version": 1, "key": "<base64>" }`，`wx` + `0o600` 创建；并发首次生成时 `EEXIST` 一方改读。POSIX 读取时要求 0600；Windows 创建后尽力执行 `icacls` 收紧到当前用户，失败只记日志。
- 库中已有指纹而密钥文件缺失时 **不得重新生成**密钥。
- 租约 `scope='account'`、`key=accountId` 取代旧的 auth-state 文件锁，没有注册表级锁。失效判定：同主机 pid 已死立即失效；同主机 pid 存活时即使过期也不失效；跨主机按 `expires_at`。
- `auth_states.revision` 每次写入 +1；`expectedRevision = 0` 表示 INSERT，否则 `UPDATE … WHERE account_id = ? AND revision = ?`，0 行变更或账号已不存在即 `E_AUTH_STATE_CONFLICT`。
- 输出（envelope、stderr、日志）不得包含数据库路径、密钥路径、密文或 Cookie 值；`state_sealed`、`password_sealed`、`master_key` 在 `REDACT_KEYS` 中（`iv`/`tag`/`ct` 故意不加，见 [logging-redaction.md](./logging-redaction.md)）。`openDatabase` 与 `getMasterKey` 内部把原生 fs/SQLite 错误转换为不带路径的 `PddCliError`。
- 数据库 `user_version` 高于代码支持的版本时拒绝运行（`E_DATABASE_VERSION_UNSUPPORTED`），防止旧版本在新 schema 上静默运行。
- 已知未处理（超出威胁模型，2026-10-27 最终审查记录）：Windows 首次初始化（库中无指纹）会直接采用目录中已存在的 `master.key` 且不校验 ACL；能写数据目录的其他身份可借此预置密钥。改名重建会破坏同目录多库共用密钥与"清空数据库重建"的正常路径，故仅记录。同主机租约按 pid 存活判定，pid 被复用时会阻塞到该进程退出，留待 ④ 的心跳续期一并处理。
- `credentials.updated_at` 严格单调：同一毫秒内重设密码也会推进，重登结果据此判断凭据是否在尝试期间被重设（过期结果不写熔断状态）。
- `relogin_states` 状态取值 `available` / `awaiting_human` / `blocked`，无行等同 `available`；`pending_actions.kind` 取值 `human_takeover` / `relogin_blocked`，同账号同 kind 最多一条 open。状态机与写入规则见 [auth-mall-context.md](../adapter/auth-mall-context.md) 第 9 节。
- `hasPasswordCredential` 只查行是否存在、不解密，供 `account list` / doctor 使用；只读命令因此不需要主密钥可用即可显示是否有密码。
- fixture 模式（`PDD_TEST_ADAPTER=fixture`）下登录同样写库：`pdd login` 创建假商家账号（首个商家设为默认），`pdd login --consumer` 创建假消费者账号并设为消费者默认。这是"登录总会创建账号记录"的直接结果（2026-10-27 用户确认），所以任何 fixture 调用都必须配临时 `PDD_DB_PATH`。

## 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| 事务 callback 返回 Promise | 回滚并抛 `E_GENERAL`（"数据库事务回调必须同步完成"，编程错误） |
| 主密钥文件缺失但库中有指纹 | `E_MASTER_KEY_MISSING`，exit 3；不重新生成 |
| 主密钥指纹与库不一致 | `E_MASTER_KEY_MISMATCH`，exit 3 |
| POSIX 下主密钥权限不是 0600 | `E_MASTER_KEY_INSECURE`，exit 3 |
| 密文被篡改 / AAD 不符 / 格式错误 | `E_SECRET_DECRYPT_FAILED`，exit 3；错误不含密文或明文 |
| 解密后缺少 cookies/origins 数组 | `E_AUTH_STATE_CORRUPT`；仅 `allowCorrupt`（可信 recoveryMallId 重新授权）放行 |
| 租约等待超时 | `E_LOCK_TIMEOUT` |
| 提交时租约已被抢占 | `E_AUTH_LOCK_LOST` |
| revision 不匹配或账号已被删除 | `E_AUTH_STATE_CONFLICT`（不复活账号） |
| 数据库或主密钥文件无法打开/读写 | `E_AUTH_STATE_IO`（exit 3）；不暴露路径 |
| 账号表读写失败 | `E_AUTH_ACCOUNT_SAVE_FAILED` |
| 数据库 schema 版本高于代码支持 | `E_DATABASE_VERSION_UNSUPPORTED`（exit 3），提示升级 pdd-cli |
| 密码凭据输入为空、非字符串或超过 128 字符 | `E_USAGE`；错误不含输入值 |
| 凭据密文无法解密 | `E_SECRET_DECRYPT_FAILED`，detail 仅 `{ slug, kind: 'merchant', table: 'credentials' }` |
| 重登状态/待办写入失败 | `E_AUTH_ACCOUNT_SAVE_FAILED`（"账号重登状态存储暂不可用"） |
| slug 不存在 | `E_ACCOUNT_NOT_FOUND` |
| 商家显示名匹配多个账号 | `E_ACCOUNT_AMBIGUOUS` |
| doctor 遍历账号时单个账号解密失败 | 该账号 `auth_file = { ok:false, detail:{ error:'auth_state_undecryptable' } }`，继续检查其余账号；`E_MASTER_KEY_*` 仍整体抛出 |
| doctor 当前选中的商家/消费者账号解密失败 | `E_SECRET_DECRYPT_FAILED`，`error.detail = { slug, kind }`；hint 提示先 `pdd account remove --slug <slug>` 再登录（该行无法被登录原地替换） |

## 5. Good/Base/Bad Cases

- Good：在 `withMerchantAuthUpdate` 回调里完成浏览器工作，最后用一个短事务 CAS 提交。
- Good：测试和 fixture 调用都设临时 `PDD_DB_PATH`，库和密钥同时被隔离。
- Base：两个进程同时提交同一账号，一个成功、一个 `E_AUTH_STATE_CONFLICT`，库保持可读。
- Base：账号被删后重新登录同一店铺，会创建新的账号行和新账号 ID；旧 ID 的 AAD 不会再被使用。
- Bad：在 `transaction()` 内 `await page.goto(...)`，阻塞事件循环并长期持有写锁。
- Bad：主密钥缺失时自动生成新密钥，导致所有旧密文永久无法解密。
- Bad：在错误 message/hint 中带上数据库路径或 `state_sealed` 片段。

## 6. Tests Required

- `test/infra/db.test.js`：迁移幂等、事务回滚、事务内返回 Promise 抛错。
- `test/infra/leases.test.js`：互斥、同主机死 pid 可抢、活 pid 过期不可抢、跨主机按过期判定、超时、取消。
- `test/infra/master-key.test.js`：生成、并发首次生成、POSIX 权限（win32 跳过）、指纹不一致、密钥缺失。
- `test/infra/secret-box.test.js`：往返、篡改、AAD 不符。
- `test/adapter/password-credential.test.js`：凭据往返、AAD 绑定账号、篡改、输入校验、错误不含值；`updated_at` 单调。
- `test/infra/account-store.test.js`：唯一约束、每 kind 一个默认、级联删除、slug 稳定、ID 不复用。
- `test/e2e/sqlite-auth-storage.e2e.test.js`：并发提交一胜一冲突；库文件字节不含合成 Cookie 明文；stdout/stderr/日志不含密文字段和库/密钥路径；doctor 单账号不可解密时继续。
- `node:sqlite` 只在 `src/infra/db.js` 出现：`grep -rn "node:sqlite" src bin`。

## 7. Wrong vs Correct

### Wrong

```js
transaction(async () => {
  const result = await verifyMerchantContext(context, task); // 事务内 await
  saveAuthStateSnapshot(result.candidate.state, accountId);
});
```

### Correct

```js
await withMerchantAuthUpdate(accountId, async (tx) => {
  const result = await verifyMerchantContext(context, task); // 事务外
  assertMerchantVerified(result);
  commitMerchantCandidate(result.candidate, tx);             // 同步短事务 + CAS
});
```
