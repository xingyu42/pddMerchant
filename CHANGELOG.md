# Changelog

## Unreleased

### Added

- **商家账号密码自动重登**：账号保存了密码时，普通命令发现商家登录态失效会在同一条命令内用账密重登一次，成功后命令继续完成；重登耗时不计入 `--timeout`，单次最长 90 秒。重登从账号已保存的设备状态（去掉会话 Cookie）开始，保留设备信任。密码录入入口由后续控制台提供，当前版本没有录入命令。
- **遇到验证一律转人工**：短信、滑块、点选、风控确认或无法识别的页面返回 `E_AUTH_HUMAN_REQUIRED`（退出码 3），并暂停该账号的自动重登，直到用户完成登录。
- **熔断**：密码错误或账号被锁返回 `E_AUTH_RELOGIN_BLOCKED`（退出码 3），之后不再尝试，直到用户重设密码或解除熔断；也可随时 `pdd login --qr` 扫码登录。
- **限频**：同一账号两次尝试至少间隔 30 分钟，可用配置 `passwordReloginMinIntervalMs` / 环境变量 `PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS` 调整；窗口内返回的错误附 `detail.relogin = 'throttled'` 与 `next_attempt_at`。
- **并发复用**：多个进程同时发现同一账号失效时只登录一次，其余进程等待并复用新的登录态。
- **待办提醒**：需要认证的命令会在 `meta.warnings` 中附 `{ code: 'account_action_required', account, reason }`，提示该账号有待用户处理的事项（成功与失败均会附带）。
- **输出字段**：`account list` 每项新增 `has_password`、`password_relogin_status`；`doctor` 新增 `password_relogin = { has_password, status }`，`accounts[]` 每项新增同样两项。状态为中文，例如 `可用`、`等待人工：短信验证`、`已熔断：密码错误`。`doctor` 与 `account list` 不触发重登。
- **新错误码**（均为退出码 3）：`E_AUTH_HUMAN_REQUIRED`、`E_AUTH_RELOGIN_BLOCKED`、`E_AUTH_RELOGIN_FAILED`；`E_PASSWORD_LOGIN_FORM_CHANGED` 文案改为中文。

### Changed

- **脱敏**：`password`、`credential(s)`、`login_name` / `loginName`、`masterPassword`、`master_key`、`password_sealed` 在日志与调试输出中固定为 `[REDACTED]`，不再输出可被枚举的指纹。

### Removed

- 无调用方的 `E_AUTH_CHALLENGE_REQUIRED`（`authChallengeRequired`）。

---

## V0.5 Migration Notes

> V0.4 → V0.5 的对外变更清单。升级到 `0.5.0` 后，请重新登录每个商家和消费者账号。

### Breaking

- **账号和登录态统一存入 SQLite**：默认数据库为 `data/pdd.db`，可用 `PDD_DB_PATH` 覆盖。自动生成的主密钥默认位于 `data/master.key`，始终与数据库同目录；两者均为敏感文件，勿提交，并须一起备份、恢复。
- **旧数据保留原样**：旧 JSON 注册表和 auth-state 文件均不迁移、不删除；`doctor` 检测到时提示“检测到旧版数据，已不再使用，可手动删除”，输出不含旧文件路径或内容。
- **以下 8 个环境变量已删除**：`PDD_AUTH_STATE_PATH`、`PDD_CONSUMER_AUTH_STATE_PATH`、`PDD_ACCOUNTS_DIR`、`PDD_CONSUMER_ACCOUNTS_DIR`、`PDD_ACCOUNT_REGISTRY_PATH`、`PDD_CONSUMER_ACCOUNT_REGISTRY_PATH`、`PDD_ALLOW_INSECURE_AUTH_STATE`、`PDD_MASTER_PASSWORD`。存储位置统一由 `PDD_DB_PATH` 指定。
- **`account remove --remove-files` 已移除**：携带此选项现为 unknown option；删除账号始终级联删除该账号的登录态及关联数据。`account remove` 的 data 不再包含 `files_removed` 字段。
- **登录期间可以删除或切换默认账号**：`account remove` / `account default` 不再等待进行中的登录；账号在登录过程中被删除时，登录最终提交返回 `E_AUTH_STATE_CONFLICT`，账号不会被重新创建，重新执行登录即可。
- **消费者账号 slug 按 uid 保持稳定**：昵称变化只更新显示名，slug 不再随之改变。
- **`authStatePath` 配置字段退役**：旧本地配置中的该字段会被忽略，`config set authStatePath` 返回未知字段错误。
- **账号视图字段调整**：删除 `has_credential` / `last_refresh_at`，消费这些字段的脚本需同步调整。
- **要求 Node.js >= 24**：低版本启动时 stdout 输出一行 `E_USAGE` envelope，退出码为 `2`，并提示升级。

### 升级方式

使用 Node.js >= 24，逐个执行 `pdd login` 登录商家账号、`pdd login --consumer` 登录消费者账号，再运行 `pdd doctor` 自检。旧数据确认无需保留后可手动清理；备份时同时保留数据库与同目录的主密钥。

---

## V0.4 Migration Notes

> V0.3 → V0.4 的对外变更清单。若你在 V0.3 下写了自动化脚本，请按此节核对兼容性。

### Breaking：`--raw` 移除

- **全局选项 `--raw` 已删除**（V0.3 已标记 deprecated）：任何携带 `--raw` 的调用现为 unknown option，stdout 输出 `E_USAGE` envelope 并 exit 2。
- **替代通道**：调试需要原始 XHR 载荷时设 `PDD_DEBUG_RAW=1`，剥离前的 raw 值经脱敏后以单行 JSONL 写 stderr（单值 >64KiB 截断并标记 `truncated`）；stdout envelope 与退出码不受影响。

### Breaking：`raw` 成为 envelope data 保留键

- envelope `data` 下**任意深度**键名严格等于 `raw` 的属性会被递归剥离（含数组内对象）；批量模式逐账号 data 同样适用。
- **失败面同步剥离**：`error` 子树（含 `error.detail.raw`）同样在 envelope 边界剥离——失败响应的原始报文不再随 `--json` stdout 输出，调试同样走 `PDD_DEBUG_RAW=1`（stderr JSONL 中以 `error.` 路径前缀标记）。
- 业务字段名不受影响（`rawValue`、`raw_url` 等不剥离）。依赖 `data.*.raw` / `error.detail.raw` 的消费脚本请迁移至 `PDD_DEBUG_RAW` stderr 通道。

### 新增（additive）

- **REDACT_KEYS 新增收件人 PII 别名**：`receiver_phone`、`receiverPhone`、`receiver_address`、`receiverAddress`、`Cookie` 加入脱敏键集——订单详情类载荷的收件人手机号/详细地址在所有输出面（json/human/debug/日志）以 `fp:` 指纹呈现；省市区等粗粒度地理字段保持可见。

- **batch 冷却归因 warning**：批量执行中某账号触发 rate-limit 冷却后（冷却在进程内按 endpoint 维度共享），后续账号命中**同一 endpoint** 的已激活冷却时，batch envelope 顶层 `meta.warnings` 追加 `cooldown_inherited_from:<slug>`（按字串去重；`<slug>` 为该 endpoint 最近一次触发冷却的账号，来源 endpoint 不明时退化为全局归因）。`data.accounts` 形状与 exit code 语义不变。
- **human 输出脱敏展示副本**：human 模式全部渲染路径（table / 自定义 renderer / 错误提示 / batch 渲染）以脱敏副本展示，敏感字段不再明文出现；`--json` 输出不变。
- **IP 软封退避 + 持久长冷却**：选品抓取（`goods publish` Phase A）以**价格脱敏**（DOM `isPriceMasked`：价格 null/0/非法占位如"¥7.??"）作为 IP/会话软封信号；连续软封达 `PDD_SCRAPE_SOFTBLOCK_THRESHOLD`（默认 2）后进入持久冷却（`PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS`，默认 2h，落盘 `data/scrape-cooldown.json` 跨 CLI 调用生效），冷却期内抓取在发请求前短路退避（`E_RATE_LIMIT`，`detail.reason='ip_soft_block'`），避免反复重试持续烧 IP。纯 `_maskHint`（价格仍可解析）视为单品门控不计冷却。（不依赖 SSR 字段：登录态 `window.rawData` 有值，但其 `goods.enableSkuMask` 在正常商品上亦恒为 true，非软封判据。）纯防御退避，不绕过风控。

### 内部重构（无契约影响）

- `bin/pdd.js` 注册拆分至 `src/commands/registry/`（全部 help 输出与拆分前逐字节一致）；`_runner.js`、`mock-dispatcher.js` 改为 facade + 拆分模块；diagnose 渲染下沉 `src/commands/diagnose/_render.js`。envelope schema 与 8 个 exit code 不变。

### 勘误（docs）

- **auth-state 当前默认路径**：无注册表时，商家和消费者分别使用 `data/merchant/stores/default/auth-state.json` 与 `data/consumer/accounts/default/auth-state.json`；注册身份后使用各自 registry 记录的 `<slug>/auth-state.json`。slug 由显示名生成并处理冲突，不等同于原始店铺名、昵称或手机号；显式路径环境变量覆盖语义不变。旧根级登录态不再自动迁移。

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
