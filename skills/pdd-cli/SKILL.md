---
name: pdd-cli
description: 操作拼多多商家后台（pdd CLI）：查订单与售后单/退款原因、商品与库存、推广 ROI、经营报表（体验星级、客服、评价、流量、省级地域分布），录入成本并核算净利润，改价/库存/上下架/上货等写操作，运行配置，多账号切换与登录失效处理。
user-invocable: true
metadata:
  openclaw:
    requires:
      bins: [node]
---

# pdd-cli

`pdd` 驱动 Chromium 打开拼多多商家后台，通过页面签名客户端或 XHR 拦截获取数据并输出单行 JSON envelope。纯 Node.js ESM，无构建步骤。

## 调用

已执行 `npm link` 时在任意目录运行 `pdd`；否则在仓库根目录改用 `node bin/pdd.js`。始终加 `--json`：

```bash
pdd <command> [options] --json
```

全局选项写在子命令前：`--json` / `--timeout <ms>` / `--mall <id>` / `--account <slug>` / `--consumer-account <昵称|手机号|slug>` / `--all-accounts` / `--headed` / `--verbose` / `--no-color`。各命令参数以 `pdd <command> --help` 为准；数据、配置与文件参数的路径基准见 [operations.md](operations.md)。

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
- 转述 `diagnose *`、`orders stats`、`orders after-sales`、`orders detail`、`goods list`、`goods segment`、`goods traffic`、`goods profit`、`goods receipt`、`goods reviews` 前先读 [reports.md](reports.md)，按其中口径与必附说明转述。

## 命令

### 鉴权与环境

```bash
pdd login [--qr|--consumer]  # 登录或刷新登录态（默认弹浏览器；--qr 终端扫码）
pdd doctor                   # 环境与登录态自检
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
pdd orders detail --sn <订单号> [--with-track]
pdd orders stats [--size 50] [--with-regions]   # 本地样本 P50/P95、退款与售后计数；--with-regions 附带省级成团分布
pdd orders after-sales [--days 30|--since <date|unix> [--until <date|unix>]] [--sn <订单号>|--goods-id <id>] [--status all|open|refunded|closed] [--type all|refund|return_refund|exchange|resend|repair] [--with-delivery [--max-track-fetches <n>]]
pdd promo roi [--by plan|sku|channel] [--since YYYY-MM-DD] [--size 50] [--include-inactive]
```

- `orders list` 默认近 7 天全部订单；`pending_ship` / `shipped` / `received` 不含售后中订单；更早待发货以 `orders stats` 为准，`--size` 最大 50。
- 订单级售后状态见 `order.after_sales_status`（列表在 `items[]` 内）：`退款成功` / `售后处理中` / `null`，未登记码显示 `未知(<code>)`。
- `orders detail` 有售后标识时附该单售后单列表 `after_sales_cases[]`，加 `--with-track` 时附带正向快递与关联售后逆向轨迹及收货/退货耗时；`orders after-sales` 按申请时间查售后单并汇总退款原因分布，加 `--with-delivery` 时补查正向妥投并计算收货到发起退货耗时。口径见 [订单详情](reports.md#orders-detail) 与 [售后单](reports.md#orders-after-sales)。

### 商品查询与写操作

```bash
pdd goods list [--page 1] [--size 10] [--status onsale|offline] [--with-skus] [--low-stock [threshold]]
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

- `goods list` 默认省略 `skus` 键（适合 `--size 50` 扫目录），加 `--with-skus` 单次请求展开 5 字段 `skus[]`（含 `sku_id`、`spec`、`out_sku_sn`、`quantity`、`on_sale`）；`origin_price_*` 为日常拼单价、`sold_quantity` / `sold_quantity_30d` 为商品列表口径销量，口径见 [reports.md](reports.md#goods-list)。
- 商品缺少 `goods_id` 时，库存与销量匹配按商品名回退（`matched_by` 显示「按商品名匹配（一侧缺少商品 ID）」）。
- **线上写操作确认顺序**（每一步完成才进入下一步）：
  1. 与用户核对商品 ID、元单位价格（最多两位小数）与目标值。
  2. 不带 `--confirm` 预演，确认返回 `dry_run:true`，把预演 `headline` 发给用户。
  3. 用户明确同意后再带 `--confirm` 执行。
  4. 完成标准：`ok:true` 且 `dry_run:false`；`batch` 逐项检查 `results[].ok`。
- `goods publish` 不带 `--confirm` 创建草稿，带 `--confirm` 提交发布；先用 `pdd goods templates` 查运费模板。

### 商品成本

```bash
pdd goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 [--spec <精确规格>] [--technical-service-yuan 0.2] [--confirm]
pdd goods cost list [--goods-id 101]
pdd goods cost import costs.json [--confirm]
pdd goods cost remove --goods-id 101 [--spec <精确规格>] [--confirm]
```

- 本地 SQLite 读写，按账号 + 店铺 + 商品 + 规格隔离，无需在线登录；拒绝 `--all-accounts`；写操作同样先预演再 `--confirm`。
- 货本按件，包材/快递/技术服务费按单，单位元；运费险由平台逐单报告，无需录入。`--spec` 原文精确匹配，未命中回落默认成本。
- `import` 为 UTF-8 JSON 数组（≤1 MiB / ≤5000 条），含 `insurance_yuan` 时整批拒绝：

```json
[
  { "goods_id": "101", "spec": null, "purchase_yuan": "8.20", "packaging_yuan": "0.50", "courier_yuan": "3.00" },
  { "goods_id": "101", "spec": "红色 / 大号", "purchase_yuan": "9.20", "packaging_yuan": "0.50", "courier_yuan": "3.00", "technical_service_yuan": "0.20" }
]
```

### 经营报表

```bash
pdd diagnose shop [--compare] [--days 7]
pdd diagnose experience [--days 7]
pdd diagnose customer-service [--days 30]
pdd diagnose reviews [--days 30]
pdd diagnose traffic [--days 30]
```

附加区块速览：`orders stats --with-regions` 含省级成团分布 `regions`；`diagnose customer-service` 含 `sales` 与 `today`；`diagnose reviews` 含近 30 日 `goods_scores`；`diagnose traffic` 含 `today`。各命令天数范围与口径见 [reports.md](reports.md)。

### 店铺、账号与常驻控制台

```bash
pdd shops list
pdd account list|default|remove --slug <slug> [--confirm]
pdd daemon start|status|stop|restart|run|link [--account <slug>]
```

- `account default` / `remove` 用 `--slug <slug>`，`remove` 带 `--confirm` 才实际删除；新增商家账号直接执行 `pdd login`。
- `daemon` 需显式启动，`daemon link` 生成一次性控制台访问链接，配置与巡航见 [operations.md](operations.md)。

## 登录失效与运维

- **凭证红线**：密码、登录名与验证码只由用户本人在控制台输入，聊天中绝不索要。`daemon link` 返回的一次性凭证链接只原样转给用户本人，不写入文件、日志或其他会话。
- **遇到以下情况先读 [operations.md](operations.md)**：退出码 `3` / `5`；错误码 `E_AUTH_*`、`E_MASTER_KEY_*`、`E_SECRET_DECRYPT_FAILED`、`E_PASSWORD_LOGIN_FORM_CHANGED`、`E_DAEMON_NOT_RUNNING`、`E_CHROMIUM_MISSING`；`meta.warnings` 含 `account_action_required` / `daemon_not_running`；命令挂起或疑似风控；配置控制台反代、自动巡航、日志路径、上货代理或 fixture Mock 模式。
