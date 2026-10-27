# Auth and Mall Context Contracts

## 1. Scope / Trigger

适用于修改 `src/adapter/auth-state.js`、`src/adapter/merchant-auth-storage.js`、`src/adapter/consumer-qr-login.js`、`src/adapter/mall-reader.js`、`src/adapter/mall-writer.js`、`src/adapter/mall-switcher.js`、`src/adapter/mall-id.js`、`src/services/auth.js`、`src/services/auth-account-storage.js`、`src/commands/login.js`、账号解析与商家即时认证检查。存储层本身（库、主密钥、加密、租约、账号表）见 [sqlite-storage.md](../infra/sqlite-storage.md)。

## 2. Signatures

Auth/mall 相关路径：

```text
data/pdd.db (PDD_DB_PATH)               accounts + encrypted auth state; never commit
<db dir>/master.key                     master key beside the DB; never commit
src/infra/account-store.js              account CRUD on the accounts table
src/infra/account-resolver.js           merchant account resolution (flag / default / auto-single)
src/infra/consumer-account-resolver.js  consumer account resolution (same three sources)
src/adapter/consumer-qr-login.js        owns CONSUMER_LOGIN_URL
src/adapter/mall-reader.js              resolves mall context
src/adapter/mall-switcher.js            switches requested mall
src/commands/login.js / init            login and QR login commands
```

重要 env：

```text
PDD_DB_PATH=<path>
PDD_MALL_ID_STRICT_PARSE=0
PDD_TEST_AUTH_INVALID=1
PDD_TEST_CONSUMER_AUTH_INVALID=1
```

`CONSUMER_LOGIN_URL` 固定为 `https://mobile.yangkeduo.com/login.html`，不对应 JSON 字段或环境变量。

Mall context resolution order:

```text
mock -> state -> url -> cookie -> storage -> xhr -> dom
```

## 3. Contracts

- The database, master key and logs MUST NOT be committed or exposed; output never contains the DB/key path or sealed material。
- Merchant login identity MUST come from HTTP 200 + boolean success=true + fixed `result.merchantMainSimpleVO.mallId/mallName` on GET `/earth/api/mallInfo/querySimpleCredential`. URL/cookie/storage/DOM/arbitrary XHR field search MUST NOT prove auth ownership. Consumer identity remains validated `user/me` `{ uid, nickname }`.
- Account resolution returns `{ accountId, slug, displayName, account, source, warnings }` with `source ∈ { flag, default, auto-single }`. With no merchant account, `needsAuth` commands fail with `E_AUTH_EXPIRED` and hint `执行 pdd login 完成授权`; several enabled accounts without a default fail with `E_ACCOUNT_REQUIRED`; `needsAuth:false` commands and login/init proceed without an account.
- `--consumer-account` selects a consumer account independently from merchant `--account`. Consumer accounts are keyed by uid; the slug stays stable and only `display_name` updates on re-login; a successful consumer login becomes the consumer default.
- Goods-publish source browsing and degradation cleanup MUST use the same resolved consumer `accountId` (cleanup deletes that account's `auth_states` row).
- Browser contexts receive the decrypted `storageState` object in memory; no temporary auth-state file is written.
- Login/init failures MUST map to auth exit code 3 when credentials/session are invalid。
- QR login MAY render terminal QR and save PNG, but QR content and credentials MUST NOT be logged raw。
- Consumer QR、headed 与 fixture login MUST 共用 `src/adapter/consumer-qr-login.js` 的 `CONSUMER_LOGIN_URL`。`consumerLoginUrl` 不属于公开运行配置，`PDD_CONSUMER_LOGIN_URL` 不得重新加入 env 映射；登录页改版应连同选择器和流程一起修改、测试。
- `--mall <id>` MUST resolve/switch mall context before domain endpoint execution。
- Default mall id parsing is strict `1-15` digits; `PDD_MALL_ID_STRICT_PARSE=0` MAY allow up to 64 chars。
- Mall context readers MUST preserve the 6-layer probe order unless an OpenSpec-approved design changes it。

## 4. Validation & Error Matrix

| 条件                                            | 行为                                                 |
| ----------------------------------------------- | ---------------------------------------------------- |
| missing or expired auth state                   | `E_AUTH_EXPIRED` / exit code 3; hint login/init      |
| `pdd config set consumerLoginUrl ...`           | `E_CONFIG_INVALID` unknown field; local file unchanged |
| legacy `PDD_CONSUMER_LOGIN_URL` is present      | ignored; login still uses the code-owned constant    |
| requested mall id invalid in strict mode        | usage/business error before endpoint call            |
| mall cannot be resolved by all probes           | auth/business error with diagnostic hint             |
| `--account <slug>` not in the database          | `E_ACCOUNT_NOT_FOUND`; do not create implicit accounts |
| no merchant account and `needsAuth`             | `E_AUTH_EXPIRED` / exit 3; hint `执行 pdd login 完成授权` |
| concurrent login/command persistence             | account lease + revision CAS; loser gets `E_AUTH_STATE_CONFLICT` |

## 5. Good/Base/Bad Cases

- Good：runner resolves auth/account/mall once and passes context through `ctx`。
- Good：QR、headed 和 fixture 登录从同一个 `CONSUMER_LOGIN_URL` 常量取值。
- Base：站点入口真实变更时，在 adapter 中修改常量并同步登录选择器/流程测试。
- Base：doctor command can probe mall context without invoking unrelated write endpoints。
- Bad：把很少变化的消费端登录页放进 `config.example.json` 或允许 env 覆盖，导致配置面扩大且只改 URL 无法解决 UI 改版。
- Bad：service queries `auth_states` or calls `secret-box.open()` directly, bypassing `auth-state.js` and runner/account isolation。

## 6. Tests Required

- Auth invalid env simulation tests for merchant and consumer auth。
- Consumer login constant tests MUST assert the exact code-owned URL and that `CONFIG_FIELD_DEFINITIONS` excludes `consumerLoginUrl`。
- Mall id strict/relaxed parser tests。
- Mall context tests covering probe order and fallback behavior。
- Lease/CAS tests (`test/infra/leases.test.js`, `test/adapter/merchant-auth-storage.test.js`) when changing verification, persistence or lease behavior。

## 7. Wrong vs Correct

### Wrong

```js
// ❌ 将站点入口扩大为用户配置
consumerLoginUrl: { env: 'PDD_CONSUMER_LOGIN_URL', required: true };

const row = get('SELECT state_sealed FROM auth_states WHERE account_id = ?', ctx.accountId); // 绕过 auth-state.js
```

### Correct

```js
// ✅ 外部登录边界单点拥有固定入口
export const CONSUMER_LOGIN_URL = 'https://mobile.yangkeduo.com/login.html';

// Command handler receives resolved context via runner:
export const run = withCommand({
  name: 'orders.list',
  needsAuth: true,       // runner resolves auth before run()
  needsMall: 'switch',   // runner resolves + switches mall before run()
  async run(ctx) {
    // mall_id 由 service 从 ctx.mallCtx 读取（views/_shared.js mallIdOf）并放入 v2 data
    return getOrderListView(ctx.page, ctx.config, ctx);
  },
});
```

### Real test seams (`src/adapter/fixtures/core.js`):

```js
export function isMockEnabled() {
  return process.env[ENV_ENABLED] === 'fixture';
}

// ENV_AUTH_INVALID / ENV_CONSUMER_AUTH_INVALID simulate expired auth
```

## 8. Scenario: Merchant On-Demand Auth Lifecycle Invariants

### 1. Scope / Trigger

适用于修改商家认证检查、登录、doctor、命令回写和账号租约。认证后台、daemon 命令、定时 refresher 和自动启动已移除；不得重引入后台依赖。

LoginToken 消费路径（任务 10-11）已于 2026-10-27 放弃：实测未过期会话也恢复不了，服务端过期后无法续期。不保留独立 Token 来源，也不从保存材料重建工作 Cookie；后续由账密重登承接，见第 9 节。

### 2. Signatures

```text
pdd login --qr --json
pdd doctor --json
pdd orders list --json

data/pdd.db  auth_states (account_id, revision, state_sealed, bound_mall_id, usable, check/last_check columns)
```

关键函数：

```js
verifyMerchantContext(context, { expectedMallId, deadlineAt, signal });
collectCheckCookies(frozenContext); // -> frozen Cookies selected for the checkLogin URL
verifyStoredMerchant(context, savedState, task);
probeMerchantShop(frozenContext, checkCookies, { deadlineAt, signal });
withMerchantAuthUpdate(accountId, callback, { recoveryMallId, deadlineAt, signal });
// callback(tx): tx = { accountId, token, revision, state, metadata, corrupt, recoveryMallId, ...task }
// tx.recoveryMallId is always the account identity, so every commit re-checks the shop identity;
// passing options.recoveryMallId only adds an early mismatch check and enables allowCorrupt loading.
commitMerchantCandidate(candidate, tx, { expectedRevision = tx.revision }); // sync
recordMerchantCheck(result, tx);                                            // sync; rejected/indeterminate only
provisionMerchantLogin(login, { accountId, signal, deadlineAt }) -> { account, accountId, result };
provisionConsumerAuth(state, { uid, nickname }) -> { account, accountId };
```

### 3. Contracts

- Login, ordinary single/batch commands and doctor MUST NOT launch a background process or report background status. `daemon` is no longer a supported CLI group.
- Writers MUST acquire the account lease (`scope='account'`, `key=accountId`) before loading browser state or saving credentials. `withMerchantAuthUpdate` acquires it, checks the account is a merchant whose identity equals `recoveryMallId` (if given), loads the state once, runs `await callback(tx)` outside any SQLite transaction, and releases the lease in `finally`.
- Merchant auth MUST independently GET `/janus/api/checkLogin` with one browser-selected frozen Cookie header, TLS enabled, no redirects/CookieJar, 15s per request and 1 MiB response cap; only temporary transport failures MAY retry once after 500ms within the total deadline.
- checkLogin Cookies MUST come from the browser-selected frozen snapshot for the checkLogin URL and pass buildCheckHeader rules. Missing/empty exact-name PASS_ID is rejected/auth_missing with 0 requests.
- Before any shop request, identity and shop-read targets MUST select their own Cookies from the SAME frozen snapshot, pass buildCheckHeader rules and carry the same raw PASS_ID value as the checkLogin Cookies; a mismatch returns E_AUTH_CANDIDATE_INVALID / cross_target_pass_id_mismatch without sending any shop request. Each endpoint receives only its own selected materials.
- Login, authenticated commands and doctor verify on demand, at most once per invocation. Only explicit login/init may open authorization; normal operations prompt pdd login.
- Only HTTP 200 + JSON object + boolean success=true + boolean result.login is conclusive: true is verified, false is rejected. All other login responses are indeterminate, including success=false. Page navigation and legacy POST observers MUST NOT prove login or authorize persistence.
- Before persistence, the same frozen snapshot MUST prove stable merchant identity and read-only GET `/earth/api/mallInfo/queryMallAuditInfo` success=true + result.auditInfoVOList array. First bind is automatic; the existing account identity and `bound_mall_id` MUST match. Store reads do not prove orders/goods/promo permissions. Known rejected materials MUST NOT be repeatedly sent as valid business credentials.
- Observer response/navigation/abort listeners and timers MUST be cleaned on success、expiry、timeout、abort、navigation failure and disposal.
- All merchant writers MUST use branded verified frozen candidates through the shared account transaction; never re-read an active context after validating and save unchecked state. Commit runs in one short `BEGIN IMMEDIATE` transaction that checks task cancellation/deadline, `assertLeaseOwner` and `revision = tx.revision`; cookies/origins and merchant metadata columns commit together. On success `tx.revision`/`tx.state` advance, so one callback MAY commit more than once. Live owners MUST NOT lose leases merely because a task is old; the slug remains stable. Existing successful commands re-verify their final snapshot; cross-shop results MUST NOT overwrite the bound account.
- Revision conflicts/persistence failures MUST preserve successful business envelopes with stable warnings (`auth_state_persist_conflict` / `auth_state_persist_failed`); failed business operations and fixture commands MUST NOT persist credentials. needsAuth:false commands, including doctor, MUST NOT persist.
- needsAuth:false runner bootstrap MUST start without loading merchant credentials.
- `verifyStoredMerchant` returns `failed / identity_mismatch` without any request when `expectedMallId` differs from the stored `bound_mall_id`.
- Merchant registration (`provisionMerchantLogin`) runs the browser login first; when the verified mallId matches an existing account (with or without `--account`), it then takes that account's lease (without `--account`: wait budget at most 1.5s) and commits under it. Then one transaction: find the account by `identity = mallId`; with a known starting account, the found account and its revision MUST equal the starting snapshot, otherwise `E_AUTH_STATE_CONFLICT` (a concurrently removed account is never resurrected); otherwise insert a new account (default if it is the first merchant), save the state and update `last_login_at`. There is no registry-level lock: `account remove` / `account default` never wait for a login.
- Damaged state (decrypts, but cookies/origins missing) MAY be recovered only during reauthorization for the trusted account identity (`allowCorrupt` when `recoveryMallId` is set). Start with an empty browser context, keep the original revision and any `bound_mall_id`, and match both before committing. Ordinary command transactions remain strict; failed verification, cancellation or revision conflict MUST keep the old row. Undecryptable rows (`E_SECRET_DECRYPT_FAILED`) are never recovered in place; the user re-logs in after removing the account.
- `--json` command stdout MUST stay one parseable envelope line.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| removed daemon command | usage error; no background process |
| cannot acquire account lease | `E_LOCK_TIMEOUT`; do not mutate auth state |
| lease taken over before commit | `E_AUTH_LOCK_LOST`; transaction rolls back |
| already-aborted signal | cancel before browser work or credential commit |
| independent GET checkLogin returns HTTP 200 + success=true + result.login=true, identity/read pass | verified; commit only the verified frozen candidate |
| same login response with boolean result.login=false | rejected; preserve old Cookies and mark latest check rejected |
| login response missing/malformed/non-boolean/non-200 or transport fails | indeterminate; no candidate replacement, mark latest check uncertain rather than expired |
| page enters/leaves login or PASS_ID merely appears | acquisition signal only; independent verification still required |
| checkLogin target has no non-empty exact-name PASS_ID | rejected / auth_missing; 0 requests |
| checkLogin has non-empty PASS_ID but any target fails Cookie format/uniqueness/partition rules | E_AUTH_CANDIDATE_INVALID with fixed reason only; 0 requests |
| identity/shop-read target PASS_ID differs from checkLogin | E_AUTH_CANDIDATE_INVALID / cross_target_pass_id_mismatch; no shop request |
| account removed while its login is in flight | final commit `E_AUTH_STATE_CONFLICT`; account is not recreated |
| registered account state decrypts but lacks storage arrays | empty-context reauthorization; verified matching candidate may replace original revision |
| registered account state cannot be decrypted | `E_SECRET_DECRYPT_FAILED`; login cannot replace it in place |
| recovery authorizes another shop, is cancelled, or sees a newer revision | mismatch/cancel/conflict error; old or newer row remains unchanged |

### 5. Good/Base/Bad Cases

- Good: auth lifecycle tests use a temporary `PDD_DB_PATH` and simulated HTTPS/browser seams.
- Good: validate shop-target PASS_ID consistency before any shop request, and send each endpoint only its own selected materials.
- Base: CLI tests reject the removed daemon group and prove doctor omits background status.
- Bad: normal login or command execution silently starts a persistent background process.
- Bad: send shop requests with materials whose PASS_ID differs from checkLogin; describe a local Cookie write as server renewal.

### 6. Tests Required

- Assert one-line JSON stdout, removed daemon CLI and unchanged credentials on failed validation.
- Auth-check tests MUST mock HTTPS transport and assert exact fixed GET targets, explicit scoped Cookie/TLS, strict success/login booleans, identity/read-only verification, size/deadline/cancel/redirect handling and fail-closed candidate commits. See `test/adapter/auth-probe.test.js`, `auth-snapshot-context.test.js`, `merchant-auth-storage.test.js` and merchant auth e2e.
- auth-probe tests cover scoped selection, invalid/mismatched materials and secret-free errors. merchant-auth-storage tests assert zero shop transport on mismatched candidates and branded-only atomic commits.
- Lease/CAS changes: run `test/infra/leases.test.js`, merchant-auth-storage and merchant-account-storage tests, plus the two-process conflict case in `test/e2e/sqlite-auth-storage.e2e.test.js`.
- Keep login recovery coverage in `test/services/merchant-account-storage.test.js` and `test/adapter/merchant-auth-storage.test.js`: assert empty-context authorization before shape recovery, no resurrection of a concurrently removed account, preserved bindings/revisions on failure, strict ordinary reads, and multiple commits in one callback. Extend these existing contracts instead of adding a new regression file for each fix.

### 7. Wrong vs Correct

#### Wrong

```js
// A page redirect is not proof of authentication.
await page.goto(PDD_HOME);
saveAuthStateSnapshot(await context.storageState(), accountId);
```

#### Correct

```js
const result = await verifyMerchantContext(context, { expectedMallId, signal, deadlineAt });
assertMerchantVerified(result);
commitMerchantCandidate(result.candidate, tx);
```

#### Wrong: generic HTTP/business-code rules replace endpoint semantics

```js
const errorCode = String(body.errorCode ?? body.error_code ?? '');
if (response.ok && errorCode === '0') saveAuthStateSnapshot(await context.storageState(), accountId);
```

#### Correct: observe the natural endpoint and require its explicit result

```js
const result = await verifyMerchantContext(context, { expectedMallId, signal, deadlineAt });
assertMerchantVerified(result);
commitMerchantCandidate(result.candidate, tx);
return { success: true, reason: 'auth_valid' };
```

#### Wrong vs Correct: resurrecting a removed account

```js
// Wrong: login re-inserts an account that was removed while the browser was open.
const account = findAccountByIdentity('merchant', mallId) ?? insertAccount({ identity: mallId, displayName });
// Correct: with a known starting account, a missing or changed row is a conflict.
if (initial && (account?.id !== initial.accountId || getAuthStateRevision(account.id) !== initial.revision)) {
  throw authStateConflict();
}
```

## 9. Scenario: Implicit Password Relogin and Circuit Breaker

### 1. Scope / Trigger

Applies when changing password credential storage, the password login adapter, `services/password-relogin.js`, the relogin step inside `withCommand()`, lease waiting during relogin, or `relogin_states` / `pending_actions` writes. Origin: task `10-27-password-relogin-core`.

Real-account findings (2026-10-27): submitting the password form from a blank context triggered SMS verification, and the SMS was sent by the submit itself. A saved device state without `PASS_ID` stalled unclassified for 90s. Device trust appears to require one human SMS pass on the same device state (task ④ takeover view); until then, live relogin is expected to end in `awaiting_human`.

### 2. Signatures

```js
// adapter/password-credential.js — AAD aad('credentials', accountId); sealed plaintext { v: 1, login_name, password }
savePasswordCredential(accountId, { loginName, password }); // non-empty strings <= 128 chars, else E_USAGE without values
loadPasswordCredential(accountId) -> { loginName, password } | null; // decrypt failure: E_SECRET_DECRYPT_FAILED
hasPasswordCredential(accountId) -> boolean;                // row existence only, never decrypts
deletePasswordCredential(accountId);

// adapter/password-login.js — one submit click; classified results are returned, only cancel/timeout throws
attemptPasswordLogin(page, { loginName, password }, { signal, deadlineAt }) ->
  { outcome: 'success' }
  | { outcome: 'challenge', challenge: 'sms' | 'slider' | 'click' | 'risk_confirm' | 'unknown' }
  | { outcome: 'wrong_password' | 'account_locked' | 'form_changed' | 'network_error' };

// services/password-relogin.js
decideRelogin(accountId, { now, minIntervalMs, authResult })
  -> { action: 'attempt', credential, credentialUpdatedAt } | { action: 'fail', error }; // sync, read-only
recordReloginAttempt(tx);                                  // sync; last_attempt_at before browser work
recordReloginOutcome(tx, outcome, { credentialUpdatedAt }) -> PddCliError | null; // sync
reloginInCommand(runtime, tx, browser, authResult) -> { context, page }; // live; lease already held
reloginForFixture(accountId, runtime);                     // fixture; takes its own lease
markManualLoginSucceeded(accountId);                       // saveMerchantLogin, existing account only
// reserved for task ④ (implemented and tested in ③)
setAccountPassword(accountId, { loginName, password });
clearAccountPassword(accountId);
clearReloginBlock(accountId);
recordTakeoverTimeout(accountId);
getReloginSummary(accountId) -> { has_password, status, reason, last_attempt_at };
getAccountActionWarnings(accountId, slug) -> [{ code: 'account_action_required', account, reason }];
```

### 3. Contracts

- ③ has no CLI entry that accepts a password. Credentials reach the DB only through `setAccountPassword` (④ console) or test helpers.
- Relogin runs only for `needsAuth` commands, only after `assertAuthValid` returns `rejected` (including `known_rejected`). `indeterminate` never triggers relogin. doctor, `account list` and other `needsAuth:false` commands never relogin and never append action warnings.
- Decision order is fixed:
  1. no credential → the original `E_AUTH_EXPIRED` (prompt `pdd login`);
  2. `blocked` → `E_AUTH_RELOGIN_BLOCKED`;
  3. `awaiting_human` → `E_AUTH_HUMAN_REQUIRED`;
  4. within `passwordReloginMinIntervalMs` of `last_attempt_at` → error rebuilt from the last reason (`success` → `E_AUTH_EXPIRED`, `form_changed` → `E_PASSWORD_LOGIN_FORM_CHANGED`, other → `E_AUTH_RELOGIN_FAILED`) with detail `{ relogin: 'throttled', next_attempt_at }`;
  5. otherwise attempt. The credential is decrypted only here.
- State machine (`relogin_states`; a missing row means `available`):

| Event | status | reason | Side effects |
| --- | --- | --- | --- |
| attempt starts | unchanged | unchanged | `last_attempt_at = now` before browser work, so a crash still counts |
| success | available | `success` | takeover-timeout counter reset |
| challenge | awaiting_human | challenge type | open `human_takeover` action |
| wrong_password / account_locked | blocked | same | open `relogin_blocked` action |
| form_changed / network_error / verify_failed | available | same | no breaker |
| manual login (N9a) | awaiting_human → available | `manual_login` | resolves `human_takeover`; `blocked` stays |
| `setAccountPassword` | available | `password_reset` | `last_attempt_at = null`, counter reset, resolves all open actions |
| `clearAccountPassword` | available | `password_cleared` | deletes credential, resolves all open actions |
| `clearReloginBlock` | blocked → available | `manual_unblock` | `last_attempt_at = null`, counter reset, resolves `relogin_blocked` |
| `recordTakeoverTimeout` | counter +1; at 2 → blocked | `takeover_timeout` | opens `relogin_blocked`; an existing block is kept as is |

- At most one open pending action per `(account, kind)`; a duplicate insert keeps the existing row.
- State and action writes run in one short synchronous transaction after `assertLeaseOwner('account', accountId, tx.token)`.
- Stale-outcome guard: when `credentials.updated_at` differs from `credentialUpdatedAt` captured at decision time, blocking outcomes (`awaiting_human` / `blocked`) are skipped and only the error is returned, so a password reset during an attempt wins.
- The live relogin context is device-continuous: `tx.state` cookies/origins with every `PASS_ID` cookie removed. Only a corrupt or shape-invalid state falls back to an empty context.
- On `success` the login page closes and `verifyMerchantContext(newContext, { expectedMallId: tx.recoveryMallId })` must return `verified`; then `commitMerchantCandidate` → outcome `success` → `renewLease`. Non-verified → `verify_failed` / `E_AUTH_RELOGIN_FAILED`; identity mismatch surfaces as `E_ACCOUNT_IDENTITY_MISMATCH`. The runner swaps to the returned `{ context, page }` and closes the old context; failure paths close the new context.
- Budget: relogin has its own `TIMEOUTS.LOGIN_PASSWORD` (90s) budget. The command deadline is paused with `armDeadline().pause()` and resumed in `finally`; SIGINT still aborts through the combined signal.
- Lease wait: a waiter extends past its normal 15s wait only while the holder's `last_attempt_at` is within `LOGIN_PASSWORD`, up to `last_attempt_at + LOGIN_PASSWORD + 15s`, still bounded by its own `deadlineAt` and signal. After acquiring, it reads the new revision, verifies it and does not log in again.
- Adapter: challenge detection reads visible DOM only — no click, drag or "send code" after the single submit click. A state still unclassified at the deadline is `challenge: 'unknown'` (go to a human, never retry blindly). Raw Playwright errors map to fixed reasons; `err.message` never reaches logs or envelopes.
- Action warnings: for needsAuth commands, on both success and error paths (live and fixture), every open action of the account actually used becomes `{ code: 'account_action_required', account: slug, reason }`, including actions written by the same run. Batch mode aggregates per-account warnings and relogs accounts one by one.
- Error detail passes through the `reloginDetail()` whitelist: `account`, `reason`, `challenge`, `relogin`, `next_attempt_at`. Login name, password, URL and page text never appear.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| rejected, no credential | `E_AUTH_EXPIRED`; no attempt, no state write |
| rejected, status `blocked` | `E_AUTH_RELOGIN_BLOCKED` (exit 3); no attempt |
| rejected, status `awaiting_human` | `E_AUTH_HUMAN_REQUIRED` (exit 3); no attempt |
| rejected, inside throttle window | rebuilt error + `relogin: 'throttled'`, `next_attempt_at`; no attempt |
| attempt → challenge | `E_AUTH_HUMAN_REQUIRED` `{ account, challenge }`; open `human_takeover`; warning in the same envelope |
| attempt → wrong_password / account_locked | `E_AUTH_RELOGIN_BLOCKED`; open `relogin_blocked`; later commands make no attempt |
| attempt → form_changed | `E_PASSWORD_LOGIN_FORM_CHANGED`; status stays available |
| attempt → network_error / verify_failed | `E_AUTH_RELOGIN_FAILED`; status stays available |
| attempt → success, verified | candidate committed, lease renewed, command continues on the new context, exit 0 |
| verified shop differs from the account | `E_ACCOUNT_IDENTITY_MISMATCH`; nothing committed |
| relogin exceeds 90s or SIGINT | cancel error; new context closed; command deadline resumed |
| auth check `indeterminate` | original indeterminate error; no relogin |
| two processes, both rejected | one attempt (trace has one line); the waiter reuses the new revision; both exit 0 |

### 5. Good/Base/Bad Cases

- Good: start relogin from `tx.state` minus `PASS_ID`, so device cookies survive and the committed state keeps the trust.
- Good: write `last_attempt_at` before launching the browser.
- Base: no stored credential → behavior identical to before ③.
- Bad: retry after a challenge, click "send code", or drag a slider.
- Bad: widen every lease wait to 120s; other commands must still fail fast behind a long-running lease holder.
- Bad: copy a Playwright `err.message` into detail or logs (it may echo filled values).

### 6. Tests Required

- `test/adapter/password-credential.test.js`: round trip, AAD bound to the account, tamper, input validation, no values in errors.
- `test/services/password-relogin.test.js`: decision order, every state-machine row, throttle reconstruction, single open action, foreign lease rejected, stale-outcome guard.
- `test/adapter/password-login.test.js`: every outcome via a fake page; no click/press after the submit click on challenge branches.
- `test/infra/leases.test.js`: `extendUntil` extension and termination. `test/commands/runner-deadline.test.js`: pause/resume.
- `test/e2e/password-relogin.e2e.test.js` (fixture, temp `PDD_DB_PATH`): success with one-line stdout; four challenges; breaker with no further trace lines; three unlock paths; throttle; two-process single attempt; `PDD_DEBUG_RAW=1` leaves no password in stdout/stderr/log/DB bytes; doctor and account list never relogin; `--all-accounts` relogs sequentially.

### 7. Wrong vs Correct

#### Wrong

```js
// A blank context always triggers SMS on this account and discards device trust.
const context = await browser.newContext();
await attemptPasswordLogin(await context.newPage(), credential, task);
```

#### Correct

```js
const device = { cookies: tx.state.cookies.filter((cookie) => cookie.name !== 'PASS_ID'), origins: tx.state.origins };
const context = await createSnapshotContext(browser, structuredClone(device));
const result = await attemptPasswordLogin(await context.newPage(), credential, task);
```

#### Wrong

```js
// Overwrites state after the user reset the password mid-attempt.
putReloginState(accountId, { status: 'blocked', reason: 'wrong_password' });
```

#### Correct

```js
// recordReloginOutcome skips blocking writes when credentials.updated_at changed since decideRelogin.
const error = recordReloginOutcome(tx, result, { credentialUpdatedAt: decision.credentialUpdatedAt });
```
