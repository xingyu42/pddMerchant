# Environment and Path Contract

## 1. Scope / Trigger

适用于新增或修改环境变量、默认路径、auth/log/fixture/data 存储、rate-limit/cooldown 配置与 Playwright 下载配置。

## 2. Signatures

常用 env：

```text
PDD_TEST_ADAPTER=fixture
PDD_TEST_FIXTURE_DIR=<path>
PDD_DB_PATH=<path>
PDD_DEBUG_RAW=1
PDD_MALL_ID_STRICT_PARSE=0
PDD_RATE_LIMIT_QPS=<n>
PDD_RATE_LIMIT_BURST=<n>
PDD_COOLDOWN_THRESHOLD=<n>
PDD_COOLDOWN_MS=<ms>
PDD_SCRAPE_SIMULATE=0
PDD_SCRAPE_SOFTBLOCK_THRESHOLD=<n>
PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS=<ms>
PDD_FULL_COUNT_DISCOUNT_RATE=<0.50-0.99|50-99>
PDD_SOURCE_PROXY_PROVIDER=qingguo
PDD_QINGGUO_AUTH_KEY=<extraction-auth-key>
PDD_QINGGUO_AREA=<six-digit-area-codes>
PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS=<ms>   # passwordReloginMinIntervalMs，正整数，默认 1800000
PDD_CONSOLE_HOST=<host>                     # consoleHost，默认 127.0.0.1；空或纯空白为配置错误
PDD_CONSOLE_PORT=<1-65535>                  # consolePort，默认 47821
PDD_CONSOLE_PUBLIC_URL=<http(s) URL|''>     # consolePublicUrl，反代后的外部地址；空表示按监听地址生成
PDD_PATROL_ENABLED=true|false               # patrolEnabled，默认 false
PDD_PATROL_INTERVAL_MS=<ms>                 # patrolIntervalMs，默认 1800000，最小 300000
PDD_TEST_DAEMON_LEASE_TTL_MS / PDD_TEST_DAEMON_HEARTBEAT_MS / PDD_TEST_PATROL_INTERVAL_MS  # fixture only，缩短 daemon 计时
PDD_TEST_PASSWORD_LOGIN=<outcome>           # fixture only，见 adapter/fixture-mode.md
PDD_TEST_PASSWORD_LOGIN_DELAY_MS=<ms>       # fixture only
PDD_TEST_PASSWORD_LOGIN_TRACE=<file>        # fixture only
PLAYWRIGHT_DOWNLOAD_HOST=<url>
```

公开运行配置的唯一默认基线是 `config/config.example.json`。有效配置按以下顺序装配：

```text
config/config.example.json (required)
→ config/config.json (optional sparse local override)
→ mapped environment variables
→ explicit CLI overrides
```

普通 CLI MUST 使用 `src/infra/config.js` 的严格 loader。纳入 Schema 的公开环境变量只允许在该模块集中映射；service/adapter MUST 通过冻结的 `runtimeConfig` 或显式参数消费，禁止再次直接读取对应 `process.env` 或复制默认值。商家认证后台已移除；旧本地 refreshIntervalMs/refreshJitterMs/authStatePath 仅兼容忽略，不映射对应环境变量、不暴露为公开字段（`config set` 这些字段返回未知字段），其他未知键仍拒绝。

`PDD_DB_PATH` 不属于公开运行配置 Schema：它在 `src/infra/paths.js` 解析为 `DB_PATH`（`resolve()` 后的绝对路径），主密钥固定为 `dirname(DB_PATH)/master.key`。0.5.0 已删除 `PDD_AUTH_STATE_PATH`、`PDD_CONSUMER_AUTH_STATE_PATH`、`PDD_ACCOUNTS_DIR`、`PDD_CONSUMER_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH`、`PDD_CONSUMER_ACCOUNT_REGISTRY_PATH`、`PDD_ALLOW_INSECURE_AUTH_STATE`、`PDD_MASTER_PASSWORD`，不得重新加入读取点。

`passwordReloginMinIntervalMs`（env `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS`）是同一账号两次自动重登尝试之间的最短间隔，默认值只由 `config/config.example.json` 持有（1800000，即 30 分钟），经 `runtimeConfig` 传给 `decideRelogin`；非正整数在严格 loader 中报配置错误。`decideRelogin` 收到缺失或非法值时按 30 分钟处理，避免测试或直接调用绕过限频。重登自身预算为 `TIMEOUTS.LOGIN_PASSWORD = 90_000`（`src/infra/timeouts.js`），不可配置。

`consumerLoginUrl` 的默认值 MUST 只由 `config/config.example.json` 持有，`PDD_CONSUMER_LOGIN_URL` 只作为更高优先级覆盖。登录 command/service MUST 沿调用链显式传入 URL，消费者登录 adapter 不得保留模块级默认地址。

Default sensitive paths：

```text
data/pdd.db                 # accounts + encrypted auth state (PDD_DB_PATH)
data/master.key             # beside the DB; POSIX 0600; back up together with the DB
data/scrape-cooldown.json
```

Default log paths（gitignored `log/`；路径固定、不可配置）：

```text
log/cli/YYYY-MM-DD.log      # CLI runtime
log/daemon/YYYY-MM-DD.log   # pdd daemon（前台 run 另写 stderr）
```

Default temporary paths：

```text
tmp/goods-publish-source-cache/<numeric-goods-id>.json
```

## 3. Contracts

- Defaults MUST work from repo root without build step。
- Baseline missing/damaged/invalid and existing local config damaged/invalid MUST fail with `E_CONFIG_INVALID`; local config absence is allowed。
- `config/config.json` MUST remain project-local and gitignored. Maintenance writes MUST reject path/symlink/junction escape and use same-directory atomic replacement。
- Env parsing MUST validate type/range and fail with usage/config error rather than silent coercion when unsafe。
- The database, master key and log files under `log/` MUST NOT be committed or printed。Storage contracts: [sqlite-storage.md](./sqlite-storage.md)。
- Merchant login MUST derive a readable store slug from the real mall name and use `mallId` as stable identity.
- Consumer login MUST derive a readable account slug from `/proxy/api/api/apollo/v3/user/me.nickname` and use `uid` as stable identity.
- Envelope、error 和 log MUST NOT print the database or master-key path (including when the DB directory is inaccessible).
- `doctor` reports pre-0.5 data next to the DB (`merchant/stores/registry.json`, `consumer/accounts/registry.json`, or `<one level>/auth-state.json` under `merchant/stores/` / `consumer/accounts/`) as `meta.warnings` `{ code: 'legacy_storage_detected' }` plus headline `检测到旧版数据，已不再使用，可手动删除`; it never reads, migrates or deletes those files and never prints their paths.
- `PDD_TEST_ADAPTER=fixture` MUST route tests away from real browser/network calls; it does not isolate storage, so every fixture run also needs a temporary `PDD_DB_PATH`。
- Time/cooldown envs MUST be testable without real multi-minute sleeps.
- The source proxy extraction AuthKey MUST remain environment-only. When a cache miss requires a live Qingguo source fetch, `PDD_QINGGUO_AUTH_KEY` is required before cost-template, proxy, or PDD live requests; a valid temporary source cache bypasses this source-only configuration. Fixture mode ignores the live-only configuration. Proxy node username/password authentication is not configured in the first version.
- `PDD_QINGGUO_AREA` is optional. When set, it MUST contain one or more six-digit area codes separated by commas; surrounding whitespace is normalized before the value is sent as Qingguo's `area` query parameter. When unset, Qingguo selects a random area.
- Goods-publish source cache files MUST stay under ignored `tmp/goods-publish-source-cache/`; they are retained only across failed publish attempts and removed after verified draft save or confirmed submit success.
- `PDD_FULL_COUNT_DISCOUNT_RATE` maps only through `src/infra/config.js` to required runtime field `fullCountDiscountRate`. It accepts `0.50-0.99` or percentage form `50-99` in increments of `0.01`; invalid values MUST fail configuration validation before browser/page writes.

## 4. Validation & Error Matrix

| 条件                                            | 行为                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| path env points to missing optional fixture dir | deterministic fixture/config error                               |
| no merchant account and the command needs auth | `E_AUTH_EXPIRED` with `pdd login` hint                           |
| retired storage env var is set                  | ignored (no reader exists)                                       |
| numeric env invalid or negative                 | usage/config error, no platform request                          |
| `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS` not a positive integer | config error; nothing runs                           |
| `PDD_CONSOLE_HOST` empty or whitespace (env or config) | config error（防止监听全部网卡）                          |
| `consolePublicUrl` not '' and not absolute http(s) | config error                                                 |
| `patrolIntervalMs` < 300000                     | config error                                                     |
| `PDD_TEST_DAEMON_*` / `PDD_TEST_PATROL_INTERVAL_MS` outside fixture mode | ignored                                   |
| full-count discount outside range or not representable as an integer percent | `E_CONFIG_INVALID`, no platform request |
| Qingguo provider enabled with missing credential on cache miss | `E_USAGE` before cost-template, proxy, or PDD live requests |
| unsupported source proxy provider on cache miss | `E_USAGE`, no direct fallback                                    |
| Qingguo area contains an invalid code            | `E_USAGE` before proxy extraction                                |
| (n/a) log path configuration                    | removed; fixed `log/cli/`                                       |
| Playwright browser missing                      | `E_CHROMIUM_MISSING` style diagnostic; user runs install command |

## 5. Good/Base/Bad Cases

- Good：new env is documented here, parsed in one infra owner, and tested for default/override/invalid values。
- Base：`PLAYWRIGHT_DOWNLOAD_HOST` only affects browser installation/download behavior, not command envelope。
- Bad：service reads `process.env.MY_FLAG` directly in multiple files; centralize parsing in infra/config owner.

## 6. Tests Required

- Unit tests for env parser defaults, overrides and invalid values。
- Full-count discount config tests cover decimal/percentage forms, boundaries, precision, and strict invalid-value rejection.
- Fixture e2e proving test env bypasses real browser/auth。
- Path tests using a temporary `PDD_DB_PATH` (DB and key isolated together), not real `data/` secrets。
- doctor legacy-data tests (`test/e2e/doctor-legacy-storage.e2e.test.js`): detected, absent, and no path/content in JSON or human output。
- Cooldown/rate-limit tests with fake timers or injectable clock.
- Source proxy env tests for disabled/default, complete, incomplete, unsupported-provider, optional area normalization/validation, and fixture-bypass behavior; assertions must not print credential values.

## 7. Wrong vs Correct

### Wrong

```js
const threshold = Number(process.env.PDD_SCRAPE_SOFTBLOCK_THRESHOLD || 2);
```

### Correct

```js
const { scrapeSoftBlockThreshold } = ctx.runtimeConfig;
```

## 8. Scenario: Project-Local Config Maintenance Commands

### 8.1 Scope / Trigger

Use this contract when changing `pdd config show/set/unset/validate`, `src/infra/config-management.js`, public runtime-config fields, or the project-local sparse override file.

### 8.2 Signatures

```js
inspectConfig({ env, cliFlags, baselinePath, configPath }) -> {
  valid, runtimeConfig, localOverrides, sources, layers, issues,
}

parseWritableConfigField(key, rawValue) -> typedValue
setLocalConfigValue(key, rawValue, options) -> editResult
unsetLocalConfigValue(key, options) -> editResult
writeLocalConfigAtomic(value, options) -> projectRelativePath
```

```text
pdd config show
pdd config set <key> <value>
pdd config unset <key>
pdd config validate
```

### 8.3 Contracts

- Config commands MUST use `runtimeConfigPolicy: 'maintenance'`; damaged baseline/local/env configuration must not prevent `validate` or a safe local repair from starting.
- `CONFIG_FIELD_DEFINITIONS` is the only public-field/type/env mapping. `show`, `set`, `unset`, the runtime loader, and source reporting MUST derive from it rather than maintain parallel allowlists.
- `show` requires a valid merged runtime and returns only public fields with `effectiveValue`, `source`, `localOverride`, and `overridden` evidence. Environment-only secrets and safety/test switches never enter the public schema.
- `set` accepts only known public fields and parses the CLI string through the field's Zod schema. `unset` may additionally remove an unknown key that already exists in the local object so a strict-schema failure can be repaired.
- A syntactically valid local candidate is written even when an unrelated baseline/env/merged layer remains invalid. The edit stays successful, returns `runtimeValid: false`, safe issues, and warning `runtime_invalid_after_edit`.
- `config/config.json` is optional and sparse. Missing-file `unset` is a no-op and MUST NOT create an empty file. Damaged JSON, unreadable content, or an array/null/scalar root MUST remain byte-for-byte unchanged.
- The target is fixed under the repository `config/` directory. Existing directory/file symlinks or junctions, realpath escape, and caller-injected outside paths MUST fail before any outside write.
- Writes use an exclusive same-directory temporary file, `write -> sync -> close -> rename`, with best-effort temporary cleanup. No system-temp cross-volume replacement is allowed.
- Config edits are loaded by the next CLI process. `restartRequired` stays false, and no background restart warning or process launch is allowed.
- Errors use `E_CONFIG_INVALID` / exit 1 and expose only layer, project-relative path, field, reason, code, and safe message. Raw rejected values and absolute user paths are forbidden.

### 8.4 Validation & Error Matrix

| Condition | Result |
| --- | --- |
| valid public `set` value | typed sparse local write; `ok: true` |
| unknown/invalid `set` value | `E_CONFIG_INVALID`; original file unchanged |
| known absent `unset` key | `ok: true`, `removed: false`; no file creation |
| unknown key exists locally | `unset` may remove it and revalidate the whole candidate |
| local JSON syntax damaged or root is not an object | `E_CONFIG_INVALID`; original bytes unchanged |
| baseline/env remains invalid after a legal local edit | keep edit; `runtimeValid: false`, warning `runtime_invalid_after_edit` |
| config directory/file link escapes or is a link | `E_CONFIG_INVALID`; outside target unchanged |
| temporary write/sync/rename fails | `E_CONFIG_INVALID`; original file intact; temp cleanup attempted |

### 8.5 Good / Base / Bad Cases

- Good: `set rateLimitQps 4` writes `{ "rateLimitQps": 4 }`, reports an environment override if present, and a fresh process reads the same layered result.
- Base: `unset titleRewrite` with no local file returns a stable no-op and leaves the filesystem unchanged.
- Bad: load the full runtime before `config validate`, stringify every value, overwrite damaged JSON, accept a caller path outside `config/`, or write secrets into `config.json`.

### 8.6 Tests Required

- Config unit: baseline/local/env/CLI precedence, strict invalid layers, safe issue projection, and frozen runtime result.
- Management unit: number/boolean/enum/URL parsing, secret/unknown rejection, local repair, invalid-root preservation, atomic rename failure, directory junction, file symlink, and outside-path rejection.
- Command unit: single envelope, source/override reporting, invalid-layer diagnostics without raw values, and `runtime_invalid_after_edit`.
- Subprocess E2E: help/version bypass runtime loading, maintenance commands remain reachable under invalid env, stdout is one envelope, and a fresh process observes a typed local edit.
- Full `npm test` is required because `bin/pdd.js`, runtime configuration, help baselines, and shared command behavior are affected.

### 8.7 Wrong vs Correct

#### Wrong

```js
const local = JSON.parse(await readFile(userPath, 'utf8'));
local[key] = rawValue;
await writeFile(userPath, JSON.stringify(local));
```

#### Correct

```js
const parsedValue = parseWritableConfigField(key, rawValue);
const local = await readLocalConfigForEdit();
const candidate = validateLocalConfigCandidate({ ...local.value, [key]: parsedValue });
await writeLocalConfigAtomic(candidate);
```
