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

所有命令输出统一结构，这是**神圣契约**，字段稳定：

```json
{ "ok": true, "command": "orders.list", "data": {}, "error": null, "meta": {} }
```

- `ok` — 布尔，是否成功
- `command` — 命令标识（如 `goods.update.price`）
- `data` — 成功时的业务数据
- `error` — 失败时的错误对象（`ok:false` 时非空）
- `meta` — 元信息；只有 `meta.warnings` 允许增长

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
- config 命令不接受或显示 AuthKey、主密码、代理 token 等秘密字段，也不会自动重启 daemon。

### 📦 订单 orders

```bash
node bin/pdd.js orders list --page 1 --size 20 [--since <unix>] [--until <unix>]
node bin/pdd.js orders detail --sn <订单号/shipping_id>
node bin/pdd.js orders stats --size 50      # 远程 + 本地聚合 P50/P95
```

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
node bin/pdd.js goods update price  --goods-id <id> --price <分> [--sku-id <id>] --confirm
node bin/pdd.js goods update stock  --goods-id <id> --quantity <n> [--sku-id <id>] --confirm
node bin/pdd.js goods update title  --goods-id <id> --title "<新标题>" --confirm
node bin/pdd.js goods update batch  --changes '[{"goods_id":1001,"field":"price","value":2999}]' --confirm
```

**上货与运费模板：**
```bash
node bin/pdd.js goods templates            # 先查运费模板 ID
node bin/pdd.js goods publish --url <链接或纯数字goods_id> [--cost-template <id>] [--confirm]
# 默认仅创建草稿；--confirm 直接提交发布
```

> ⚠️ 所有 `goods update` 和 `goods publish --confirm` 属**写操作**，会改动线上商品。执行前须向用户确认 `--goods-id`、`--price`（单位为**分**）等参数无误。价格 2999 = 29.99 元。

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

这些查询不生成经营建议、健康评分、商品等级或推广优劣分类。`action plan` 和 `--break-even` 已移除。诊断的 `full` / `partial` 只表示数据完整性，不代表经营好坏；缺失数值保留为 `null`，不能当成零。环比不把当前库存和待发货快照当成历史数据。

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

### 🔄 后台续期 daemon

```bash
node bin/pdd.js daemon start    # 后台定时刷新 cookie
node bin/pdd.js daemon status
node bin/pdd.js daemon stop
```

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
| （固定）`log/cli/` / `log/daemon/` | CLI/daemon 日志按本地日轮转；foreground/bootstrap 写 stderr；路径不可配置 |
| `PDD_ALLOW_INSECURE_AUTH_STATE=1` | POSIX 权限设为 0600 失败时仍继续（不推荐） |
| `PDD_CONSUMER_LOGIN_URL=<url>` | 覆盖消费者端登录页地址 |
| `PDD_MALL_ID_STRICT_PARSE=0` | 放宽 mall ID 到 64 字符（默认 1-15 位数字） |
| `PDD_SCRAPE_SIMULATE=0` | 关闭抓取时的人类行为模拟（默认开启） |
| `PDD_SCRAPE_SOFTBLOCK_THRESHOLD` | IP 软封连续命中阈值进入冷却（默认 2） |
| `PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS` | IP 软封冷却时长 ms（默认 2h） |

## 注意事项

- **AI 消费一律加 `--json`**，并结合退出码判断成败，勿只解析文本。
- **写操作默认 dry-run**：`goods update *` 不加 `--confirm` 只预演，不改线上数据；确认参数后再加 `--confirm`。
- **价格单位是分**：`--price 2999` = 29.99 元。
- **鉴权失效（退出码 3）** → 重新 `login`。**限流（退出码 4）** → 等待冷却后重试。
- `--consumer-account` 的昵称或手机号仅用于注册表查找；登录态实际落盘目录名是 registry 中的安全 slug。
- 本地运行差异优先用 `config set` 写入稀疏 `config/config.json`；秘密、安全和测试开关仍只通过环境变量注入。
- `goods list` 的 `goods_id` 可能为 `null`，库存匹配会回退到 `goods_name`，`matched_by='mixed'` 是正常现象。
- Mock 模式：设 `PDD_TEST_ADAPTER=fixture` + `PDD_TEST_FIXTURE_DIR=<dir>` 可在无浏览器/无真实账号下跑通命令，适合演示与调试。
- 敏感字段（cookie、authorization、anti_content、手机号、地址等）在日志中自动 SHA256 脱敏。
