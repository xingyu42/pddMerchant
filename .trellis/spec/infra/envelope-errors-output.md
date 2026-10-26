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
| 比率 | number，百分数 0-100，2 位小数，后缀 `_pct` | `refund_rate_pct: 3.12` |
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
