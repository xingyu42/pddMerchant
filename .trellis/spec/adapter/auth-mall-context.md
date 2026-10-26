# Auth and Mall Context Contracts

## 1. Scope / Trigger

适用于修改 `src/adapter/auth-state.js`、`src/adapter/consumer-qr-login.js`、`src/adapter/mall-reader.js`、`src/adapter/mall-writer.js`、`src/adapter/mall-switcher.js`、`src/adapter/mall-id.js`、`src/services/auth.js`、`src/commands/login.js`、account registry 与商家即时认证检查。

## 2. Signatures

Auth/mall 相关路径：

```text
data/merchant/stores/<store-slug>/auth-state.json       merchant auth state; never commit
data/consumer/accounts/<account-slug>/auth-state.json   consumer auth state; never commit
src/infra/account-*                     multi-account registry/storage helpers
src/adapter/consumer-qr-login.js        owns CONSUMER_LOGIN_URL
src/adapter/mall-reader.js              resolves mall context
src/adapter/mall-switcher.js            switches requested mall
src/commands/login.js / init            login and QR login commands
```

重要 env：

```text
PDD_AUTH_STATE_PATH=<path>
PDD_CONSUMER_AUTH_STATE_PATH=<path>
PDD_ACCOUNTS_DIR=<path>
PDD_ACCOUNT_REGISTRY_PATH=<path>
PDD_CONSUMER_ACCOUNTS_DIR=<path>
PDD_CONSUMER_ACCOUNT_REGISTRY_PATH=<path>
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

- Auth state, account registry and logs under `data/` MUST NOT be committed or exposed。
- Merchant login identity MUST come from HTTP 200 + boolean success=true + fixed `result.merchantMainSimpleVO.mallId/mallName` on GET `/earth/api/mallInfo/querySimpleCredential`. URL/cookie/storage/DOM/arbitrary XHR field search MUST NOT prove auth ownership. Consumer identity remains validated `user/me` `{ uid, nickname }`.
- `--consumer-account` selects a registered consumer account independently from merchant `--account`.
- Goods-publish source browsing and degradation cleanup MUST use the same resolved consumer auth path.
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
| account registry path points to missing account | usage/auth error; do not create implicit credentials |
| concurrent login/command persistence             | advisory lock prevents concurrent auth mutation      |

## 5. Good/Base/Bad Cases

- Good：runner resolves auth/account/mall once and passes context through `ctx`。
- Good：QR、headed 和 fixture 登录从同一个 `CONSUMER_LOGIN_URL` 常量取值。
- Base：站点入口真实变更时，在 adapter 中修改常量并同步登录选择器/流程测试。
- Base：doctor command can probe mall context without invoking unrelated write endpoints。
- Bad：把很少变化的消费端登录页放进 `config.example.json` 或允许 env 覆盖，导致配置面扩大且只改 URL 无法解决 UI 改版。
- Bad：service reads `data/auth-state.json` directly and bypasses runner/account isolation。

## 6. Tests Required

- Auth invalid env simulation tests for merchant and consumer auth。
- Consumer login constant tests MUST assert the exact code-owned URL and that `CONFIG_FIELD_DEFINITIONS` excludes `consumerLoginUrl`。
- Mall id strict/relaxed parser tests。
- Mall context tests covering probe order and fallback behavior。
- Auth lock tests when changing verification/persistence or lock behavior。

## 7. Wrong vs Correct

### Wrong

```js
// ❌ 将站点入口扩大为用户配置
consumerLoginUrl: { env: 'PDD_CONSUMER_LOGIN_URL', required: true };

const auth = JSON.parse(await fs.readFile('data/auth-state.json', 'utf8'));
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

适用于修改商家认证检查、登录、doctor、命令回写和 auth-state lock。认证后台、daemon 命令、定时 refresher 和自动启动已移除；不得重引入后台依赖。

LoginToken 消费路径（任务 10-11）已于 2026-10-27 放弃：实测未过期会话也恢复不了，服务端过期后无法续期。不保留独立 Token 来源，也不从保存材料重建工作 Cookie；后续由账密重登（任务 10-27-password-relogin-console）承接。

### 2. Signatures

```text
pdd login --qr --json
pdd doctor --json
pdd orders list --json

data/merchant/stores/<store-slug>/auth-state.json
```

关键函数：

```js
verifyMerchantContext(context, { expectedMallId, deadlineAt, signal });
collectCheckCookies(frozenContext); // -> frozen Cookies selected for the checkLogin URL
verifyStoredMerchant(context, savedState, task);
probeMerchantShop(frozenContext, checkCookies, { deadlineAt, signal });
withMerchantAuthUpdate(path, callback, { recoveryMallId, deadlineAt, signal });
commitMerchantCandidate(candidate, transaction);
acquireLock(authStatePath, { timeoutMs, staleMs, retryMs });
releaseLock(authStatePath, token);
```

### 3. Contracts

- Login, ordinary single/batch commands and doctor MUST NOT launch a background process or report background status. `daemon` is no longer a supported CLI group.
- Writers MUST acquire the account/path lock before loading browser state or saving credentials.
- Merchant auth MUST independently GET `/janus/api/checkLogin` with one browser-selected frozen Cookie header, TLS enabled, no redirects/CookieJar, 15s per request and 1 MiB response cap; only temporary transport failures MAY retry once after 500ms within the total deadline.
- checkLogin Cookies MUST come from the browser-selected frozen snapshot for the checkLogin URL and pass buildCheckHeader rules. Missing/empty exact-name PASS_ID is rejected/auth_missing with 0 requests.
- Before any shop request, identity and shop-read targets MUST select their own Cookies from the SAME frozen snapshot, pass buildCheckHeader rules and carry the same raw PASS_ID value as the checkLogin Cookies; a mismatch returns E_AUTH_CANDIDATE_INVALID / cross_target_pass_id_mismatch without sending any shop request. Each endpoint receives only its own selected materials.
- Login, authenticated commands and doctor verify on demand, at most once per invocation. Only explicit login/init may open authorization; normal operations prompt pdd login.
- Only HTTP 200 + JSON object + boolean success=true + boolean result.login is conclusive: true is verified, false is rejected. All other login responses are indeterminate, including success=false. Page navigation and legacy POST observers MUST NOT prove login or authorize persistence.
- Before persistence, the same frozen snapshot MUST prove stable merchant identity and read-only GET `/earth/api/mallInfo/queryMallAuditInfo` success=true + result.auditInfoVOList array. First bind is automatic; existing registry/file bindings MUST match. Store reads do not prove orders/goods/promo permissions. Known rejected materials MUST NOT be repeatedly sent as valid business credentials.
- Observer response/navigation/abort listeners and timers MUST be cleaned on success、expiry、timeout、abort、navigation failure and disposal.
- All merchant writers MUST use branded verified frozen candidates through the shared account/path transaction; never re-read an active context after validating and save unchecked state. Commit MUST check task cancellation/deadline, lock ownership and original revision; cookies/origins/merchant_auth metadata commit together. Live owners MUST NOT lose locks merely because a task is old; registry slug remains stable. Existing successful commands re-verify their final snapshot; cross-shop results MUST NOT overwrite the bound account.
- Revision conflicts/persistence failures MUST preserve successful business envelopes with stable warnings; failed business operations and fixture commands MUST NOT persist credentials. needsAuth:false commands, including doctor, MUST NOT persist.
- needsAuth:false runner bootstrap MUST start without loading merchant credentials.
- Merchant registration MUST share the registry lock with remove/default/rekey/upsert. Internal upsert MAY reuse only an owner-validated transaction token; other mutations wait within their limit and fail explicitly on timeout, never reclaim a live login lock or resurrect a concurrently removed account.
- Explicit auth-state paths MUST bypass merchant registration and its registry reads/locks; a damaged unrelated registry MUST NOT prevent an isolated login.
- Damaged JSON or missing cookies/origins MAY be recovered only during reauthorization or registration for a trusted registered `recoveryMallId`. Start with an empty browser context, retain the original raw revision and any parseable file binding, and match both the registered shop and existing binding before committing. Ordinary command transactions and custom files without a trusted identity remain strict; failed verification, cancellation or revision conflict MUST preserve the old file.
- Comparing a saved source and existing account target MUST use `realpath()` for both paths. Windows short paths and full paths may name the same file; treating them as different targets can falsely reject the revision produced by the login itself.
- `--json` command stdout MUST stay one parseable envelope line.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| removed daemon command | usage error; no background process |
| cannot acquire auth-state lock | explicit timeout/conflict; do not mutate auth-state |
| already-aborted signal | cancel before browser work or credential commit |
| independent GET checkLogin returns HTTP 200 + success=true + result.login=true, identity/read pass | verified; commit only the verified frozen candidate |
| same login response with boolean result.login=false | rejected; preserve old Cookies and mark latest check rejected |
| login response missing/malformed/non-boolean/non-200 or transport fails | indeterminate; no candidate replacement, mark latest check uncertain rather than expired |
| page enters/leaves login or PASS_ID merely appears | acquisition signal only; independent verification still required |
| checkLogin target has no non-empty exact-name PASS_ID | rejected / auth_missing; 0 requests |
| checkLogin has non-empty PASS_ID but any target fails Cookie format/uniqueness/partition rules | E_AUTH_CANDIDATE_INVALID with fixed reason only; 0 requests |
| identity/shop-read target PASS_ID differs from checkLogin | E_AUTH_CANDIDATE_INVALID / cross_target_pass_id_mismatch; no shop request |
| explicit auth-state path with corrupt unrelated registry | authorize and save independently; do not read or change the registry |
| registered account has corrupt JSON or missing storage arrays | empty-context reauthorization; verified matching candidate may replace original revision |
| recovery authorizes another shop, is cancelled, or sees a newer revision | mismatch/cancel/conflict error; old or newer file remains unchanged |

### 5. Good/Base/Bad Cases

- Good: auth lifecycle tests use temporary auth-state files and simulated HTTPS/browser seams.
- Good: validate shop-target PASS_ID consistency before any shop request, and send each endpoint only its own selected materials.
- Base: CLI tests reject the removed daemon group and prove doctor omits background status.
- Bad: normal login or command execution silently starts a persistent background process.
- Bad: send shop requests with materials whose PASS_ID differs from checkLogin; describe a local Cookie write as server renewal.

### 6. Tests Required

- Assert one-line JSON stdout, removed daemon CLI and unchanged credentials on failed validation.
- Auth-check tests MUST mock HTTPS transport and assert exact fixed GET targets, explicit scoped Cookie/TLS, strict success/login booleans, identity/read-only verification, size/deadline/cancel/redirect handling and fail-closed candidate commits. See `test/adapter/auth-probe.test.js`, `auth-snapshot-context.test.js`, `merchant-auth-storage.test.js` and merchant auth e2e.
- auth-probe tests cover scoped selection, invalid/mismatched materials and secret-free errors. merchant-auth-storage tests assert zero shop transport on mismatched candidates and branded-only atomic commits.
- Auth lock changes: run merchant-auth-storage and merchant-account-storage tests using temporary directories.
- Keep login recovery coverage in `test/services/merchant-account-storage.test.js` and `test/adapter/merchant-auth-storage.test.js`: assert explicit-path isolation, empty-context authorization before JSON/shape recovery, separate-login registration, preserved bindings/revisions on failure, strict ordinary reads, and actual deletion of unpublished files. Extend these existing contracts instead of adding a new regression file for each fix.

### 7. Wrong vs Correct

#### Wrong

```js
// A page redirect is not proof of authentication.
await page.goto(PDD_HOME);
await saveAuthState(context, path);
```

#### Correct

```js
const result = await verifyMerchantContext(context, { expectedMallId, signal, deadlineAt });
assertMerchantVerified(result);
await commitMerchantCandidate(result.candidate, transaction);
```

#### Wrong: generic HTTP/business-code rules replace endpoint semantics

```js
const errorCode = String(body.errorCode ?? body.error_code ?? '');
if (response.ok && errorCode === '0') await saveAuthState(context, path);
```

#### Correct: observe the natural endpoint and require its explicit result

```js
const result = await verifyMerchantContext(context, { expectedMallId, signal, deadlineAt });
assertMerchantVerified(result);
await commitMerchantCandidate(result.candidate, transaction);
return { success: true, reason: 'auth_valid' };
```

#### Wrong vs Correct: existing target path identity

```js
// Wrong: short and full Windows paths can differ while naming the same file.
const sameTarget = resolve(sourcePath) === resolve(targetPath);
// Correct for an existing target: compare both physical paths.
const sameTarget = await realpath(sourcePath) === await realpath(targetPath);
```
