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
mobile, masterPassword, ciphertext
```

## 3. Contracts

- Runtime code MUST NOT use `console.log` for logs; use `src/infra/logger.js` or `ctx.log`。
- Sensitive values MUST be SHA256/fingerprint redacted rather than printed raw。
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

Full list in source; key pattern: all casing variants of a sensitive concept share one canonical key name in `REDACT_KEYS`.
