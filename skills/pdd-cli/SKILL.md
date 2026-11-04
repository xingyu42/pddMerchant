---
name: pdd-cli
description: 拼多多商家后台 pdd CLI：查询订单、商品、推广与经营报表（售后、体验星级、客服、评价、流量、净利润），录入商品成本，改价、上下架、改库存与上货，多账号切换与登录失效处理。
user-invocable: true
metadata:
  openclaw:
    requires:
      bins: [node]
---

# pdd-cli

`pdd` 驱动 Chromium 打开拼多多商家后台、拦截 XHR 响应，并把结果封装为单行 JSON envelope。纯 Node.js ESM，无构建步骤。

## 调用

在项目根目录运行，始终加 `--json`：

```bash
node bin/pdd.js <command> [options] --json   # 已 npm link 时可写 pdd <command>
```

全局选项写在子命令前：`--json` / `--timeout <ms>` / `--mall <id>` / `--account <slug>` / `--consumer-account <昵称|手机号|slug>` / `--all-accounts` / `--headed` / `--verbose` / `--no-color`。各命令参数以 `node bin/pdd.js <command> --help` 为准。

## 读取结果

```json
{"ok":true,"command":"orders.list","data":{"headline":["近 7 天共 22 单，本页 20 单"],"items":[],"total":22,"mall_id":"900001"},"error":null,"meta":{"v":2,"exit_code":0,"latency_ms":812,"warnings":[]}}
```

- `ok:false` 时 `error` 含 `code` / `message`，可能带 `hint` / `detail`，`data` 为 `null`。业务字段在 `data`，`meta` 只有技术信息；`meta.warnings` 可能带待办事项（见「登录失效与人工处理」）。
- `data` 恒为对象并含 `headline`；列表为 `{ headline, items, total, ... }`。键名 snake_case；金额为元（`_yuan`）；比率为 0–100 百分数（`_pct`）；时间 `_at` 为北京时间 `YYYY-MM-DD HH:mm:ss`；枚举为中文标签，无法识别的码显示 `未知(<code>)`；`goods_id` / `mall_id` / `order_sn` 为字符串。
- `--all-accounts` 返回 `{ headline, accounts: { <slug>: { ok, data | error, latency_ms } }, summary }`。

按退出码判断结果：

| 码 | 含义 | 处理 |
|----|------|------|
| 0 | 成功 | |
| 1 | 通用错误 | 读 `error.message` 与 `error.hint`（daemon 启停超时、控制台端口占用等） |
| 2 | 参数错误 | 按 `error.message` 修正参数 |
| 3 | 鉴权 | 按「登录失效与人工处理」分辨 `error.code` |
| 4 | 限流 | 连续 3 次 429 触发 5 分钟全局冷却，等待后重试 |
| 5 | 网络 | 包括 `E_AUTH_CHECK_INDETERMINATE`（无法判定登录态），登录态仍可能有效，稍后重试 |
| 6 | 业务错误 | 如店铺无权限，转告用户 |
| 7 | 部分成功 | 逐项检查结果 |

### 转述结果

- 以 `data.headline` 开头；需要细节时用字段的中文含义转述（「实付 23.50 元」）。
- `null` 表示未知或数据缺失，说「数据不可用」；分母为 0 的比率也是 `null`。
- 诊断的 `status`（`数据完整` / `数据不完整`）只描述数据完整性；`hints`、`data_quality`、截断标记原样转述。
- 输出是事实数字。经营判断、评分、保本 ROI 和建议留给用户自己做。
- 报表的字段与口径细节见 [reports.md](reports.md)；转述 `diagnose *`、`goods traffic`、`goods profit` 结果前先读。

## 命令

### 鉴权与环境

```bash
node bin/pdd.js init [--qr]              # 首次登录（默认弹浏览器；--qr 终端扫码）
node bin/pdd.js login [--qr|--consumer]  # 重新登录
node bin/pdd.js doctor [--probe xhr]     # 环境与登录态自检
```

### 运行配置

```bash
node bin/pdd.js config show|validate --json
node bin/pdd.js config set <key> <value> --json   # 校验后写入 config/config.json 本地覆盖
node bin/pdd.js config unset <key> --json
```

优先级：`config/config.example.json` 基线 → `config/config.json` → 环境变量 → CLI 参数。秘密、安全与测试开关只走环境变量（见 `.env.example`）；config 命令不显示它们。

### 订单

```bash
node bin/pdd.js orders list [--page 1] [--size 20] [--since <unix>] [--until <unix>] [--status all|pending_ship|shipped|received|after_sales]
node bin/pdd.js orders detail --sn <订单号>
node bin/pdd.js orders stats [--size 50]   # 本地样本 P50/P95、退款与售后计数
```

- `orders list` 默认近 7 天（按成团时间）全部订单；`pending_ship` / `shipped` / `received` 不含售后中订单。更早的待发货订单不在列表里，待发货总数以 `orders stats` 为准。`--size` 最大用 50（100 会被上游拒绝）。
- 退款只看 `after_sales_status`：`退款成功` / `售后处理中` / `null`（无售后）。

### 商品

```bash
node bin/pdd.js goods list [--page 1] [--size 10] [--status onsale|offline]
node bin/pdd.js goods stock [--threshold 10]                         # 低库存 / 缺货
node bin/pdd.js goods segment [--days 30] [--max-pages 10] [--no-promo]  # 销量与库存统计
node bin/pdd.js goods traffic [--days 30] [--goods-id <id>]          # 商品流量与推广拆分
node bin/pdd.js goods profit [--days 30] [--goods-id <id>]           # 净利润（需先录入成本）
node bin/pdd.js goods templates                                      # 运费模板 ID
```

商品缺少 `goods_id` 时，库存与销量匹配回退到商品名，`matched_by` 显示「按商品名匹配（一侧缺少商品 ID）」，属正常结果。

### 商品写操作

```bash
node bin/pdd.js goods update status --goods-id <id> --status onsale|offline [--confirm]
node bin/pdd.js goods update price  --goods-id <id> --price-yuan <元> [--sku-id <id>] [--confirm]
node bin/pdd.js goods update stock  --goods-id <id> --quantity <n> [--sku-id <id>] [--confirm]
node bin/pdd.js goods update title  --goods-id <id> --title "<新标题>" [--confirm]
node bin/pdd.js goods update batch  --changes '[{"goods_id":1001,"field":"price_yuan","value":29.9}]' [--confirm]
node bin/pdd.js goods publish --url <链接或goods_id> [--cost-template <id>] [--confirm]
```

写操作会改动线上商品，按以下顺序执行：

1. 与用户核对商品 ID 和目标值。价格单位是**元**，最多两位小数（`--price-yuan 29.9`）；batch 的 `field` 取 `status | price_yuan | stock | title`。
2. 先不加 `--confirm` 运行，得到预演（`dry_run:true`，headline 形如「预演：商品 101 价格将改为 29.90 元，未提交」）。
3. 把预演 headline 给用户看，用户明确同意后加 `--confirm` 重跑。
4. 完成标准：返回 `ok:true` 且 `dry_run:false`；batch 逐项检查 `results[].ok`，把失败项及 `message` 告诉用户。

`goods publish` 不加 `--confirm` 时在后台创建草稿，加 `--confirm` 直接提交发布；先用 `goods templates` 取运费模板 ID。

### 商品成本

```bash
node bin/pdd.js goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 [--spec <精确规格>] [--insurance-yuan 0.3] [--technical-service-yuan 0.2] [--confirm]
node bin/pdd.js goods cost list [--goods-id 101]
node bin/pdd.js goods cost import costs.json [--confirm]
node bin/pdd.js goods cost remove --goods-id 101 [--spec <精确规格>] [--confirm]
```

- 只读写本地 SQLite，需要已登记的商家账号，无需在线登录。成本按账号 + 店铺 + 商品 + 规格隔离；店铺取 `--mall` 或配置，否则取账号绑定店铺，核对输出的 `mall_id`。写命令同样先预演再 `--confirm`；均只作用于单个账号。
- 货本按件，包材、快递、运费险、技术服务费按单；金额为元，允许 0。`set` 整条替换，省略的可选费用归零。`--spec` 按原文精确匹配，未命中时回落默认成本；`remove` 不带 `--spec` 只删默认行。
- `import`：UTF-8 JSON 数组，最多 1 MiB / 5000 条，字段 `goods_id`、可选 `spec`、`purchase_yuan`、`packaging_yuan`、`courier_yuan`、可选 `insurance_yuan` / `technical_service_yuan`（模板见 README「商品成本与净利润」）。整批校验通过才写入；失败返回 `E_COST_IMPORT_INVALID`（退出码 2），`error.detail.row_errors` 按从 1 开始的记录序号定位，JSON 语法错误为 `row:null`。

### 推广

```bash
node bin/pdd.js promo roi [--by plan|sku|channel] [--since YYYY-MM-DD] [--size 50] [--include-inactive]
```

### 经营报表

```bash
node bin/pdd.js diagnose shop [--compare] [--days 7]   # 订单/库存/推广/售后四维汇总与环比
node bin/pdd.js diagnose orders|inventory|promo        # 单维度统计
node bin/pdd.js diagnose after-sales [--days 30]       # 退款成功与售后处理中
node bin/pdd.js diagnose experience [--days 7]         # 店铺综合体验星级，1–30 天
node bin/pdd.js diagnose customer-service [--days 30]  # 客服人工回复，1–63 天；逐日趋势最多最近 31 天
node bin/pdd.js diagnose reviews [--days 30]           # 评价标签与中差评，30/60/90/180 天
node bin/pdd.js diagnose traffic [--days 30]           # 全店逐日流量，1–30 天
```

`goods traffic` 的 `non_promo_*` 是 CLI 推算的差值，推广拆分口径尚未实测；`goods profit` 有两项可能高估。转述前读 [reports.md](reports.md)。

### 店铺与账号

```bash
node bin/pdd.js shops list|current
node bin/pdd.js account add                    # 有头浏览器登录并登记
node bin/pdd.js account list
node bin/pdd.js account default --slug <slug>
node bin/pdd.js account remove --slug <slug> [--confirm]   # 默认预演；--confirm 才级联删除登录态、密码与成本等数据
```

## 登录失效与人工处理

账号保存了密码时，普通命令发现登录失效会在同一条命令内自动重登一次。需要人工时，由用户本人在网页控制台完成。

| 看到 | 处理 |
|------|------|
| `E_AUTH_EXPIRED` | 请用户执行 `node bin/pdd.js login`（或 `login --qr`） |
| `E_AUTH_HUMAN_REQUIRED`（短信、滑块等验证） | 执行 `console link`，把 `data.url` 转给用户本人完成 |
| `meta.warnings` 含 `account_action_required`（命令本身可能已成功） | 对 `account` 指明的账号执行 `console link` 并转给用户 |
| warning `daemon_not_running`，或 `console link` 返回 `E_DAEMON_NOT_RUNNING` | 先 `daemon start`，再 `console link` |
| `E_AUTH_RELOGIN_BLOCKED`（密码错误、账号锁定或多次超时，已熔断） | `console link` 让用户重设密码或解除熔断；用户无法处理时改用 `login --qr` |
| `E_PASSWORD_LOGIN_FORM_CHANGED` | 改用 `login --qr`，并告知用户登录页已变化 |
| `E_AUTH_RELOGIN_FAILED`，或 `error.detail.relogin = 'throttled'` | 自动重登暂不可用，稍后重试或请用户 `login` |
| `E_MASTER_KEY_MISSING` / `E_MASTER_KEY_MISMATCH` / `E_MASTER_KEY_INSECURE` / `E_SECRET_DECRYPT_FAILED` | 主密钥与数据库不配套，重新登录无效。把 `error.hint` 转告用户，由用户决定恢复密钥或清库；数据库与 `master.key` 保持原样，删除、改权限都交给用户本人 |

```bash
node bin/pdd.js daemon start                      # 后台启动；已运行则返回状态（含 console_url）
node bin/pdd.js daemon status
node bin/pdd.js console link [--account <slug>]   # 一次性链接，10 分钟有效
node bin/pdd.js daemon stop
node bin/pdd.js daemon restart                    # 更新代码后加载新代码；中断进行中的登录
```

- 密码和验证码只由用户本人在控制台输入；聊天中绝不索要密码、登录名或验证码。
- `console link` 的链接含一次性凭证，只原样转给用户本人，不写入文件、日志或其他会话。用户告知完成后再重试原命令，期间无需轮询控制台。
- 同一账号两次自动重登至少间隔 30 分钟，遇到验证或熔断后暂停到用户处理为止；重复执行命令不会加快恢复。
- `account list` 与 `doctor` 显示 `has_password` 和重登状态（如 `可用`、`等待人工：短信验证`、`已熔断：密码错误`），本身不触发重登。
- daemon 需显式启动，不随机器启动；普通命令从不拉起它。

## 环境与数据

- 首次使用：`npx patchright install chromium` → `init` → `doctor`（Node.js >= 24）。
- 账号与加密登录态存在 SQLite（默认 `data/pdd.db`，`PDD_DB_PATH` 覆盖），主密钥 `master.key` 在同目录。两者是敏感文件，保持在仓库之外，备份时一起保存。
- Mock 模式：`PDD_TEST_ADAPTER=fixture` + `PDD_TEST_FIXTURE_DIR=<dir>`，再用临时 `PDD_DB_PATH` 隔离数据库，可在无浏览器、无真实账号时跑通命令。
- 其他环境变量见 `.env.example`。
