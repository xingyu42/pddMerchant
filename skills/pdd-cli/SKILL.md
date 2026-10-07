---
name: pdd-cli
description: 通过 pdd CLI 操作拼多多商家后台 — 订单/商品/推广/诊断/上货/多账号/运行配置，输出统一 envelope JSON 供 AI 消费
user-invocable: true
metadata:
  openclaw:
    requires:
      bins: [node]
---

# pdd-cli — 拼多多商家后台自动化

`pdd` 是一个基于 Patchright 的拼多多商家后台 CLI。它驱动 Chromium、拦截后台 XHR 响应，把结果封装成稳定的 **envelope 契约** 输出，专为脚本 / AI 消费设计。纯 JavaScript（Node.js ESM），无构建步骤。

## 何时使用本 skill

当任务涉及以下任一项时激活：

- 查询/统计拼多多**订单**（列表、详情、P50/P95 时效）
- 管理**商品**（列表、库存告警、销量与库存统计、上下架、改价改库存改标题、批量编辑、从链接上货）
- 拉取**推广报表**与 ROI 统计
- 查询**店铺数据统计**（订单 / 库存 / 推广 / 漏斗维度）
- **多账号 / 多店铺**切换与批量执行
- 查看、校验和修改项目内**运行配置**
- 鉴权（首次登录 / 重新登录 / 环境自检 / 后台自动续期）

## 调用方式

在项目根目录下运行。入口 bin 名为 `pdd`：

```bash
# 未全局 link 时的规范调用
node bin/pdd.js <command> [options]

# 若已 npm link / 全局安装
pdd <command> [options]
```

**AI / 脚本消费必须加 `--json`**，得到单行 JSON envelope，便于解析：

```bash
node bin/pdd.js orders list --json
```

## 输出契约（envelope）

所有命令输出统一结构，这是**神圣契约**，字段稳定（输出契约 v2，`meta.v: 2`）：

```json
{
  "ok": true,
  "command": "orders.list",
  "data": { "headline": ["近 7 天共 22 单，本页 20 单", "本页状态：已发货，待收货 20 单"], "items": [], "total": 22, "mall_id": "900001" },
  "error": null,
  "meta": { "v": 2, "exit_code": 0, "latency_ms": 812, "xhr_count": 1, "warnings": [] }
}
```

- `ok` — 布尔，是否成功
- `command` — 命令标识（如 `goods.update.price`）
- `data` — 成功时的业务数据，**恒为对象**，必含 `headline`
- `error` — 失败时的错误对象（`ok:false` 时非空，`data` 为 `null`）
- `meta` — 仅技术元信息（版本、退出码、耗时、警告等）；只有 `meta.warnings` 允许增长；业务上下文（`total`、`mall_id` 等）在 `data` 里

### data 字段约定（v2）

- **`headline`**：1–3 句中文事实陈述（数量、状态、数据缺失），不含建议或好坏判断。
- **列表命令**：`{ headline, items: [...], total, ... }`（如 `orders list`、`goods list/stock/templates`、`promo roi`、`shops list`、`account list`）。
- **键名** 全部 snake_case；**金额** 单位为元、后缀 `_yuan`（如 `paid_amount_yuan: 29.9`）；**比率** 为 0-100 的百分数、后缀 `_pct`（如 `refund_rate_pct: 3.12`）；**ROI** 为倍数 `roi`；**时间** `_at` 为 `YYYY-MM-DD HH:mm:ss`（北京时间），日期为 `YYYY-MM-DD`；时长 `_hours`。
- **枚举** 一律是中文标签（如订单 `status: "已发货，待收货"`、诊断 `status: "数据完整"`）；无法识别的码显示为 `未知(<code>)`。
- **缺失** 为 `null`，不是 0；分母为 0 的比率也是 `null`。
- **标识**（`goods_id`、`mall_id`、`order_sn`）为字符串。
- 不含上游原始对象，也不含收件人姓名 / 电话 / 地址。
- 批量（`--all-accounts`）：`data = { headline, accounts: { <slug>: { ok, data | error, latency_ms } }, summary }`，每个账号的 `data` 即该命令自身的 v2 data。

**向用户转述时优先使用 `data.headline`；需要细节时再引用字段的中文含义，不要复述键名**（例如说「实付 23.50 元」，不要说「paid_amount_yuan 是 23.5」）。

**8 个退出码**（据此判断结果，勿只看 stdout）：

| 码 | 含义 | 码 | 含义 |
|----|------|----|------|
| 0 | OK 成功 | 4 | RATE_LIMIT 限流 |
| 1 | GENERAL 通用错误 | 5 | NETWORK 网络 |
| 2 | USAGE 用法/参数错误 | 6 | BUSINESS 业务错误 |
| 3 | AUTH 鉴权失效 | 7 | PARTIAL 部分成功 |

退出码 `3`（AUTH）→ 提示用户重新登录（`node bin/pdd.js login`）。退出码 `4`（RATE_LIMIT）→ 3 连 429 触发 5 分钟全局冷却，需等待后重试。

## 全局选项（放在子命令前）

| 选项 | 说明 |
|------|------|
| `--json` | 单行 JSON 输出（AI/脚本必加） |
| `--no-color` | 禁用彩色 |
| `--timeout <ms>` | 全局超时（毫秒） |
| `--mall <id>` | 指定店铺 ID（默认用当前） |
| `--headed` | 有头浏览器（调试用） |
| `--verbose` | 启用 debug 日志 |
| `--account <slug>` | 指定账号（多账号模式） |
| `--consumer-account <ref>` | 指定消费者账号（昵称、手机号或存储 slug） |
| `--all-accounts` | 对所有注册账号执行 |

## 命令参考

### ⚙️ 鉴权与环境（顶层）

```bash
node bin/pdd.js init [--qr]                 # 首次交互式登录（默认弹浏览器；--qr 无头扫码）
node bin/pdd.js login [--qr|--consumer]  # 重新登录刷新 auth-state
node bin/pdd.js doctor [--probe xhr]        # 环境自检（Chromium / auth-state / 登录态）
```

### 🛠️ 运行配置 config

```bash
node bin/pdd.js config show --json                  # 查看有效配置、本地覆盖和字段来源
node bin/pdd.js config set rateLimitQps 4 --json   # 校验后写入本地稀疏覆盖
node bin/pdd.js config unset rateLimitQps --json   # 删除本地覆盖并回退到高优先级环境变量或基线
node bin/pdd.js config validate --json              # 分层校验；配置损坏时仍可执行
```

配置优先级为：`config/config.example.json` 基线 → 可选的稀疏 `config/config.json` → 映射环境变量 → 显式 CLI 参数。

- `config set <key> <value>` 先按公开字段 Schema 校验；`config/config.json` 不存在时会原子创建，只保存本地覆盖项。字段或值非法时不会创建或覆盖文件。
- `config unset <key>` 只删除本地覆盖；文件或字段不存在时是稳定 no-op，不会创建空文件。
- config 命令不接受或显示 AuthKey、主密码、代理 token 等秘密字段；修改后由下一次命令加载。

### 📦 订单 orders

```bash
node bin/pdd.js orders list --page 1 --size 20 [--since <unix>] [--until <unix>] [--status all|pending_ship|shipped|received|after_sales]
node bin/pdd.js orders detail --sn <订单号/shipping_id>
node bin/pdd.js orders stats --size 50      # 远程 + 本地聚合 P50/P95
```

- `orders list` 默认 `--status all`：返回全部订单（待发货、已发货待收货、已收货、售后中、退款成功、已取消）。`pending_ship` 待发货、`shipped` 已发货待收货、`received` 已收货（这三项不含售后中的订单）、`after_sales` 售后处理中；其他取值以退出码 2 拒绝。时间窗默认近 7 天（按成团时间），更早的待发货订单不会出现在列表中，待发货总数以 `orders stats` 为准。`--size` 取 100 会被上游拒绝，50 可用。
- 订单 `after_sales_status`：`退款成功` / `售后处理中` / `null`（无售后）/ `未知(<code>)`。
- 退款统计只依据 `after_sales_status`：`orders stats` 本地样本给出 `refund_count`（退款成功）、`after_sales_count`（售后处理中）与 `refund_rate_pct`。若上游订单缺少售后状态字段，这三项及 `diagnose funnel` 的 `refund_count` / `refund_rate_pct` / `fulfillment_rate_pct` 均为 `null`，headline 写「退款数据不可用」——这不是 0。
- `diagnose inventory` / `goods segment` 的销量统计计入待发货、已发货、已收货订单，不计退款、售后中与已取消订单；`diagnose orders/shop/funnel` 的退款统计使用全部订单。

### 🛍️ 商品 goods

**读操作：**
```bash
node bin/pdd.js goods list --page 1 --size 10 --status onsale|offline
node bin/pdd.js goods stock --threshold 10  # 低库存/缺货告警
node bin/pdd.js goods segment --days 30 --size 50 --max-pages 10 [--no-promo]  # 商品销量与库存统计
```

**写操作（`goods update` 子组，默认 dry-run，须 `--confirm` 才真正执行）：**
```bash
node bin/pdd.js goods update status --goods-id <id> --status onsale|offline --confirm
node bin/pdd.js goods update price  --goods-id <id> --price-yuan <元> [--sku-id <id>] --confirm
node bin/pdd.js goods update stock  --goods-id <id> --quantity <n> [--sku-id <id>] --confirm
node bin/pdd.js goods update title  --goods-id <id> --title "<新标题>" --confirm
node bin/pdd.js goods update batch  --changes '[{"goods_id":1001,"field":"price_yuan","value":29.9}]' --confirm
# batch field 取值：status | price_yuan | stock | title；价格 value 单位为元
```

**上货与运费模板：**
```bash
node bin/pdd.js goods templates            # 先查运费模板 ID
node bin/pdd.js goods publish --url <链接或纯数字goods_id> [--cost-template <id>] [--confirm]
# 默认仅创建草稿；--confirm 直接提交发布
```

> ⚠️ 所有 `goods update` 和 `goods publish --confirm` 属**写操作**，会改动线上商品。执行前须向用户确认 `--goods-id`、`--price-yuan`（单位为**元**，最多 2 位小数，例如 `29.9`）等参数无误。旧的分单位参数 `--price` 已移除，使用会以退出码 2 拒绝；batch 的 `field: "price"` 同样被拒绝。
>
> 写操作回显：`{ headline, goods_id, field, value, sku_id?, dry_run, result?: { success, failed_count }, mall_id }`（`field` 为 `status|price_yuan|stock|title`；价格回显为元，上下架回显为「上架 / 下架」）；预演 headline 形如「预演：商品 101 价格将改为 29.90 元，未提交」。batch 预演为 `{ headline, planned[], count, dry_run, mall_id }`，提交后为 `{ headline, succeeded, failed, results[{ goods_id, field, ok, error_code?, message? }], dry_run, mall_id }`。

### 🚀 推广 promo

```bash
node bin/pdd.js promo roi --by plan|sku|channel [--since YYYY-MM-DD] [--page 1] [--size 50] [--include-inactive]  # ROI 统计
```

### 🩺 诊断 diagnose

```bash
node bin/pdd.js diagnose shop [--compare] [--days 7]   # 四维数据汇总与数值环比
node bin/pdd.js diagnose orders                        # 订单维度（P95/退款/堆积）
node bin/pdd.js diagnose inventory                     # 库存维度（缺货/低库存）
node bin/pdd.js diagnose promo                         # 推广维度（ROI/CTR）
node bin/pdd.js diagnose funnel [--days 30]            # 漏斗维度（退款率/履约率）
```

这些查询不生成经营建议、健康评分、商品等级或推广优劣分类。`action plan` 和 `--break-even` 已移除。诊断的 `status`（`数据完整` / `数据不完整`）只表示数据完整性，不代表经营好坏；缺失数值保留为 `null`，不能当成零。环比窗口为 `{ start_date, end_date, days }`；`_pct` 指标的 `delta` 是百分点、`delta_pct` 是相对变化率；当前库存和待发货快照不做历史对比（`note: "仅有当前快照，无上期数据"`）。

### 🏬 店铺 shops

```bash
node bin/pdd.js shops list      # 当前账号下所有店铺
node bin/pdd.js shops current   # 当前店铺
```

### 👤 多账号 account

```bash
node bin/pdd.js account add                              # 添加账号（有头浏览器登录+自动注册）
node bin/pdd.js account list                             # 列出所有账号
node bin/pdd.js account default --slug <slug>            # 设默认账号
node bin/pdd.js account remove --slug <slug> [--remove-files]
```

### 按需认证检查

登录、普通命令及 doctor 独立检查商家认证，成功命令只回写重新验证通过的冻结材料。认证后台和 daemon 命令已移除；闲置时不运行定时任务。网络无法判定（退出码 5）不代表登录失效，明确失效（退出码 3）才提示重新登录。

## 典型工作流

**首次上手：**
```bash
npx patchright install chromium   # 装 Chromium（仅一次）
node bin/pdd.js init              # 登录
node bin/pdd.js doctor            # 确认环境就绪
```

**店铺数据查询：**
```bash
node bin/pdd.js diagnose shop --compare --json   # 查看指标与环比
node bin/pdd.js goods segment --json             # 查看销量与库存
node bin/pdd.js promo roi --json                 # 查看推广投入和产出
```

**从竞品链接上货：**
```bash
node bin/pdd.js goods templates --json           # 取运费模板 ID
node bin/pdd.js goods publish --url <链接> --cost-template <id> --json        # 先建草稿
node bin/pdd.js goods publish --url <链接> --cost-template <id> --confirm --json  # 确认后发布
```

## 关键环境变量

| 变量 | 用途 |
|------|------|
| `PDD_TEST_ADAPTER=fixture` | Mock 模式（跳过真实浏览器，测试用） |
| `PDD_TEST_FIXTURE_DIR=<path>` | fixture 数据目录 |
| `PDD_AUTH_STATE_PATH=<path>` | 显式覆盖商家 auth-state；无注册表时使用 `data/merchant/stores/default/auth-state.json`，注册后使用 registry 中的 slug |
| `PDD_CONSUMER_AUTH_STATE_PATH=<path>` | 显式覆盖消费者 auth-state；无注册表时使用 `data/consumer/accounts/default/auth-state.json`，注册后使用 registry 中的 slug |
| `PDD_ACCOUNTS_DIR` / `PDD_ACCOUNT_REGISTRY_PATH` | 覆盖商家店铺目录与注册表 |
| `PDD_CONSUMER_ACCOUNTS_DIR` / `PDD_CONSUMER_ACCOUNT_REGISTRY_PATH` | 覆盖消费者账号目录与注册表 |
| （固定）`log/cli/` | CLI 日志按本地日轮转；引导阶段写 stderr；路径不可配置 |
| `PDD_ALLOW_INSECURE_AUTH_STATE=1` | POSIX 权限设为 0600 失败时仍继续（不推荐） |
| `PDD_CONSUMER_LOGIN_URL=<url>` | 覆盖消费者端登录页地址 |
| `PDD_MALL_ID_STRICT_PARSE=0` | 放宽 mall ID 到 64 字符（默认 1-15 位数字） |
| `PDD_SCRAPE_SIMULATE=0` | 关闭抓取时的人类行为模拟（默认开启） |
| `PDD_SCRAPE_SOFTBLOCK_THRESHOLD` | IP 软封连续命中阈值进入冷却（默认 2） |
| `PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS` | IP 软封冷却时长 ms（默认 2h） |

## 注意事项

- **AI 消费一律加 `--json`**，并结合退出码判断成败，勿只解析文本。
- **写操作默认 dry-run**：`goods update *` 不加 `--confirm` 只预演，不改线上数据；确认参数后再加 `--confirm`。
- **价格单位是元**：`--price-yuan 29.9` 表示 29.90 元（上游仍以分提交，CLI 精确换算）；输出中的金额字段（`*_yuan`）同为元。
- **鉴权失效（退出码 3）** → 重新 `login`。**限流（退出码 4）** → 等待冷却后重试。
- `--consumer-account` 的昵称或手机号仅用于注册表查找；登录态实际落盘目录名是 registry 中的安全 slug。
- 本地运行差异优先用 `config set` 写入稀疏 `config/config.json`；秘密、安全和测试开关仍只通过环境变量注入。
- 商品缺少 `goods_id` 时，库存 / 销量匹配会回退到商品名，`matched_by` 显示为「按商品名匹配（一侧缺少商品 ID）」，属正常兼容结果。
- Mock 模式：设 `PDD_TEST_ADAPTER=fixture` + `PDD_TEST_FIXTURE_DIR=<dir>` 可在无浏览器/无真实账号下跑通命令，适合演示与调试。
- 敏感字段（cookie、authorization、anti_content、手机号、地址等）在日志中自动 SHA256 脱敏。
