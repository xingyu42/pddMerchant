# pdd-cli

拼多多商家后台命令行工具，面向 AI Agent 与人类运营。Patchright 驱动 Chromium、拦截 XHR 响应，输出统一 envelope JSON。

**风险声明**：仅限本人店铺运营，滥用可能导致封禁。`data/pdd.db` 与同目录的 `data/master.key` 均为敏感文件，勿上传公共仓库，备份与恢复时须一起保留。

---

## 快速开始

运行环境要求 Node.js >= 24。

```bash
npm install && npx patchright install chromium
pdd init && pdd doctor      # 登录 + 自检
pdd orders list --json      # AI 消费加 --json
```

系统 Chrome 是可选的首选运行时，`npx patchright install chromium` 安装的 Chromium 是必须保留的回退运行时。自动化始终使用真正的 `headless:true`，不依赖 Xvfb。Linux 部署需自行准备 Chromium 运行库；验收依赖硬件 WebGL 时，还需提供 Chrome 可用的 EGL/X11 或 Vulkan 驱动（见 [Chromium Headless GPU](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md)）。

## 核心特性

- **AI 友好的 envelope**：`{ok, command, data, error, meta}` + 8 个退出码
- **多店铺 / 多账号**：`--mall <id>` / `--account <slug>` / `--consumer-account <ref>` / `--all-accounts`
- **经营数据报表**：订单、库存、推广、售后、体验星级、客服、评价、流量与商品净利润，只输出事实数字与数据完整性
- **从链接上货**：`goods publish --url <链接>` 一键抓取发布
- **按需认证 + 密码自动重登**：会话失效时用已保存的密码重登；遇到验证由 `pdd daemon` 托管的网页控制台交给人工完成
- **无头扫码**：`init --qr` 终端二维码 + PNG
- **自动脱敏**：日志与调试输出中的敏感字段以指纹或 `[REDACTED]` 替代

---

## 命令总览

| 分组 | 命令 |
|------|------|
| **orders** | `list` / `detail` / `stats` |
| **goods** | `list` / `stock` / `segment` / `profit` / `traffic` / `publish` / `templates` |
| **goods cost** | `set` / `list` / `remove` / `import <file>`（本地成本，写入需 `--confirm`） |
| **goods update** | `status` / `price` / `stock` / `title` / `batch`（需 `--confirm`） |
| **promo** | `roi` |
| **diagnose** | `shop` / `orders` / `inventory` / `promo` / `after-sales` / `experience` / `experience-plan` / `customer-service` / `reviews` / `traffic` |
| **shops** | `list` / `current` |
| **config** | `show` / `set <key> <value>` / `unset <key>` / `validate` |
| **account** | `add` / `list` / `default` / `remove`（需 `--confirm`，否则仅预演） |
| **daemon / console** | `daemon start` / `stop` / `restart` / `status` / `run`，`console link` |
| **utility** | `init` / `login` / `doctor` |

全局选项：`--json` / `--no-color` / `--timeout <ms>` / `--mall <id>` / `--headed` / `--verbose` / `--account <slug>` / `--consumer-account <ref>`（昵称、手机号或 slug）/ `--all-accounts`。

详细参数见 `pdd <command> --help`；输出约定见 [SKILL.md](skills/pdd-cli/SKILL.md)，报表口径见 [reports.md](skills/pdd-cli/reports.md)。

---

## 经营报表

所有报表只提供事实统计与数据完整性提示，不生成经营建议、健康评分或优劣分类。缺失值为 `null`，与 0 区分；`status`、`hints`、`data_quality` 标记截断、限流和降级。

| 命令 | 窗口 | 内容 |
|------|------|------|
| `diagnose shop [--compare] [--days 7]` | 默认 7 天 | 订单 / 库存 / 推广 / 售后四维汇总与数值环比 |
| `diagnose after-sales [--days 30]` | 默认 30 天 | 退款成功数/率、售后处理中数/占比（取代原 `diagnose funnel`） |
| `diagnose experience [--days 7]` | 1–30 天 | 平台体验星级、行业排名、指标与下一星级门槛、每日趋势 |
| `diagnose experience-plan [--days 7] [--page 1]` | 1 / 7 / 30 / 90 天（含今天） | 消费者体验提升计划状态、今日服务费费率、收费订单与运费补偿订单数、逐单收费记录（每页 10 条） |
| `diagnose customer-service [--days 30]` | 1–63 天 | 「多多客服-客服数据（人工回复）」区间汇总；逐日趋势取页面加载的最近 31 天 |
| `diagnose reviews [--days 30]` | 30 / 60 / 90 / 180 天 | 满意/不满意标签、五类问题计数、1–3 星中差评（最多 30 页，手机号掩码） |
| `diagnose traffic [--days 30]` | 1–30 天 | 全店逐日访客、浏览、成交及同行均值/优秀值，另附今日截至当前的实时区块 `today`；访客汇总跨日存在重复 |
| `goods traffic [--days 30] [--goods-id <id>]` | 1 / 7 / 30 天 | 全店商品明细，并按商品拆分推广直接/间接成交与花费 |
| `goods profit [--days 30] [--goods-id <id>]` | 1–90 天 | 窗口收入、商家成本、毛利、推广花费与净利润 |
| `goods receipt [--goods-id <id>] [--page 1] [--size 10] [--caliber regular\|all]` | 当前价格 | 按 SKU 输出平台预估实收（券前价 − 商家出资优惠），含单件与多件最低场景 |

口径说明：

- `goods traffic` 的 `non_promo_*` 为商品总成交减去推广直接成交的差值，平台不提供该拆分；负差额或推广拉取失败时为 `null`。推广拆分口径来自第三方插件静态分析，尚未经有投放店铺实测。
- `goods profit` 推广花费仅含商品推广报表口径；以下两种情况利润可能高估：仅退款不退货、商家共担平台补贴。`gross_margin_pct` / `net_margin_pct` 为有符号百分数，可负、可超过 ±100。
- `goods receipt` 原样报告「商品价格管理」页的平台估算值，CLI 不重算，也不含技术服务费或平台补贴。`--caliber regular`（默认，商家出资常规优惠）与 `all`（另含非公开优惠、多单立减、商家出资平台券）分别取各自场景，两种口径不混用。上游每页最多 10 个商品；列表只带回部分规格的商品会逐个补全全部 SKU。

## 商品成本与净利润

`goods profit` 需要先录入成本。成本保存在本地 SQLite，按账号、店铺、商品及可选规格隔离，无需在线登录或启动浏览器；请核对输出中的 `mall_id`。

```bash
pdd goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 --confirm --json
pdd goods cost list --goods-id 101 --json
pdd goods cost import costs.json --confirm --json
pdd goods cost remove --goods-id 101 --spec '红色 / 大号' --confirm --json
pdd goods profit --days 30 --goods-id 101 --json
```

- 货本按件扣除；包材、快递及可选 `--insurance-yuan`（运费险）、`--technical-service-yuan`（技术服务费）按单扣除。金额单位为元，最多两位小数。
- `--spec` 按原文精确匹配，未命中时回落商品默认成本（`spec: null`）。
- 写命令缺少 `--confirm` 时仅预演；成本命令均拒绝 `--all-accounts`。

导入文件为 UTF-8 JSON 数组（最多 1 MiB / 5000 条），全部校验通过才写入，任一错误整批拒绝（`E_COST_IMPORT_INVALID`，`error.detail.row_errors` 给出从 1 开始的记录序号）：

```json
[
  { "goods_id": "101", "spec": null, "purchase_yuan": "8.20", "packaging_yuan": "0.50", "courier_yuan": "3.00" },
  { "goods_id": "101", "spec": "红色 / 大号", "purchase_yuan": "9.20", "packaging_yuan": "0.50", "courier_yuan": "3.00", "insurance_yuan": "0.30", "technical_service_yuan": "0.20" }
]
```

成本只保留当前值，修改后历史窗口会按新成本重算。成本表使数据库升级到 schema v3；回退旧版需恢复升级前一起备份的数据库与 `master.key`，请勿手动降低 `user_version`。

---

## AI Agent 集成

`skills/pdd-cli/SKILL.md` 是标准 Agent skill 定义。复制到所用平台的 skills 目录即可，例如 Claude Code：

```bash
cp -r skills/pdd-cli ~/.claude/skills/
```

支持 skill 安装命令的平台可直接安装 `./skills/pdd-cli` 目录。

所有命令加 `--json` 输出单行 JSON：

```json
{"ok":true,"command":"orders.stats","data":{...},"error":null,"meta":{...}}
```

退出码：`0 OK / 1 GENERAL / 2 USAGE / 3 AUTH / 4 RATE_LIMIT / 5 NETWORK / 6 BUSINESS / 7 PARTIAL`

---

## 配置与数据

**运行配置**：`config/config.example.json` 是仓库提交的运行基线，本机差异写入被 Git 忽略的 `config/config.json`。优先级：基线 → 本地配置 → 环境变量 → CLI 参数。

```bash
pdd config show                         # 查看有效值、本地覆盖和来源
pdd config set rateLimitQps 4           # 类型校验后原子写入本地覆盖
pdd config unset rateLimitQps           # 删除本地覆盖
pdd config validate --json              # 分层校验；配置损坏时仍可执行
```

配置修改由下一次命令加载，已运行的 `pdd daemon` 需重启。代理 AuthKey、测试与安全开关只能通过环境变量注入，完整变量见 [.env.example](.env.example)。

**账号与登录态**：商家和消费者账号统一存入 SQLite（默认 `data/pdd.db`，`PDD_DB_PATH` 覆盖），主密钥自动生成在同目录的 `master.key`。登录态加密保存，使用时仅在内存中解密。首次登录自动登记店铺，无需手填店铺 ID；账号 slug 保持稳定，供 `--account` 选择。认证协议与兼容性例外见 [核验记录](docs/merchant-auth-protocol-verification.md)。

**日志**：CLI 日志写入 `log/cli/YYYY-MM-DD.log`，daemon 日志写入 `log/daemon/YYYY-MM-DD.log`。

**上货代理**：`goods publish --url` 可仅为消费者端源商品抓取启用青果短效 HTTP 代理；未设置时直连，启用后失败不会回退直连。不要把真实 AuthKey 写入仓库、日志或命令行参数。

```text
PDD_SOURCE_PROXY_PROVIDER=qingguo
PDD_QINGGUO_AUTH_KEY=<青果提取接口 AuthKey>
PDD_QINGGUO_AREA=<可选，6 位地区代码；多个用英文逗号分隔>
```

---

## daemon 与人工控制台

```bash
pdd daemon start                      # 后台启动（已运行则返回状态）
pdd daemon status                     # 心跳、控制台地址、最近巡航时间
pdd console link [--account <slug>]   # 生成 10 分钟有效的一次性控制台链接
pdd daemon stop                       # 请求停止，15 秒未退出则强杀本机进程
pdd daemon restart                    # 停止后再启动；更新代码后用它加载新代码
pdd daemon run                        # 前台运行（调试）
```

- 控制台用于用登录名和密码新增账号（核验通过后登记并保存密码）、删除店铺（需输入店铺名确认）、录入/清除密码（只写不回显）、解除熔断、输入短信验证码、在转播的验证码弹窗中完成滑块等验证、改用扫码登录。密码与验证码只在控制台输入，不经过聊天。
- 一次性链接打开后兑换为 8 小时会话，聊天应用的链接预览不会消耗链接。
- 默认只监听 `127.0.0.1:47821`（`consoleHost` / `consolePort`）。局域网地址为 http 明文；外网或 HTTPS 请用 nginx/Caddy 在站点根路径反代，设置 `consolePublicUrl`，并对 `/api/sessions/*/frames`（SSE）关闭缓冲（nginx `proxy_buffering off;`）。`consoleHost` 填 `0.0.0.0` 时必须设置 `consolePublicUrl`，否则请求返回 421。
- 巡航默认关闭（`patrolEnabled`）；开启后按 `patrolIntervalMs`（默认 30 分钟 ±20%）逐账号检查，失效时自动重登。控制台店铺列表标题右侧的巡航胶囊（「巡航中 / 自动巡航」）点开后可即时启停并写入本地配置（等同 `pdd config set patrolEnabled`），被环境变量固定时拒绝修改。
- daemon 启动时加载代码；控制台页面每次从磁盘读取。更新代码后执行 `pdd daemon restart`，否则新页面会配上旧接口。重启会中断进行中的登录。
- 不做开机自启，重启机器后需重新 `pdd daemon start`。普通命令、`login` 和 `doctor` 从不拉起 daemon。

## 故障排查

- `E_AUTH_EXPIRED` → `pdd login`
- `E_AUTH_CHECK_INDETERMINATE`（退出码 5）→ 网络故障导致无法判定登录态，稍后重试
- `E_AUTH_HUMAN_REQUIRED` / `E_AUTH_RELOGIN_BLOCKED` → `pdd console link`，在控制台完成验证、重设密码或解除熔断；也可 `pdd login --qr`
- `E_DAEMON_NOT_RUNNING` 或 warning `daemon_not_running` → `pdd daemon start`
- `E_CHROMIUM_MISSING` → `npx patchright install chromium`
- 命令挂起 → 可能被风控拦截，`pdd doctor` 自检后重新登录

---

## 开发

```
bin/pdd.js           CLI 入口（Commander + 信号处理）
src/commands/        命令薄层（withCommand 封装）
src/services/        业务逻辑与输出视图
src/adapter/         Patchright + XHR 拦截 + auth
src/infra/           envelope/errors/logger/timeouts
```

依赖单向：`commands/ → services/ → adapter/ → infra/`，靠人工审查维持。详见 [架构概览](docs/architecture-overview.md)。

```bash
npm test                           # 全部测试（vitest）
npx vitest run test/<file>.test.js # 单文件
npm run test:watch                 # 监听模式
```

测试分层：`test/contract/`（data 契约 v2 与命令文档守卫，覆盖全部已注册命令）/ `test/e2e/`（子进程 + fixture adapter）/ `test/services`、`test/commands`、`test/adapter`、`test/infra`。`npm run lint` 用 knip 检查无用文件、依赖、未声明导入与二进制；`npm run check` 依次跑 lint 和测试，`.github/workflows/check.yml` 在推送 `main` 和 PR 时执行它。项目没有 build 步骤。

---

## 许可

本仓库不授予绕过平台风控/爬取他人数据的使用许可。使用者自负法律责任。
