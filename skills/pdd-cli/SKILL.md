---
name: pdd-cli
description: 通过 pdd CLI 操作拼多多商家后台，查询订单/商品/推广/诊断、录入成本与查净利润、上货/多账号/运行配置，输出统一 envelope JSON 供 AI 消费
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
- 录入本地**商品成本**，查询窗口内**商品净利润**
- 拉取**推广报表**与 ROI 统计
- 查询**店铺数据统计**（订单 / 库存 / 推广 / 售后维度）
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
- **利润率例外**：`gross_margin_pct/net_margin_pct` 为有符号百分数，可负、可超过 ±100，保持原值；零收入时 null。
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

退出码 `3`（AUTH）→ 先看 `error.code`：`E_AUTH_HUMAN_REQUIRED` / `E_AUTH_RELOGIN_BLOCKED` 按下文「密码自动重登」处理，其余提示用户重新登录（`node bin/pdd.js login`）。退出码 `4`（RATE_LIMIT）→ 3 连 429 触发 5 分钟全局冷却，需等待后重试。

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
- 退款统计只依据 `after_sales_status`：`orders stats` 本地样本给出 `refund_count`（退款成功）、`after_sales_count`（售后处理中）与 `refund_rate_pct`。若上游订单缺少售后状态字段，计数和占比保留 `null`，headline 说明数据不可用。
- `diagnose inventory` / `goods segment` 的销量统计计入待发货、已发货、已收货订单，不计退款、售后中与已取消订单；`diagnose orders/shop/after-sales` 的售后统计使用全部订单。

### 🛍️ 商品 goods

**读操作：**
```bash
node bin/pdd.js goods list --page 1 --size 10 --status onsale|offline
node bin/pdd.js goods stock --threshold 10  # 低库存/缺货告警
node bin/pdd.js goods segment --days 30 --size 50 --max-pages 10 [--no-promo]  # 商品销量与库存统计
node bin/pdd.js goods profit --days 30 [--goods-id <id>] --json
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

### 本地商品成本与净利润

```bash
node bin/pdd.js goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 [--spec <精确规格>] [--insurance-yuan 0.3] [--technical-service-yuan 0.2] [--confirm] --json
node bin/pdd.js goods cost list [--goods-id 101] --json
node bin/pdd.js goods cost import costs.json [--confirm] --json
node bin/pdd.js goods cost remove --goods-id 101 [--spec <精确规格>] [--confirm] --json
```

- 成本命令仅操作本地 SQLite，需要已登记商家账号（`--account`），无需在线登录、浏览器或 daemon；`--mall`/配置默认店铺优先，否则账号绑定店铺，始终核对输出 mall_id。成本按账号+店铺+商品+规格隔离，删除账号级联清理。四个成本命令均拒绝 `--all-accounts`，写命令缺 confirm 仅预演。
- 货本按件，其余费用按单；金额为元，允许 0，最多两位小数。set 整条替换，省略运费险/技术服务费归零。spec 原文精确匹配，未命中回落默认；remove 缺 spec 仅删除默认行。
- import 仅 UTF-8 JSON 数组（BOM 可用，1 MiB / 5000 条上限）；每条字段为 `goods_id`（推荐字符串）、可选 spec、必填 purchase_yuan/packaging_yuan/courier_yuan、可选 insurance_yuan/technical_service_yuan。完整模板见 README「商品成本与净利润」。未知列及重复商品/规格键导致整批拒绝；exit 2 / E_COST_IMPORT_INVALID 的 row_errors 按记录序号从 1 定位，语法错误 row:null。
- list/import 返回 items/total，set 返回 entry，remove 返回 matched_count/removed_count；写命令含 dry_run，记录含 updated_at。一次导入全成功或全回滚。
- profit 默认 30 天，days 仅整数 1–90；按 group_time（成团时间）统计上海完整自然日、不含当天、end_at 排他。goods-id 只筛 items，summary 保持全店；收入=实付+平台优惠，退款成功按货退回处理，已发货扣全部按单费用，未发货为 0，发货时间缺失使相关退款费用为 null；未付款取消收入与成本为 0，10/11 售后处理中正常计入并单列单数及收入。
- gross_profit_yuan 扣商家成本，net_profit_yuan 再扣推广；相应 gross_margin_pct/net_margin_pct 允许负值及超过 ±100。推广**仅含商品推广报表口径**，商品按 goodsId 归属，summary.promo_spend_yuan 取 totals.spend，shop_promo_spend_yuan 为未归属差额且只影响 summary；负差额为 null/hint，已知总计仍保留。
- 缺成本或推广失败利润为 null，完整拉取无商品推广记录时花费为 0；订单截断/限流时窗口财务 null，保留 observed_order_count/observed_revenue_yuan，读取 summary.data_quality/hints。cost_updated_at 为实际使用成本的最大更新时间，default_fallback_order_count 为规格回落单数；当前成本更新会重算历史窗口。
- 免费后台缺少商家成本、准确退款金额/货物退回明细、补贴共担比例。转述结果时保留两项高估说明：仅退款不退货、商家共担平台补贴；以及“仅含商品推广报表口径”。只转述事实数字与数据可得性，省去保本 ROI、盈亏分类和经营建议。

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
node bin/pdd.js diagnose after-sales [--days 30]       # 售后维度（退款成功/售后处理中）
```

售后维度键为 `after_sales`，`detail` 包含 `total_orders`、`refund_count`、`refund_rate_pct`、`after_sales_count`、`after_sales_rate_pct`、`status_distribution`、`window_days`。其中 `after_sales_count` 只计售后处理中订单，两类占比均以采集到的全部订单数为分母；空样本占比为 `null`。店铺汇总默认使用近 7 天首批 50 条订单，单独售后查询默认近 30 天分页采集，并保留截断及限流提示。旧 `diagnose funnel` 命令和 `fulfillment_rate_pct` 字段已移除。

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
node bin/pdd.js account remove --slug <slug>             # 级联删除账号及关联数据
```

### 按需认证检查

登录、普通命令及 doctor 独立检查商家认证，成功命令只回写重新验证通过的冻结材料。普通命令从不自动拉起后台进程；需要人工处理时由显式启动的 `pdd daemon` 托管控制台（见下节）。网络无法判定（退出码 5）不代表登录失效，明确失效（退出码 3）才提示重新登录。

### 密码自动重登

账号保存了密码时，普通命令发现商家登录态失效会在同一条命令内自动用账密重登一次，成功则命令照常完成。密码只能由用户本人在控制台录入。

| 看到 | 处理 |
|------|------|
| `error.code = E_AUTH_HUMAN_REQUIRED`（登录遇到短信、滑块等验证） | 执行 `node bin/pdd.js console link`，把链接转给用户，由用户本人完成验证 |
| `meta.warnings` 中有 `{ code: 'daemon_not_running' }`，或 `console link` 返回 `E_DAEMON_NOT_RUNNING` | 先执行 `node bin/pdd.js daemon start`，再执行 `console link` |
| `meta.warnings` 中有 `{ code: 'account_action_required', account, reason }` | 同上，对 `account` 指明的账号执行 `console link` 并把链接转给用户；命令本身可能已经成功 |
| `error.code = E_AUTH_RELOGIN_BLOCKED`（密码错误、账号被锁或接管多次超时，已熔断） | 执行 `console link` 让用户重设密码或解除熔断；用户无法处理时改用 `node bin/pdd.js login --qr` 扫码登录 |
| `error.code = E_PASSWORD_LOGIN_FORM_CHANGED` | 改用 `login --qr` 扫码登录，并告知用户登录页已变化 |
| `error.code = E_AUTH_RELOGIN_FAILED`，或 `error.detail.relogin = 'throttled'` | 自动重登暂不可用；稍后重试，或提示用户执行 `login` |

- **任何情况下都不要在聊天中向用户索要密码或登录名**，也不要尝试替用户输入验证码。
- 同一账号两次自动重登至少间隔 30 分钟（`PDD_PASSWORD_RELOGIN_MIN_INTERVAL_MS`），遇到验证或熔断后会暂停，直到用户处理；反复重试命令不会加快恢复。
- `account list` 和 `doctor` 的 `has_password` / `password_relogin_status`（doctor 为 `password_relogin.status`）显示是否保存了密码及当前状态，如 `可用`、`等待人工：短信验证`、`已熔断：密码错误`；这两个命令本身不会触发重登。

### daemon 与控制台

```bash
node bin/pdd.js daemon start                 # 后台启动；已运行则直接返回状态（含 console_url）
node bin/pdd.js daemon status                # running / heartbeat_at / last_patrol_at / patrol_enabled
node bin/pdd.js console link [--account <slug>]   # 一次性链接，10 分钟有效；data.url 原样转给用户
node bin/pdd.js daemon stop
```

- `console link` 输出的链接含一次性凭证：只转发给用户本人，不要写入文件、日志或其他会话。
- 用户在控制台中录入密码、过验证、扫码；你只需等待用户告知完成，再重试原命令。不要轮询或代替用户操作控制台。
- daemon 不随机器启动；看到 `daemon_not_running` 时启动它即可，平时不必常开。

## 典型工作流

**首次上手：**
运行环境要求 Node.js >= 24。

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
| `PDD_DB_PATH=<path>` | 商家/消费者账号及加密登录态的 SQLite 数据库，默认 `data/pdd.db`；主密钥 `master.key` 自动生成在数据库同目录（默认 `data/master.key`） |
| （固定）`log/cli/` | CLI 日志按本地日轮转；引导阶段写 stderr；路径不可配置 |
| `PDD_CONSUMER_LOGIN_URL=<url>` | 覆盖消费者端登录页地址 |
| `PDD_MALL_ID_STRICT_PARSE=0` | 放宽 mall ID 到 64 字符（默认 1-15 位数字） |
| `PDD_SCRAPE_SIMULATE=0` | 关闭抓取时的人类行为模拟（默认开启） |
| `PDD_SCRAPE_SOFTBLOCK_THRESHOLD` | IP 软封连续命中阈值进入冷却（默认 2） |
| `PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS` | IP 软封冷却时长 ms（默认 2h） |

## 注意事项

- **AI 消费一律加 `--json`**，并结合退出码判断成败，勿只解析文本。
- **写操作默认 dry-run**：`goods update *` 不加 `--confirm` 只预演，不改线上数据；确认参数后再加 `--confirm`。
- **价格单位是元**：`--price-yuan 29.9` 表示 29.90 元（上游仍以分提交，CLI 精确换算）；输出中的金额字段（`*_yuan`）同为元。
- **鉴权失效（退出码 3）** → 按「密码自动重登」一节分辨错误码；需要人工时用 `console link` 转给用户，其余重新 `login`。**限流（退出码 4）** → 等待冷却后重试。
- `--consumer-account` 的昵称、手机号或 slug 用于数据库账号查找；登录态按账号 ID 加密保存，使用时在内存中解密。
- 数据库和同目录的主密钥均为敏感文件，勿提交，须一起备份与恢复。并发认证更新使用账号租约与 revision CAS（仅在修订号匹配时提交）。升级后需重新登录所有商家和消费者账号；旧版 JSON 数据保留原样，`doctor` 检测到时给出提示。
- 本地运行差异优先用 `config set` 写入稀疏 `config/config.json`；秘密、安全和测试开关仍只通过环境变量注入。
- 商品缺少 `goods_id` 时，库存 / 销量匹配会回退到商品名，`matched_by` 显示为「按商品名匹配（一侧缺少商品 ID）」，属正常兼容结果。
- Mock 模式：设 `PDD_TEST_ADAPTER=fixture` + `PDD_TEST_FIXTURE_DIR=<dir>`，并用临时 `PDD_DB_PATH` 隔离数据库与密钥，可在无浏览器/无真实账号下跑通命令，适合演示与调试。
- 敏感字段（cookie、authorization、anti_content、手机号、地址等）在日志中自动 SHA256 脱敏；密码、登录名和主密钥一律输出 `[REDACTED]`。
