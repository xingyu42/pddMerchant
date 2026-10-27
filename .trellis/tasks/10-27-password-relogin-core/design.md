# 设计：密码重登核心与熔断

需求见同目录 `prd.md`（N1–N19a）。本文只写技术方案。

## 1. 接入点（② 落地后的现状）

- 普通命令：`single-lifecycle.js` `executeLiveOperation` 在 `withMerchantAuthUpdate(accountId, …)` 内整段执行，命令全程持有账号租约；`withBrowser({ storageState: tx.state })` 之后由 `assertAuthValid` 调 `verifyStoredMerchant`。`verdict === 'rejected'`（含 `known_rejected` 短路）即会话失效，`indeterminate` 不算。
- fixture：`executeFixture` 只看 `PDD_TEST_AUTH_INVALID`，不拿租约、不读登录态。
- 人工登录：`services/auth.js` 的 `prepareMerchantSession` → 空上下文 → `authorizeMerchantSession` → `verifyMerchantContext` → `services/auth-account-storage.js` 提交。
- 租约等待：`updateMerchantAuth` 用 `budgetMs(options, 15000)`，未设 `--timeout` 时最多等 15s。
- 预留表与读写函数已在 `db.js` / `account-store.js`；`credentials` 只有 `password_sealed` 一列。
- `authChallengeRequired`、`passwordLoginFormChanged` 无调用方，为英文旧文案。
- 批量（`batch-executor.js` `runAccountLoop`）逐账号 `await executeSingle`，N14 的"依次重登"天然满足，无需改动。

## 2. 模块划分

| 模块 | 层 | 职责 |
| --- | --- | --- |
| `src/adapter/password-credential.js`（新） | adapter | 凭据封装：`savePasswordCredential` / `loadPasswordCredential` / `hasPasswordCredential` / `deletePasswordCredential`；AAD `aad('credentials', accountId)` |
| `src/adapter/password-login.js`（新） | adapter | 在给定 page 上执行一次账密登录并分类结果；fixture 下走 `mockPasswordLogin()` |
| `src/services/password-relogin.js`（新） | services | 重登决策（凭据/状态/限频）、状态机写入、待办、live 与 fixture 两条入口 |
| `src/commands/runner/single-lifecycle.js` | commands | `assertAuthValid` 失效后调用重登；上下文替换；命令截止时间暂停/恢复；待办警告 |
| `src/commands/runner/fixture-runtime.js` | commands | fixture 失效判定改为"环境变量 + 登录态标记"，失效时调用重登 |
| `src/adapter/merchant-auth-storage.js` | adapter | 租约等待支持"持有者正在重登"时延长 |
| `src/infra/leases.js` | infra | `acquireLease` 新增可选 `extendUntil()` |
| `src/services/auth-account-storage.js` | services | 人工登录成功时解除 `awaiting_human`（N9a） |
| `src/infra/logger.js` | infra | 密码类键固定 `[REDACTED]` |
| `src/infra/errors.js` / `timeouts.js` / `config.js` | infra | 新错误码、`TIMEOUTS.LOGIN_PASSWORD`、限频配置 |
| `src/services/views/account.js`、`labels.js`、`commands/doctor.js` | services/commands | N15、N7 输出 |
| `scripts/experiments/password-login-probe.mjs`（新） | 脚本 | N19 实验，不注册到 `bin/pdd.js` |

依赖方向保持 `commands → services → adapter → infra`；`password-relogin.js` 只经 adapter 接触浏览器，经 `account-store.js` 写状态表。

## 3. 凭据

- 明文结构 `{ v: 1, login_name, password }`，整体 `seal()` 后写 `credentials.password_sealed`。登录名通常是手机号，一起加密，表结构不变。
- `savePasswordCredential(accountId, { loginName, password })`：两者均为非空字符串、长度 ≤ 128，否则 `E_USAGE`（错误不带值）；账号必须是商家账号。
- `loadPasswordCredential(accountId)` → `{ loginName, password } | null`；解密失败沿用 `E_SECRET_DECRYPT_FAILED`（detail 只带 `{ slug, kind: 'merchant', table: 'credentials' }`）。
- `hasPasswordCredential(accountId)` 只查行是否存在，不解密，供视图与 doctor 使用。
- ③ 不提供任何录入入口（N1）。测试经 `test/helpers` 中的辅助函数直接调用 `savePasswordCredential`；④ 控制台调用 service 层的 `setAccountPassword`（第 5.4 节）。

## 4. 密码登录适配器

```js
attemptPasswordLogin(page, { loginName, password }, { signal, deadlineAt }) ->
  { outcome: 'success' }
  | { outcome: 'challenge', challenge: 'sms' | 'slider' | 'click' | 'risk_confirm' | 'unknown' }
  | { outcome: 'wrong_password' | 'account_locked' | 'form_changed' | 'network_error' }
```

- 已分类的结果一律返回，不抛错；只有取消/超时抛 `assertAuthTask` 的错误。
- 步骤：`goto(PASSWORD_LOGIN_URL)` → 切到"账号登录"页签 → `fill` 登录名与密码 → 勾选协议（若存在）→ 点击登录（全流程唯一的提交点击）→ 轮询直到出现以下之一：`PASS_ID` Cookie（`hasPassId`）、挑战元素、错误提示文字、截止时间。
- 挑战检测只读 DOM，不点击、不拖动、不触发"发送验证码"；检测到挑战立即返回。
- 提交后到截止时间仍无法分类，按 `challenge: 'unknown'` 处理：转人工，宁可多停一次，也不盲目重试。
- 选择器和文案集中在冻结常量 `PASSWORD_LOGIN_SELECTORS` / `PASSWORD_LOGIN_TEXTS` 中，初版沿用 `a468d02^:src/adapter/password-login.js`，再按 N19 实验结果校准。
- 安全：密码只在 `fill` 时传入；Playwright 抛出的原始错误一律转换为固定 reason，绝不把 `err.message` 写进日志或 envelope。
- fixture：`isMockEnabled()` 时调用 `mockPasswordLogin()`，读取以下测试变量：

| 变量 | 含义 |
| --- | --- |
| `PDD_TEST_PASSWORD_LOGIN` | 结果，默认 `success`；可取 `challenge:<type>`、`wrong_password`、`account_locked`、`form_changed`、`network_error` |
| `PDD_TEST_PASSWORD_LOGIN_DELAY_MS` | 人为延迟，用于并发测试 |
| `PDD_TEST_PASSWORD_LOGIN_TRACE` | 每次尝试向该文件追加一行，只写结果，用于断言登录次数 |

## 5. 重登服务（`services/password-relogin.js`）

### 5.1 状态机（`relogin_states`；没有这一行等同于 `available`）

| 事件 | status | reason | 其他 |
| --- | --- | --- | --- |
| 开始尝试 | 不变（available） | 不变 | `last_attempt_at = now`，在浏览器工作前写入，进程崩溃也计入限频 |
| success | available | `success` | `consecutive_takeover_timeouts = 0` |
| challenge | awaiting_human | 挑战类型 | 插入 open 待办 `kind='human_takeover'` |
| wrong_password / account_locked | blocked | 同名 | 插入 open 待办 `kind='relogin_blocked'` |
| form_changed / network_error / verify_failed | available | 同名 | 不熔断 |
| 人工登录成功（N9a） | awaiting_human → available | `manual_login` | 关闭 open `human_takeover`；blocked 不变 |
| 重设密码 `setAccountPassword`（④） | → available | `password_reset` | `last_attempt_at = null`，关闭全部 open 待办，计数清零 |
| 手动解除 `clearReloginBlock`（④） | blocked → available | `manual_unblock` | `last_attempt_at = null`，关闭 `relogin_blocked` |
| 接管超时 `recordTakeoverTimeout`（④） | 计数 +1；达到 2 时 → blocked | `takeover_timeout` | 达到 2 时插入 `relogin_blocked` |

- 同一账号同一 kind 只能有一条 open 待办（唯一索引）；重复插入时保留已有那条。
- 状态与待办的写入放在同一个短 `transaction()` 中，并先调用 `assertLeaseOwner('account', accountId, tx.token)`。

### 5.2 决策 `decideRelogin(accountId, { now, minIntervalMs })`（同步、只读）

按以下顺序判断，返回 `{ action: 'attempt', credential }` 或 `{ action: 'fail', error }`：

1. 没有凭据 → 原样抛出 `E_AUTH_EXPIRED`（N6，提示 `pdd login`）。
2. `blocked` → `E_AUTH_RELOGIN_BLOCKED`。
3. `awaiting_human` → `E_AUTH_HUMAN_REQUIRED`，不尝试。
4. `now - last_attempt_at < minIntervalMs` → 按上次的 reason 还原错误类别：
   - `success` → `E_AUTH_EXPIRED`
   - `form_changed` → `E_PASSWORD_LOGIN_FORM_CHANGED`
   - 其他 → `E_AUTH_RELOGIN_FAILED`
   - detail 都附 `{ relogin: 'throttled', next_attempt_at }`（N10）。
5. 否则尝试。凭据只在这一步解密。

### 5.3 两条入口

**live**：`reloginInCommand(runtime, tx, browser) -> { context, page }`，由 runner 在 `assertAuthValid` 得到 `rejected` 后调用。此时已持有租约。

1. 调用 `decideRelogin`，结果是 fail 时直接抛错；然后记录"开始尝试"。
2. 暂停命令截止时间（第 6 节）。重登任务使用独立预算：`deadlineAt = now + TIMEOUTS.LOGIN_PASSWORD`，`signal` 为父信号（SIGINT）加重登自身计时器。适配器使用同一信号，截止时间提前 `TIMEOUTS.LOGIN_PASSWORD_RESERVE`（20s），获得 70s 登录预算，预留时间用于结果记录和 `verifyMerchantContext`，后两者继续使用完整的 90s 重登任务。
3. 创建设备延续的快照上下文：取 `tx.state` 的 cookies/origins，去掉所有 `PASS_ID` 会话 Cookie，其余（设备标识类 Cookie、localStorage）原样保留，`createSnapshotContext(browser, filtered)` 后 `newPage()`，再执行 `attemptPasswordLogin`。`tx.state` 不可用（corrupt）时才退回空上下文。依据：实验显示空白上下文必触发短信；用户经验是账密登录过一次短信后，同一设备后续登录不再要求短信（2026-10-27，`research/real-login-experiment.md`）。重登成功后提交的候选状态自然包含新的设备 Cookie，信任得以延续。
4. 如果是 success：关闭登录页，执行 `verifyMerchantContext(newContext, { expectedMallId: account.identity })`。
   - 结果为 `verified`：`commitMerchantCandidate(candidate, tx)`，记为 success，`renewLease`，关闭旧上下文，返回新的 `{ context, page }`。
   - 结果为非 `verified`：记为 `verify_failed`，抛 `E_AUTH_RELOGIN_FAILED`；身份不一致时沿用 `E_ACCOUNT_IDENTITY_MISMATCH`。
5. 其他结果：按 5.1 写状态，然后抛对应错误。
6. 无论成败，都恢复命令截止时间。失败路径负责关闭新建的上下文。

**fixture**：`reloginForFixture(accountId, task)`。

1. 先用 `withMerchantAuthUpdate` 拿租约。
2. 在租约内检查：若 `tx.state` 已带 fixture 重登标记，说明别的进程刚登录过，直接复用，不再尝试（N12）。
3. 否则执行与 live 相同的 `decideRelogin`、"开始尝试"记录和结果记录，浏览器部分换成 `mockPasswordLogin()`。
4. 成功时，在租约与 CAS 下写入带标记的登录态 `{ cookies: [PDD_FIXTURE_RELOGIN=1 …], origins: [], merchant_auth: {…verified} }`。

fixture 的失效判定改为：`PDD_TEST_AUTH_INVALID=1` 且当前账号登录态中没有 `PDD_FIXTURE_RELOGIN` 标记 Cookie。只读判定不需要租约，重登时在租约内复核。

### 5.4 ④ 预留的 service 函数

`setAccountPassword(accountId, { loginName, password })`、`clearAccountPassword(accountId)`、`clearReloginBlock(accountId)`、`recordTakeoverTimeout(accountId)`、`getReloginSummary(accountId) -> { has_password, status, reason, last_attempt_at }`。③ 实现并测试；入口由 ④ 接入。

`clearAccountPassword` 删除凭据、关闭 open 待办，状态回到 available。之后会话再失效时按 N6 提示 `pdd login`。

## 6. Runner 改造

- `armDeadline` 返回值增加 `pause()` / `resume()`：
  - `pause` 清除计时器，记下剩余时间。
  - `resume` 以剩余时间重新计时，并更新 `runtime.deadlineAt`。
  - 未设 `--timeout` 时两者都是空操作。
  - 这样实现 N13：重登耗时不占命令原有预算，SIGINT 仍然有效。
- `executeLiveOperation` 中的 `context` / `page` 改为可替换：`assertAuthValid` 在 `rejected` 时调用 `reloginInCommand`，后续 `goto(PDD_HOME)`、`createPageSession`、`persistAuthStateAfterSuccess` 都使用新上下文。
- 租约等待（N12）：`acquireLease(…, { extendUntil })`。
  - 原等待预算耗尽时调用 `extendUntil()`，若返回更晚的时间戳则继续等待。
  - `updateMerchantAuth` 传入的实现：当该账号的 `last_attempt_at` 在 `TIMEOUTS.LOGIN_PASSWORD` 窗口内时，返回 `last_attempt_at + LOGIN_PASSWORD + 15s`。
  - 仍受等待方自身 `deadlineAt` 与 signal 约束。
  - 等待方拿到租约后读到新 revision，校验为 verified，不会再次登录。
  - 选择条件延长，没有把所有命令的等待统一放宽到 120s：长耗时命令持有租约时，其他命令仍按原 15s 快速失败。
- 待办警告（N16 / N16a）：`needsAuth` 命令在构造 envelope 前（成功与失败两条路径、live 与 fixture 都要覆盖）调用 `appendActionWarnings(runtime)`。
  - 对当前账号的每条 open 待办追加 `{ code: 'account_action_required', account: slug, reason }`。
  - 本次重登刚写入的待办同样会出现在本次输出中。
  - 批量模式由现有循环把各账号警告汇总到 batch 警告中。
- `needsAuth:false` 命令（doctor、account list 等）不调用重登，也不附加待办警告（N7、N16a）。

## 7. 人工登录解除（N9a）

`saveMerchantLogin` 在已有账号的提交事务里调用 `markManualLoginSucceeded(accountId)`：只把 `awaiting_human` 改为 available / `manual_login`，并关闭 open `human_takeover`。新建账号时不写状态行。

## 8. 错误码（`errors.js`，exit 均为 3）

| 函数 | code | message | hint | detail |
| --- | --- | --- | --- | --- |
| `authHumanRequired` | `E_AUTH_HUMAN_REQUIRED` | 账号登录需要人工完成验证 | 执行 pdd console link 获取控制台链接并转给用户；不要在聊天中索要密码 | `{ account, challenge }` |
| `reloginBlocked` | `E_AUTH_RELOGIN_BLOCKED` | 账号自动重登已熔断 | 执行 pdd console link 重设密码或解除熔断，或执行 pdd login --qr 扫码登录 | `{ account, reason }` |
| `reloginFailed` | `E_AUTH_RELOGIN_FAILED` | 自动重登未完成 | 稍后重试或执行 pdd login | `{ account, reason, relogin?, next_attempt_at? }` |
| `passwordLoginFormChanged`（改写） | `E_PASSWORD_LOGIN_FORM_CHANGED` | 登录页结构已变化，无法自动填写账密 | 执行 pdd login --qr 扫码登录，并反馈此问题 | `{ account }` |

- 删除无调用方的 `authChallengeRequired`。
- 所有 detail 都不带登录名、密码、URL 或页面文字。
- `pdd console link` 由 ④ 提供；在 ④ 上线前，真实环境中没有凭据，这些错误不会出现。

## 9. 配置与超时

- `TIMEOUTS.LOGIN_PASSWORD = 90_000`。Hermes 前台命令默认 180s 超时，重登加上普通命令要留出余量。
- 配置字段 `passwordReloginMinIntervalMs`，对应 env `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS`，正整数，默认 `1_800_000`（N10 的"可配置"）。

## 10. 输出

- 新增 `labels.js` 标签表：
  - `PASSWORD_RELOGIN_STATUS_LABEL`：`available` 可用 / `awaiting_human` 等待人工 / `blocked` 已熔断。
  - `PASSWORD_RELOGIN_REASON_LABEL`：`sms` 短信验证 / `slider` 滑块验证 / `click` 点选验证 / `risk_confirm` 风控确认 / `unknown` 未识别的验证 / `wrong_password` 密码错误 / `account_locked` 账号被锁 / `takeover_timeout` 接管超时。
- `account list`（N15）：每项增加
  - `has_password: boolean`；
  - `password_relogin_status`：没有密码时为 `null`；`available` 为 `可用`；其余为 `等待人工：短信验证`、`已熔断：密码错误` 这类"状态：原因"格式。
  - `ACCOUNT_VIEW_FIELDS` 与契约测试同步更新。
- `doctor`（N7）：
  - 当前商家账号增加 `data.password_relogin = { has_password, status }`，`status` 的取值同上；
  - `data.accounts[]` 各项增加同样两个字段；
  - `renderDoctor` 增加一行人类可读状态。
  - doctor 不调用重登。

## 11. 日志脱敏（② 移交 M2）

- 新增 `SECRET_KEYS`：`password`、`password_sealed`、`masterPassword`、`master_key`、`credential`、`credentials`、`login_name`、`loginName`。命中这些键的值固定输出 `'[REDACTED]'`，不再输出指纹。
- 原因：8 位指纹可以被枚举，短密码和 11 位手机号都能反推。
- 其余 `REDACT_KEYS` 保持指纹（指纹用于关联比对）。
- `PDD_DEBUG_RAW` 走同一个 `redactRecursive`。

## 12. 真实账号实验脚本（N19 / N19a）

- `scripts/experiments/password-login-probe.mjs [--attempts 1..3]`，默认 1 次，上限 3 次，两次之间至少间隔 60s。
- 要求 `process.stdin.isTTY`，否则退出。登录名与密码以静音回显的 readline 读入，只存在内存中。
- 每次尝试：headless `launchBrowser` → 空上下文 → `attemptPasswordLogin`。
  - 遇到 `slider` 立即停止全部后续尝试。
  - 遇到其他挑战，记录后结束本次尝试，不点击任何元素。
  - 结果为 success 时，只执行 `verifyMerchantContext`（GET checkLogin、querySimpleCredential、queryMallAuditInfo，均为只读）；不写库、不改登录态。随后打开首页观察是否出现二次验证。
- 观察项：
  - 结果类别与挑战类型；
  - 短信验证码是否在未点击时已经发出，依据倒计时或"已发送"文字的出现与否；
  - 新会话是否要求再次验证；
  - 各阶段耗时；
  - 挑战容器的 class / id 名（不含任何页面文字），用于校准选择器。
- 报告写到 `log/password-login-experiment-<ts>.json`（已被 gitignore），不含登录名、密码、Cookie、截图或带参数的 URL。Claude 读取后整理成本任务的 `research/real-login-experiment.md`。
- 脚本不会被测试或 CI 执行；只做静态检查：不 import `account-store` 的写函数，也不调用 `commitMerchantCandidate`。

## 13. 测试

- 单元测试：
  - `password-credential`：往返、AAD 绑定账号、篡改、输入校验、错误中不含值。
  - `password-relogin`：决策顺序、状态机各行、限频还原、待办唯一、租约不属于自己时拒绝写入。
  - `password-login`：用 fake page 覆盖每个结果分支；断言挑战分支在提交点击之后没有任何 click/press。
  - `leases`：`extendUntil` 的延长与终止。
  - `logger`：`[REDACTED]`；密码值和它的 sha256 指纹前缀都不出现在输出中。
  - `armDeadline` 的 pause/resume。
- e2e（fixture，临时 `PDD_DB_PATH`）：
  - 失效 + 有密码 → 重登成功 → 命令成功，stdout 一行。
  - 4 类挑战 → `E_AUTH_HUMAN_REQUIRED`，产生 open 待办，带 `account_action_required` 警告。
  - 密码错误、账号被锁 → 熔断；熔断后 trace 中没有新增尝试。
  - 三种解除方式（重设密码、手动解除、人工登录只解除 awaiting_human）。
  - 限频窗口内不尝试。
  - 两个进程并发 → trace 中只有一行，两个命令都 exit 0。
  - `PDD_DEBUG_RAW=1` 时，stdout、stderr、日志文件、库文件字节中都不含密码明文。
  - doctor 不触发重登。
  - `--all-accounts` 时依次重登。
- 契约：`test/contract/data-contract-v2.test.js` 覆盖 `account list` 新字段和 doctor 的 `password_relogin`。

## 14. 文档与 spec（Claude）

- spec：
  - `adapter/auth-mall-context.md` 新增"密码重登"场景（7 段）；
  - `infra/sqlite-storage.md`（凭据格式、状态机表）；
  - `infra/logging-redaction.md`（`[REDACTED]` 类）；
  - `infra/envelope-errors-output.md`（新错误码）；
  - `commands/runner-lifecycle.md`（重登步骤、截止时间暂停、租约延长、待办警告）；
  - `adapter/fixture-mode.md` 与 `infra/env-paths.md`（新 env）。
- 文档：`skills/pdd-cli/SKILL.md`（N18）、`CHANGELOG.md` 未发布一节。版本号留到父任务整体发布时再改。

## 14a. 实验结论对设计的影响（2026-10-27）

- 提交账密本身就会触发短信发送，"不点击就不发送"不成立；状态机已保证每次会话失效最多一条短信（首次挑战即转 `awaiting_human`）。
- 设备信任需要先由人工在同一设备状态下完成一次短信验证才能建立，这一步依赖 ④ 的接管视图；④ 的交互式重登同样必须从设备延续的上下文开始，并在成功后提交新状态。
- 第 2 次实验停在未识别状态（未收到短信），按 `challenge: unknown` 转人工，具体形式留待 ④ 接管视图中观察后再补充选择器。
- 实验脚本已删除；设计第 12 节仅作历史记录。

## 15. 回滚

各阶段独立提交。P3 接入 runner 是唯一改变现有命令行为的提交：回滚它即恢复为"失效即提示 `pdd login`"，P1、P2 的表写入和适配器可以保留，不影响现有功能。
