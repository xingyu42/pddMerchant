# Logging and Redaction Contract

## 1. Scope / Trigger

适用于修改 `src/infra/logger.js`、output redaction、debug raw、auth/login/adapter 日志、任何新增敏感字段或日志目的地。

## 2. Signatures

Logger 使用边界：

```js
ctx.log.info({ command, mallId }, 'operation started');
```

敏感字段关键词必须脱敏，包括：

```text
anti_content, authorization, cookies, goods_image, phone, addr,
receiver_name, receiver_phone, receiver_address, password, credential,
mobile, masterPassword, ciphertext, state_sealed, password_sealed, master_key
```

其中 `SECRET_KEYS`（`password`、`password_sealed`、`masterPassword`、`master_key`、`credential`、`credentials`、`login_name`、`loginName`）命中时固定输出 `'[REDACTED]'`，不输出指纹：8 位 sha256 指纹可被枚举，短密码和 11 位手机号都能反推。其余 `REDACT_KEYS` 保持 `fp:` 指纹，便于关联比对。`SECRET_KEYS` 是 `REDACT_KEYS` 的子集，新增密码类字段时加到 `SECRET_KEYS`。

`iv` / `tag` / `ct` 不在列表中：secret-box 的密封结果以 JSON 字符串存在 `state_sealed` / `password_sealed` 下，这三个名字不会作为对象键出现；而 `tag`、`ct` 可能是合法的账号 slug（批量 envelope 的 `data.accounts` 以 slug 为键），加入会误伤业务数据。

New sensitive keys must be camelCase (or otherwise impossible as an account slug) because batch output is keyed by slug; daemon/console code must log tokens, sessions, QR images, and frame JPEGs only under `consoleToken`, `consoleSession`, `qrImage`, and `frameJpeg`, respectively.

## 3. Contracts

- Runtime code MUST NOT use `console.log` for logs; use `src/infra/logger.js` or `ctx.log`。
- Sensitive values MUST be SHA256/fingerprint redacted rather than printed raw。Password-class keys (`SECRET_KEYS`) MUST output the fixed `'[REDACTED]'` marker; never a fingerprint.
- `PDD_DEBUG_RAW` goes through the same `redactRecursive`, so `SECRET_KEYS` rules apply to raw payload output too.
- Password login code MUST NOT log `err.message` from Playwright (it may echo filled values); map to fixed reasons instead.
- Log path is NOT configurable (`PDD_LOG_DESTINATION` / `logDestination` removed).
- Runtime log files MUST live under `log/cli/YYYY-MM-DD.log` (local calendar day). The merchant auth daemon and its log channel are removed; existing historical files are not deleted.
- Daily rotation MUST auto-switch across midnight without restart; historical day files are retained.
- Parent log directories MUST be created before write.
- Bootstrap / silent logger (no runtimeConfig) MUST NOT force a project log file; stderr remains acceptable.
- QR content、cookies、Anti-Content、authorization、credentials、receiver/contact/address/media fields MUST NOT appear raw in stdout/stderr/log files。
- Debug raw output MUST truncate large values per configured behavior and mark truncation。

## 4. Validation & Error Matrix

| 条件                                             | 行为                                                     |
| ------------------------------------------------ | -------------------------------------------------------- |
| log object contains sensitive key                | replace value with fingerprint/redacted marker           |
| key in `SECRET_KEYS` (password / login name / master key) | fixed `'[REDACTED]'`; no fingerprint             |
| caller tries console logging runtime status      | reject in review; use logger/stderr helper through infra |
| legacy `PDD_LOG_DESTINATION` environment variable | not mapped; fixed channel directories remain in effect |
| legacy local `logDestination` key                 | strict config error; migration intentionally excluded  |
| raw payload debug enabled                        | stderr JSONL only, redacted and size-limited             |
| new sensitive field introduced                   | update redaction list and tests in same change           |

## 5. Good/Base/Bad Cases

- Good：log stable identifiers, counts and redacted fingerprints for correlation。
- Base：include `mallId` only after validating it is not a secret under current parsing mode。
- Bad：log full request headers or auth state for debugging。

## 6. Tests Required

- Redaction unit tests for every sensitive key and common casing/nesting variants。
- Config tests proving the removed local `logDestination` key is rejected by strict schema。
- Logger tests for CLI / foreground / bootstrap channel routing。
- Debug raw tests for redaction + truncation + stderr-only behavior。
- Login/auth tests ensuring QR/cookie/credential content is never exposed.
- `test/infra/logger-redaction.test.js`: `SECRET_KEYS` output `[REDACTED]`; neither the password nor its sha256 fingerprint prefix appears. `test/e2e/password-relogin.e2e.test.js`: with `PDD_DEBUG_RAW=1`, stdout/stderr/log files/DB bytes contain no password plaintext.

## 7. Wrong vs Correct

### Wrong

```js
ctx.log.debug({ cookies, anti_content }, 'request headers');
```

### Correct

```js
ctx.log.debug({ cookie_count: cookies.length, anti_content: '[REDACTED]' }, 'request headers ready');
```

## 8. Real Code Examples

### Logger creation (`src/infra/logger.js:125-159`)

```js
export function createLogger({ verbose = false, level, destination, config } = {}) {
  const resolvedLevel = level ?? (verbose ? 'debug' : 'warn');
  const opts = {
    level: resolvedLevel,
    serializers: { err: (err) => redactRecursive(err) },
    formatters: { log(obj) { return redactRecursive(obj); } },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const dest = destination ?? buildDestination(config);
  const logger = pino(opts, dest);

  logger.withOp = function withOp(ctx) {
    const bindings = {};
    if (ctx.command) bindings.command = ctx.command;
    if (ctx.endpoint) bindings.endpoint = ctx.endpoint;
    if (ctx.correlation_id) bindings.correlation_id = ctx.correlation_id;
    if (ctx.mall_id != null) {
      bindings.mall_id_hash = fingerprint(String(ctx.mall_id));
    } else {
      bindings.mall_id_hash = null;
    }
    return logger.child(bindings);
  };
  currentLogger = logger;
  return logger;
}
```

### SHA256 fingerprint redaction (`src/infra/logger.js:57-70`)

```js
function fingerprint(value) {
  if (value == null) return value;
  let str;
  if (typeof value === 'string') { str = value; }
  else {
    try { str = safeStringify(value); }
    catch { str = String(value); }
  }
  return 'fp:' + createHash('sha256').update(str).digest('hex').slice(0, 8);
}
```

### Redact keys set (`src/infra/logger.js:4-39`)

Full list in source; key pattern: all casing variants of a sensitive concept share one canonical key name in `REDACT_KEYS`. `SECRET_KEYS` is spread first into `REDACT_KEYS`; `redactKey(v, key)` checks `SECRET_KEY_SET` before fingerprinting.
