# Changelog

## V0.4 Migration Notes

> V0.3 → V0.4 的对外变更清单。若你在 V0.3 下写了自动化脚本，请按此节核对兼容性。

### Breaking：`--raw` 移除

- **全局选项 `--raw` 已删除**（V0.3 已标记 deprecated）：任何携带 `--raw` 的调用现为 unknown option，stdout 输出 `E_USAGE` envelope 并 exit 2。
- **替代通道**：调试需要原始 XHR 载荷时设 `PDD_DEBUG_RAW=1`，剥离前的 raw 值经脱敏后以单行 JSONL 写 stderr（单值 >64KiB 截断并标记 `truncated`）；stdout envelope 与退出码不受影响。

### Breaking：`raw` 成为 envelope data 保留键

- envelope `data` 下**任意深度**键名严格等于 `raw` 的属性会被递归剥离（含数组内对象）；批量模式逐账号 data 同样适用。
- 业务字段名不受影响（`rawValue`、`raw_url` 等不剥离）。依赖 `data.*.raw` 的消费脚本请迁移至 `PDD_DEBUG_RAW` stderr 通道。

### 新增（additive）

- **batch 冷却归因 warning**：批量执行中某账号触发全局 rate-limit 冷却后，batch envelope 顶层 `meta.warnings` 追加 `cooldown_inherited_from:<slug>`（按字串去重；`<slug>` 为触发冷却的账号）。`data.accounts` 形状与 exit code 语义不变。
- **human 输出脱敏展示副本**：human 模式全部渲染路径（table / 自定义 renderer / 错误提示 / batch 渲染）以脱敏副本展示，敏感字段不再明文出现；`--json` 输出不变。

### 内部重构（无契约影响）

- `bin/pdd.js` 注册拆分至 `src/commands/registry/`（全部 help 输出与拆分前逐字节一致）；`_runner.js`、`mock-dispatcher.js` 改为 facade + 拆分模块；diagnose 渲染下沉 `src/commands/diagnose/_render.js`。envelope schema 与 8 个 exit code 不变。

---

## V0.3 Migration Notes

> V0.2 → V0.3 的对外变更清单。若你在 V0.2 下写了自动化脚本，请按此节核对兼容性。

### Envelope 变更（向前兼容）

- **`meta.exit_code` 新增字段**：每个 envelope 的 `meta` 现在都带 `exit_code: number`，直接对应 `process.exitCode`。既有基于 `error.code` 的消费者无需修改。
- **Commander 解析错误现输出 envelope**：未知子命令 / 缺少参数等 Commander 错误现在会在 stdout 输出 `{ ok: false, error: { code: "E_USAGE" } }` envelope（之前 stdout 为空）。
- **QR 登录 `--json` 模式输出 2 行 JSON**：`pdd init --qr --json` 成功路径输出 `init.qr_pending` + `init` 两行，超时路径输出 `init.qr_pending` + `E_AUTH_TIMEOUT` 两行。
- **`--json` 模式下 stderr 纯错误信息**：error hint 行从 stdout 移到 stderr。

### Logger / 日志变更

- **pino 日志默认写入 stderr**：之前 pino 默认混入 stdout，破坏 `--json` 单行纯净性。脚本若依赖 `pdd orders list 2>/dev/null` 丢弃 stderr 的行为不变。
- **`PDD_LOG_DESTINATION`**：接受绝对路径或项目相对路径。`stdout` / `stderr` / `-` 字面量会触发 `E_USAGE`。

### Auth-state 变更

- **默认路径迁移**：auth-state.json 默认位置从项目 `data/auth-state.json` 移至 OS 用户目录（POSIX: `~/.pdd-cli/auth-state.json`，Windows: `%APPDATA%/pdd-cli/auth-state.json`）。首次运行时自动从旧路径拷贝。`PDD_AUTH_STATE_PATH` 环境变量覆盖仍有效。

### 其他

- `REDACT_KEYS` 新增 `goods_image`、`phone`、`addr`、`receiver_name`。
- `parseMallId` 严格校验（1-15 位数字），`PDD_MALL_ID_STRICT_PARSE=0` 可放宽至 64 字符。
- `--raw` 标记为 deprecated（仍可使用，V0.4 移除）。

---

## V0.2 Migration Notes

> V0.1 → V0.2 的对外变更清单。若你在 V0 / V0.1 下写了自动化脚本，请按此节核对兼容性。

### 已移除的命令

| 命令 | V0 / V0.1 行为 | V0.2 行为 |
|------|----------------|-----------|
| `pdd promo ddk` | 占位：返 `error.code='E_DDK_UNAVAILABLE'` + exit 1 | **子命令不存在**；commander 抛 unknown subcommand，exit 2 (USAGE) |

### 已消失的 error.code

| Code | 之前场景 | V0.2 行为 |
|------|----------|-----------|
| `E_DDK_UNAVAILABLE` | `pdd promo ddk` 调用 | 不再出现在任何 envelope 中 |

### 迁移建议

- 依赖 `pdd promo ddk` 占位行为的 Agent 脚本：彻底移除对该子命令的调用；多多进宝能力在产品 scope 外。
- 依赖 `error.code === 'E_DDK_UNAVAILABLE'` 字符串匹配的消费者：移除相关分支。
- 依赖 exit code 1 的 retry 策略：若触发 `pdd promo ddk` 现为 exit 2（参数错误），建议在脚本侧按 unknown command 处理。

---

## V0.1 Migration Notes

> V0 → V0.1 的对外变更清单。若你在 V0 下写了自动化脚本，请按此节核对兼容性。

### 已消失的 warnings 字串

V0 的以下 `meta.warnings` 字串在 V0.1 **不再出现**，依赖它的 grep 需更新：

| 命令 | V0 warning 字串 | V0.1 行为 |
|------|----------------|-----------|
| `orders detail` | `V0: ORDER_DETAIL 接口未实现，使用 ORDER_LIST 过滤兜底` | 接入真实 `/mangkhut/mms/orderDetail`，返回完整字段 |
| `diagnose funnel` | `diagnose funnel partial: ...` 静态提示 | 改为订单履约漏斗，基于真实 orders 数据打分 |

### 新增 error.code

| Code | 触发场景 | Exit |
|------|----------|------|
| `E_NOT_FOUND` | `orders detail --sn <未知订单号>` | 6 |
| `E_RATE_LIMIT` | HTTP 429 重试耗尽 / 业务码 54001 | 4 |

### 新增 data.* 字段（`diagnose inventory`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `detail.stale_count` | `number \| null` | 过去 30 天 0 销库存件数；`null` 表示 truncated/ratelimited/缺数据 |
| `detail.stale_sample` | `array \| null` | 前 10 条滞销 SKU 样本 |
| `detail.ambiguous_groups` | `array` | 重名组（仅在 goods_name fallback 路径触发） |
| `detail.truncated` | `boolean` | 30 天订单量超出 500 扫描上限 |
| `detail.matched_by` | `'goods_id' \| 'goods_name' \| 'mixed' \| null` | stale 匹配策略；`mixed` 表示降级（一侧有 id 另一侧无，生产常态） |

### 新增 data.* 字段（`diagnose funnel`）

| 字段 | 类型 | 含义 |
|------|------|------|
| `detail.total_orders` | `number` | 窗口内订单总数 |
| `detail.refund_count` | `number` | 退款单数 |
| `detail.refund_rate` | `number` | 退款率（唯一扣分指标） |
| `detail.fulfillment_rate` | `number` | `1 - refund_rate`，仅展示不扣分 |
| `detail.window_days` | `number \| null` | 统计窗口天数（shop=7，funnel 独立命令=30） |

### 未变更

- **Envelope top-level schema**：`{ ok, command, data, error, meta }` 完全兼容。
- **CLI 参数**：所有 V0 命令/flag 保持不变。
