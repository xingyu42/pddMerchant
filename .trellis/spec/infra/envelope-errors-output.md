# Envelope, Errors, and Output Contract

## 1. Scope / Trigger

适用于修改 `src/infra/output.js`、`src/infra/errors.js`、runner finalizer、exit code mapping、JSON/human output、debug raw 输出与任何命令 envelope 字段。

## 2. Signatures

Envelope 顶层形状（输出契约 v2）：

```json
{
  "ok": true,
  "command": "orders.list",
  "data": { "headline": ["近 7 天共 22 单，本页 20 单"], "items": [], "total": 22, "mall_id": "900001" },
  "error": null,
  "meta": {
    "v": 2,
    "exit_code": 0,
    "latency_ms": 0,
    "xhr_count": 0,
    "warnings": []
  }
}
```

Exit codes：

```text
0 OK
1 GENERAL
2 USAGE
3 AUTH
4 RATE_LIMIT
5 NETWORK
6 BUSINESS
7 PARTIAL
```

`data` 字段规范（v2，适用于所有命令、所有层级）：

| 类别 | 规则 | 示例 |
| --- | --- | --- |
| 键名 | 仅 `^[a-z][a-z0-9_]*$`（snake_case） | `display_name` |
| 金额 | number，元，2 位小数，后缀 `_yuan` | `paid_amount_yuan: 29.9` |
| 时间点 | string `YYYY-MM-DD HH:mm:ss`（Asia/Shanghai），后缀 `_at` | `paid_at` |
| 日期 | string `YYYY-MM-DD`，后缀 `_date`，或窗口 `{ start_date, end_date, days }` | |
| 时长 | number，后缀 `_hours`（1 位小数）或 `_seconds` | `ship_p95_hours` |
| 比率 | number，百分数 0-100，2 位小数，后缀 `_pct`；利润率例外见下 | `refund_rate_pct: 3.12` |
| 倍数 | ROI 保持倍数 number | `roi: 2.35` |
| 枚举 | 中文标签 string；未知码 `未知(<code>)`；对照表集中在 `src/services/views/labels.js` | `status: '待发货'` |
| 标识 | string | `goods_id: '101'` |
| 缺失 | `null`，不得补 0；分母为 0 的比率同为 `null` | |
| PII | 收件人 / 联系方式 / 地址字段不进入 `data` | |

换算原语位于 `src/infra/units.js`（`yuanFromFen`、`parseYuanToFen`、`toLocalDateTime`、`isoToLocalDateTime`、`toLocalDate`、`toPct`、`round`、`labelOf`）。

## 3. Contracts

- Envelope top-level MUST remain `{ ok, command, data, error, meta }`。
- Only `meta.warnings` MAY grow for additive warnings; do not add arbitrary top-level fields。
- `meta.v` MUST be `2`: single constant `ENVELOPE_VERSION` in `src/infra/output.js`; `buildEnvelope` writes it after merging caller meta, so commands cannot override it. Single-command, batch, error and commander usage-error envelopes all carry `v: 2`。
- `meta` carries technical fields only (`v`, `exit_code`, `latency_ms`, `xhr_count`, `warnings`, `correlation_id`, `account*`, batch flag). Business context (`total`, `mall_id`, `threshold` …) belongs in `data`。
- Successful `data` MUST be a plain object with `headline: string[]` (1–3 factual Chinese sentences: counts, states, missing data; no advice, scores or good/bad judgements)。
- List-like commands MUST use `{ headline, items, total, ...context }`; `data` is never a top-level array。
- Upstream objects MUST NOT reach `data`; services project them through whitelist views in `src/services/views/`。
- `data` MUST NOT use `data` / `meta` / `warnings` as top-level keys (reserved by `normalizeRunResult`); warnings travel via the `{ data, warnings }` return shape。
- Batch envelopes (`--all-accounts`): `data = { headline, accounts: { <slug>: { ok, data | error, latency_ms } }, summary }`; each `accounts.<slug>.data` is that command's v2 data。
- Error envelopes are outside the `data` contract: `data` is `null`, and `error.detail` MAY keep internal codes (e.g. doctor `logged_in.detail.verdict: 'indeterminate'`) for diagnosis。
- `--json` stdout MUST be one JSON line and parse as a single envelope。
- Human diagnostics, raw debug and logs MUST NOT write to stdout in JSON mode。
- Human (non-`--json`) rendering prints `data.headline` first, renders `data.items` as a row table (headers = union of row keys) and remaining keys as a key/value table; batch rendering prints the batch headline before per-account blocks。
- Errors MUST use `PddCliError` and `ExitCodes` from `src/infra/errors.js`。
- 利润率显式例外：goods.profit 的 gross_margin_pct/net_margin_pct 为有符号百分数，可负、可超过 ±100，不做截断；零收入或未知分子/分母为 null。gross 扣商家成本，net 再扣商品归属/报表总推广，保留数字正负，无盈亏分类。
- 成本导入错误 E_COST_IMPORT_INVALID / exit 2 使用 error.detail.row_errors[{row,field,message}]；语义错误 row 为 1-based 记录序号，JSON 语法错误 row:null。E_COST_IMPORT_IO / exit 2、E_COST_STORE_IO / exit 1 使用安全固定消息，省略原生路径。以上仍为标准 error envelope，data:null。
- Unknown errors MUST be mapped into the standard envelope instead of escaping as stack traces on stdout。

## 4. Validation & Error Matrix

| 条件                      | envelope / exit behavior                                            |
| ------------------------- | ------------------------------------------------------------------- |
| success                   | `ok: true`, `error: null`, `meta.exit_code: 0`                      |
| usage validation failure  | `ok: false`, usage error, exit code 2                               |
| auth expired/invalid      | `ok: false`, auth error, exit code 3                                |
| rate limit/cooldown       | `ok: false`, rate-limit error, exit code 4                          |
| network/timeout           | `ok: false`, network error, exit code 5                             |
| platform business failure | `ok: false`, business error, exit code 6                            |
| partial batch             | partial envelope semantics, exit code 7, warnings/details preserved |

Password relogin errors（`src/infra/errors.js`，全部 exit 3；场景见 [auth-mall-context.md](../adapter/auth-mall-context.md) 第 9 节）：

| 工厂函数 | code | message | hint | detail |
| --- | --- | --- | --- | --- |
| `authHumanRequired` | `E_AUTH_HUMAN_REQUIRED` | 账号登录需要人工完成验证 | 执行 pdd console link 获取控制台链接并转给用户；不要在聊天中索要密码 | `{ account, challenge }` |
| `reloginBlocked` | `E_AUTH_RELOGIN_BLOCKED` | 账号自动重登已熔断 | 执行 pdd console link 重设密码或解除熔断，或执行 pdd login --qr 扫码登录 | `{ account, reason }` |
| `reloginFailed` | `E_AUTH_RELOGIN_FAILED` | 自动重登未完成 | 稍后重试或执行 pdd login | `{ account, reason, relogin?, next_attempt_at? }` |
| `passwordLoginFormChanged` | `E_PASSWORD_LOGIN_FORM_CHANGED` | 登录页结构已变化，无法自动填写账密 | 执行 pdd login --qr 扫码登录，并反馈此问题 | `{ account, reason? }` |

- 四个工厂的 detail 都经 `reloginDetail()` 白名单：`account`（string）、`challenge` / `reason`（仅已知重登原因码；`reason` 另允许 `null`，即崩溃后首次尝试无结果时的限频错误）、`relogin: 'throttled'`、`next_attempt_at`（`YYYY-MM-DD HH:mm:ss`）。登录名、密码、URL、页面文字一律丢弃。
- 限频窗口内的 `E_AUTH_EXPIRED` 同样附 `{ relogin: 'throttled', next_attempt_at }`。
- 旧的 `authChallengeRequired` 已删除。

daemon 与控制台错误（`src/infra/errors.js` / `services/console-runtime.js`）：

| code | exit / HTTP | 场景 |
| --- | --- | --- |
| `E_DAEMON_NOT_RUNNING` | exit 1 | `console link` 时 daemon 未运行（hint `执行 pdd daemon start`） |
| `E_DAEMON_START_TIMEOUT` | exit 1 | `daemon start` 10 秒内未见心跳 |
| `E_DAEMON_STOP_TIMEOUT` | exit 1 | 租约属于其他主机，或强杀后仍未释放；detail 仅 `{ pid?, port?, reason }` |
| `E_CONSOLE_PORT_IN_USE` | exit 1 | 监听端口被占用 |
| `E_CONSOLE_HOST` | 421 | Host 头不匹配（防 DNS rebinding） |
| `E_CONSOLE_CSRF` | 403 | 状态变更请求缺少 JSON 类型或 `X-PDD-Console: 1` |
| `E_CONSOLE_UNAUTHORIZED` | 401 | 无有效控制台会话 |
| `E_CONSOLE_LINK_GONE` / `E_CONSOLE_LINK_EXPIRED` | 410 | 一次性链接已兑换或过期 |
| `E_CONSOLE_BODY_TOO_LARGE` | 413 | 请求体超过 64 KiB |
| `E_CONSOLE_BUSY` | 429 | 已有两个账号的登录会话 |
| `E_CONSOLE_SESSION_NOT_FOUND` / `E_CONSOLE_SESSION_STATE` | 404 / 409 | 会话不存在或当前状态不接受该操作 |
| `E_CONSOLE_STOPPING` | 503 | daemon 正在停止 |

控制台 API 错误体为 `{ error: { code, message } }`，message 中文，不含密码、登录名、token、路径。

Warning `daemon_not_running`：`{ code: 'daemon_not_running' }`，仅当 needsAuth 命令的当前账号有 open 待办且 daemon 租约无效时附加，每个 envelope（含批量）最多一条。`daemon start` 在非回环监听地址时附 `{ code: 'console_plaintext_http' }`。

Warning `account_action_required`：`{ code: 'account_action_required', account: <slug>, reason }`，仅 needsAuth 命令附加，覆盖成功与失败两条路径，只针对本次实际使用的账号；批量模式按账号汇总。doctor、`account list` 等 needsAuth:false 命令从不附加。

## 5. Good/Base/Bad Cases

- Good：service returns plain data; runner builds envelope and sets exit code。
- Base：`PDD_DEBUG_RAW=1` emits redacted pre-strip raw payload to stderr JSONL; stdout envelope stays unchanged。
- Bad：adding `traceId` at envelope top-level; use `meta` only if existing contract allows, otherwise OpenSpec/Trellis update first。
- Bad：returning `{ data: rows, meta: { total, mall } }` — v1 shape; return `{ headline, items, total, mall_id }` instead。

## 6. Tests Required

- Output unit tests for success/error envelope shape and exit code mapping。
- Smoke/e2e tests that parse stdout as exactly one JSON object under `--json`。
- Error tests for `PddCliError` and unknown thrown errors。
- Regression tests for `PDD_DEBUG_RAW=1` ensuring stderr only and redacted payload.
- `test/helpers/envelope-assertions.js` `assertEnvelopeShape` asserts `meta.v === 2`; `test/contract/data-contract-v2.test.js` asserts the `data` rules for every registered command (see `standards/testing.md`)。

## 7. Wrong vs Correct

### Wrong

```js
console.log('loading...');
console.log(JSON.stringify({ ok: true, data }));
```

### Correct

```js
ctx.log.info({ command }, 'loading');
return finalizeSuccess(command, data, meta);
```

## 8. Real Code Examples

### PddCliError (`src/infra/errors.js:14-23`)

```js
export class PddCliError extends Error {
  constructor({ code, message, hint, detail, exitCode }) {
    super(message);
    this.name = 'PddCliError';
    this.code = code ?? 'E_GENERAL';
    this.hint = hint ?? '';
    this.detail = detail ?? null;
    this.exitCode = exitCode ?? ExitCodes.GENERAL;
  }
}
```

### Exit code mapping (`src/infra/errors.js:25-37`)

```js
export function mapErrorToExit(err) {
  if (err instanceof PddCliError) return err.exitCode;
  if (!err || typeof err !== 'object') return ExitCodes.GENERAL;
  const code = String(err.code || '').toUpperCase();
  if (code.includes('AUTH') || code === 'UNAUTHORIZED') return ExitCodes.AUTH;
  if (code.includes('RATE') || code === 'TOO_MANY_REQUESTS') return ExitCodes.RATE_LIMIT;
  if (code.includes('NETWORK') || code === 'ECONNRESET' || code === 'ETIMEDOUT') return ExitCodes.NETWORK;
  if (code === 'E_USAGE' || code === 'EINVAL') return ExitCodes.USAGE;
  if (code === 'E_BUSINESS' || code === 'E_NOT_FOUND') return ExitCodes.BUSINESS;
  if (code === 'E_PARTIAL') return ExitCodes.PARTIAL;
  return ExitCodes.GENERAL;
}
```

### Factory helper pattern (`src/infra/errors.js:39-46`)

```js
export function accountNotFound(slug) {
  return new PddCliError({
    code: 'E_ACCOUNT_NOT_FOUND',
    message: `Account "${slug}" not found in registry`,
    hint: 'Run "pdd account list" to see registered accounts',
    exitCode: ExitCodes.USAGE,
  });
}
```
