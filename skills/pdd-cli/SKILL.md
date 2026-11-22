---
name: pdd-cli
description: 操作拼多多商家后台（pdd CLI）：查订单/商品/推广/经营报表（售后、体验星级、客服、评价、流量、净利润、省级地域分布），录入商品成本，改价/库存/上下架/上货，多账号切换与登录失效处理。
user-invocable: true
metadata:
  openclaw:
    requires:
      bins: [node]
---

# pdd-cli

`pdd` 驱动 Chromium 打开拼多多商家后台，通过页面签名客户端或 XHR 拦截获取数据并输出单行 JSON envelope。纯 Node.js ESM，无构建步骤。

## 调用

已执行 `npm link` 时，在任意目录直接运行 `pdd`，始终加 `--json`（数据、配置与日志自动定位到 `pdd-cli` 仓库目录；未 `npm link` 时在仓库根目录改用 `node bin/pdd.js`）：

```bash
pdd <command> [options] --json
```

全局选项写在子命令前：`--json` / `--timeout <ms>` / `--mall <id>` / `--account <slug>` / `--consumer-account <昵称|手机号|slug>` / `--all-accounts` / `--headed` / `--verbose` / `--no-color`。各命令参数以 `pdd <command> --help` 为准。

## 读取结果

```json
{"ok":true,"command":"orders.list","data":{"headline":["近 7 天共 22 单，本页 20 单"],"items":[],"total":22,"mall_id":"900001"},"error":null,"meta":{"v":2,"exit_code":0,"latency_ms":812,"warnings":[]}}
```

- `ok:false` 时 `error` 含 `code` / `message`，可能带 `hint` / `detail`，`data` 为 `null`。`meta.warnings` 可能带待办事项（如 `account_action_required`、`daemon_not_running`）。
- `data` 恒为对象并含 `headline`；键名 snake_case；金额 `_yuan`（元）；比率 `_pct`（0–100）；时间 `_at`（北京时间 `YYYY-MM-DD HH:mm:ss`）；未知枚举显示 `未知(<code>)`；ID/单号为字符串。
- `--all-accounts` 返回 `{ headline, accounts: { <slug>: { ok, data | error, latency_ms } }, summary }`。

| 退出码 | 含义 | 处理 |
|---|---|---|
| 0 | 成功 | 检查 `meta.warnings`；如有待办按 [operations.md](operations.md) 处理 |
| 1 | 通用错误 | 读 `error.message` 与 `error.hint`（daemon 启停超时、端口占用等） |
| 2 | 参数错误 | 按 `error.message` 修正参数 |
| 3 | 鉴权 | 按 [operations.md](operations.md) 分辨 `error.code` 并引导登录或控制台处理 |
| 4 | 限流 | 连续 3 次 429 触发 5 分钟全局冷却，等待后重试 |
| 5 | 网络 | 含 `E_AUTH_CHECK_INDETERMINATE`（登录态仍可能有效），稍后重试 |
| 6 | 业务错误 | 如店铺无权限或字体混淆拒识，按提示转告用户 |
| 7 | 部分成功 | 逐项检查结果 |

### 转述结果

- 以 `data.headline` 开头；细节用字段中文含义转述；`null` 说「数据不可用」；诊断 `status`（`数据完整` / `数据不完整`）仅陈述完整性，`hints` 与截断标记原样转述。
- 只输出事实数字与口径，把经营判断、评分、保本 ROI 和建议留给用户。
- 转述 `diagnose *`、`goods traffic`、`goods profit`、`goods receipt`、`goods reviews` 前先读 [reports.md](reports.md)。

## 命令

### 鉴权与环境

```bash
pdd init [--qr]              # 首次登录（默认弹浏览器；--qr 终端扫码）
pdd login [--qr|--consumer]  # 重新登录
pdd doctor [--probe xhr]     # 环境与登录态自检
```

### 运行配置

```bash
pdd config show|validate --json
pdd config set <key> <value> --json   # 校验后写入 config/config.json 本地覆盖
pdd config unset <key> --json
```

优先级：`config/config.example.json` 基线 → `config/config.json` → 环境变量 → CLI 参数；秘密与测试开关只走环境变量（`.env.example`）。修改由下次命令加载，运行中的 daemon 需重启。

### 订单与推广

```bash
pdd orders list [--page 1] [--size 20] [--since <unix>] [--until <unix>] [--status all|pending_ship|shipped|received|after_sales]
pdd orders detail --sn <订单号>
pdd orders stats [--size 50]   # 本地样本 P50/P95、退款与售后计数
pdd promo roi [--by plan|sku|channel] [--since YYYY-MM-DD] [--size 50] [--include-inactive]
```

- `orders list` 默认近 7 天全部订单；`pending_ship` / `shipped` / `received` 不含售后中订单；更早待发货以 `orders stats` 为准，`--size` 最大 50。
- 退款状态只看 `after_sales_status`：`退款成功` / `售后处理中` / `null`。

### 商品查询与写操作

```bash
pdd goods list [--page 1] [--size 10] [--status onsale|offline]
pdd goods stock [--threshold 10]                         # 低库存 / 缺货（含 SKU 级）
pdd goods segment [--days 30] [--max-pages 10] [--no-promo]
pdd goods traffic [--days 30] [--goods-id <id>]          # 商品流量、推广拆分与今日实时 today
pdd goods profit [--days 30] [--goods-id <id>]           # 净利润（需先录入成本）
pdd goods receipt [--goods-id <id>] [--caliber regular|all]
pdd goods reviews [--days 30] [--goods-id <id>] [--stars 4,5] [--all|--min-length <n>]
pdd goods templates                                      # 运费模板 ID
pdd goods update status --goods-id <id> --status onsale|offline [--confirm]
pdd goods update price  --goods-id <id> --price-yuan <元> [--sku-id <id>] [--confirm]
pdd goods update stock  --goods-id <id> --quantity <n> [--sku-id <id>] [--confirm]
pdd goods update title  --goods-id <id> --title "<新标题>" [--confirm]
pdd goods update batch  --changes '[{"goods_id":1001,"field":"price_yuan","value":29.9}]' [--confirm]
pdd goods publish --url <链接或goods_id> [--cost-template <id>] [--confirm]
```

- 商品缺少 `goods_id` 时，库存与销量匹配按商品名回退（`matched_by` 显示「按商品名匹配（一侧缺少商品 ID）」）。
- 线上写操作执行顺序：先与用户核对商品 ID、元单位价格（最多两位小数）与目标值 → 无 `--confirm` 预演（`dry_run:true`）并把预演 `headline` 发给用户确认 → 用户明确同意后再带 `--confirm` 执行；完成后核对 `ok:true` 且 `dry_run:false`（`batch` 需逐项检查 `results[].ok`）。`goods publish` 无 `--confirm` 创建草稿，加 `--confirm` 提交发布（先用 `pdd goods templates` 查运费模板）。

### 商品成本

```bash
pdd goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 [--spec <精确规格>] [--technical-service-yuan 0.2] [--confirm]
pdd goods cost list [--goods-id 101]
pdd goods cost import costs.json [--confirm]
pdd goods cost remove --goods-id 101 [--spec <精确规格>] [--confirm]
```

- 本地 SQLite 读写（按账号 + 店铺 + 商品 + 规格隔离，无需在线登录；拒绝 `--all-accounts`；写操作先预演再 `--confirm`）。
- 货本按件、包材/快递/技术服务费按单，单位元（运费险无需录入）；`--spec` 原文精确匹配，未命中回落默认成本。`import` 为 UTF-8 JSON 数组（≤1 MiB / ≤5000 条），含 `insurance_yuan` 整批拒绝：

```json
[
  { "goods_id": "101", "spec": null, "purchase_yuan": "8.20", "packaging_yuan": "0.50", "courier_yuan": "3.00" },
  { "goods_id": "101", "spec": "红色 / 大号", "purchase_yuan": "9.20", "packaging_yuan": "0.50", "courier_yuan": "3.00", "technical_service_yuan": "0.20" }
]
```

### 经营报表

```bash
pdd diagnose shop [--compare] [--days 7]
pdd diagnose orders|inventory|promo
pdd diagnose after-sales [--days 30]
pdd diagnose experience [--days 7]
pdd diagnose customer-service [--days 30]
pdd diagnose reviews [--days 30]
pdd diagnose traffic [--days 30]
```

- `diagnose orders` 另附近 7 天省级成团分布 `regions`；`diagnose customer-service` 支持 1–63 天（逐日趋势最多 31 天）并含 `sales` 与 `today`；`diagnose reviews` 支持 30/60/90/180 天并含固定 30 日 `goods_scores`；`diagnose traffic` 与 `goods traffic` 含 `today`，其中 `goods traffic` 的 `non_promo_*` 为推算差值且推广拆分口径尚未实测。完整口径见 [reports.md](reports.md)。

### 店铺、账号与常驻控制台

```bash
pdd shops list|current
pdd account add|list|default|remove --slug <slug> [--confirm]
pdd daemon start|status|stop|restart|run
pdd console link [--account <slug>]
```

- `account add` 无参数，`account default` / `remove` 用 `--slug <slug>`（`remove` 需 `--confirm` 才实际删除）。`daemon` 默认不自启。

## 登录失效与运维

- **凭证红线**：密码、登录名与验证码只由用户本人在控制台输入，聊天中绝不索要；`console link` 一次性凭证链接只原样转给用户本人，不写入文件、日志或会话。
- **按需查阅 [operations.md](operations.md)**：遇到鉴权 / 主密钥 / 风控 / Chromium 错误码（`E_AUTH_*`、`E_MASTER_KEY_*`、`E_CHROMIUM_MISSING`）、`meta.warnings` 含 `account_action_required` / `daemon_not_running`、或需配置控制台反代、自动巡航、日志路径、青果代理与 fixture Mock 模式时先读。
