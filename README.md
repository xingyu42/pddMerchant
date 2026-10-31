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

Linux 部署方需自行准备 Debian/Ubuntu 所需的 Chromium 运行库。系统 Chrome 是可选的首选运行时；`npx patchright install chromium` 安装的 Chromium 是必须保留的回退运行时。默认自动化始终使用真正的 `headless:true`，不依赖 Xvfb；无头启动仅传入 `--enable-gpu`，由 Chrome 自行探测后端。若验收依赖硬件 WebGL，部署环境还必须提供 Chrome 可用的 EGL/X11 或 Vulkan 驱动；项目不会强制 Vulkan，也不会伪造 WebGL/GPU 结果。[Chromium Headless GPU](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md)

---

## 核心特性

- **AI-friendly envelope**：`{ok, command, data, error, meta}` + 8 个退出码
- **多店铺/多账号**：`--mall <id>` / `--account <slug>` / `--consumer-account <ref>` / `--all-accounts`
- **店铺数据统计**：`diagnose shop` 汇总订单、库存、推广和售后数据，支持数值环比
- **从链接上货**：`goods publish --url <链接>` 一键抓取发布
- **按需认证检查**：登录、普通命令和 `doctor` 独立检查认证；成功命令只回写重新验证通过的材料，从不自动拉起后台进程
- **密码自动重登 + 人工控制台**：会话失效时用已保存的密码自动重登；遇到验证由 `pdd daemon` 托管的网页控制台交给人工完成
- **无头扫码**：`init --qr` 终端二维码 + PNG
- **自动脱敏**：敏感字段 SHA256 替代

---

## 架构

```
bin/pdd.js           CLI 入口（Commander + 信号处理）
src/commands/        命令薄层（withCommand 封装）
src/services/        业务逻辑（orders/goods/promo/diagnose）
src/adapter/         Patchright + XHR 拦截 + auth
src/infra/           envelope/errors/logger/timeouts
```

依赖单向：`commands/ → services/ → adapter/ → infra/`，通过人工审查检查分层。

---

## 命令总览

| 分组 | 命令 |
|------|------|
| **orders** | `list` / `detail` / `stats` |
| **goods** | `list` / `stock` / `segment` / `profit` / `publish` / `templates` |
| **goods cost** | `set` / `list` / `remove` / `import <file>`（本地成本，写入需 `--confirm`） |
| **goods update** | `status` / `price` / `stock` / `title` / `batch`（需 `--confirm`） |
| **promo** | `roi`（`search` / `scene` 已合并废弃） |
| **diagnose** | `shop` / `orders` / `inventory` / `promo` / `after-sales` / `experience [--days 7]` / `customer-service [--days 30]` / `reviews [--days 30]` |
| **shops** | `list` / `current` |
| **config** | `show` / `set <key> <value>` / `unset <key>` / `validate` |
| **account** | `add` / `list` / `default` / `remove` |
| **utility** | `init` / `login` / `doctor` |

### 全局选项

`--json` / `--no-color` / `--timeout <ms>` / `--mall <id>` / `--headed` / `--verbose` / `--account <slug>` / `--consumer-account <ref>` / `--all-accounts`

`--consumer-account` 接受消费者账号的昵称、手机号或 slug；解析到数据库中的账号后，按账号 ID 加载登录态。

详细参数见 `pdd <command> --help` 或 [SKILL.md](skills/pdd-cli/SKILL.md)。

`goods segment`、`promo roi` 和 `diagnose` 只提供事实统计与数据完整性提示，不生成经营建议、健康评分、商品等级或推广优劣分类。`action plan` 和 `--break-even` 已移除；依赖旧输出字段的脚本需要调整。

售后查询使用 `diagnose after-sales [--days 30]`（原 `diagnose funnel`）；店铺总览及环比的维度键改为 `after_sales`。售后维度提供退款成功数/率和售后处理中数/占比，已移除 `fulfillment_rate_pct`。两类占比均以采集到的全部订单数为分母；总览默认近 7 天首批 50 条，单独查询默认近 30 天分页采集。

店铺综合体验星级使用 `diagnose experience [--days 7]` 单独查询，`--days` 为 1–30 的整数。输出平台当前星级、综合分行业排名、各指标值与下一星级门槛及达标状态、消费者体验提升计划和每日趋势；平台评级文案与达标判定原样保留。趋势截止到平台就绪日期，缺失日期保留缺行，未知指标为 `null`；比率规整为百分数，时长使用小时或天。趋势拉取失败时保留当前快照并标记数据不完整，`mall_id` 沿用店铺上下文明文值。`diagnose shop` 继续汇总原有四个维度。

---

## 客服与评价

`pdd diagnose customer-service [--days 30]` 查询「多多客服-客服数据（人工回复）」：天数接受 1-63 的整数，按上海日期统计今天往前指定天数至昨天的区间汇总。逐日趋势由页面自动加载的最近 31 天数据提供，保留窗口内日期和类目参考值；较长窗口的汇总仍覆盖整个区间。人工回复率输出 0-100 百分数（`_pct`），响应时长单位为秒（`_seconds`），无咨询日保留 `null`。汇总失败时命令失败，趋势失败时保留汇总并给出 `hints`。

`pdd diagnose reviews [--days 30]` 接受 30、60、90、180 天，输出平台满意/不满意标签及计数、五类问题的正负面计数和占比，以及描述评分 1-3 星的中差评。每页 10 条，最多 30 页；达到上限时 `negative_reviews.truncated:true` 并提示截断。正文和追评的手机号片段掩码显示；昵称、头像、订单信息、规格和媒体链接由白名单过滤，仅保留图片数量和已回复状态。平台历史评分单独输出 `history_score`，对应三项评分为 `null`。三个数据源独立降级，全部失败时命令失败；参数越界返回 exit 2。

## 商品成本与净利润

```bash
pdd goods cost set --goods-id 101 --purchase-yuan 8.20 --packaging-yuan 0.50 --courier-yuan 3 --confirm --json
pdd goods cost list --goods-id 101 --json
pdd goods cost import costs.json --confirm --json
pdd goods cost remove --goods-id 101 --spec '红色 / 大号' --confirm --json
pdd goods profit --days 30 --goods-id 101 --json
```

成本保存在现有 SQLite 中，按账号、店铺、商品及可选规格文本隔离；删除账号时级联删除。成本命令需要已登记商家账号，支持 `--account` 和 `--mall`，无需在线登录或启动浏览器。店铺优先取参数/运行配置中的店铺，否则取账号绑定店铺；请核对输出 `mall_id`。四个成本命令均只操作本地数据，写命令缺少 `--confirm` 时仅预演，且均拒绝 `--all-accounts`。

货本按件扣除，包材、快递及可选 `--insurance-yuan`（运费险）、`--technical-service-yuan`（技术服务费）按单扣除。所有金额单位为元，允许 0，最多两位小数。set 整条替换；可选费用省略时为 0。默认成本的 `spec` 为 null；指定 `--spec` 时按原文本精确匹配，未命中时回落商品默认成本。remove 缺 spec 仅删默认行。

导入文件是 UTF-8 JSON 数组，支持 BOM，最多 1 MiB / 5000 条；禁止额外账号/店铺列和重复商品/规格键。示例：

```json
[
  { "goods_id": "101", "spec": null, "purchase_yuan": "8.20", "packaging_yuan": "0.50", "courier_yuan": "3.00" },
  { "goods_id": "101", "spec": "红色 / 大号", "purchase_yuan": "9.20", "packaging_yuan": "0.50", "courier_yuan": "3.00", "insurance_yuan": "0.30", "technical_service_yuan": "0.20" }
]
```

全批校验通过后才提交；错误整批拒绝，`E_COST_IMPORT_INVALID` / exit 2 的 `error.detail.row_errors` 给出从 1 开始的记录序号，JSON 语法错误 `row:null`。`list/import` 返回 `items/total`，`set` 返回 `entry`，`remove` 返回 `matched_count/removed_count`，写命令均含 `dry_run`；记录含 `updated_at`。

`goods profit --days` 取整数 1–90，默认 30，非法值 exit 2。窗口按 `group_time`（成团时间）统计上海最近 N 个完整自然日、不含当天；`window.end_at` 为排他上界。`--goods-id` 仅筛 items，summary 始终全店。收入为实付加平台优惠，不重复加买家运费或扣商家优惠；退款成功按全额退款、货已退回，货本与收入为 0，已发货仍扣全部按单项，未发货按单项为 0；发货时间缺失时相关费用为 null。未付款取消收入及成本全为 0；售后 10/11 正常计入，并输出 `after_sales_order_count/after_sales_revenue_yuan`。

主要财务字段是 `revenue_yuan`、各项成本、`merchant_cost_yuan`、`gross_profit_yuan`、`promo_spend_yuan`、`net_profit_yuan`。`gross_margin_pct` 为扣商家成本后的毛利率，`net_margin_pct` 为扣推广后的净利率，均为有符号百分数，可负、可超过 ±100、无截断；零收入时为 null，这是通用百分率 0–100 规则的例外。只展示数字正负，无保本 ROI、盈亏分类或经营建议。

推广花费**仅含商品推广报表口径**：商品按 entityReport.goodsId 归属，全店取 totals.spend，店铺级花费为总计减商品归属合计，仅在 summary 扣除；差额为负时该差额为 null 并给 hint，已知全店总计保留。是否覆盖店铺关注、询单等计划留后续有投放数据时验证。

缺成本、推广失败等未知值保留 null；完整拉取但无该商品推广记录时花费为 0。订单截断或限流时 `summary.data_quality` 和 hints 标记不完整，窗口财务为 null，保留 `observed_order_count/observed_revenue_yuan`。`cost_updated_at` 是实际使用成本记录的最大更新时间，`default_fallback_order_count` 是规格未命中后回落默认成本的观测单数。成本只保留当前值，修改后历史窗口会重算。

免费后台缺少商家货本、包材/快递成本、准确退款金额与货物退回明细、平台补贴共担比例，因此录入成本并保留两项高估说明：仅退款不退货时利润可能高估；商家共担补贴活动按全部平台优惠结算时，收入与利润可能高估。数据库升级到 schema v3；回退旧版需恢复升级前一致备份的 DB 与配对 master.key，请勿手动降低 user_version。

## AI Agent 集成

本项目在 `skills/pdd-cli/SKILL.md` 中提供标准 AI Agent skill 定义，兼容多种 Agent 平台。

### 通用安装方式

**方法 1：平台 CLI 安装**（推荐）

如果你的 Agent 平台支持 skill 命令，通常可以这样安装：

```bash
# 在项目根目录执行
<your-agent-cli> skills install ./skills/pdd-cli

# 或全局安装（所有 agent 可用）
<your-agent-cli> skills install ./skills/pdd-cli --global

# 验证安装
<your-agent-cli> skills list | grep pdd-cli
```

**方法 2：手动复制**

将 `skills/pdd-cli/` 目录复制到平台的 skills 目录：

```bash
# 查找平台 skills 目录（常见路径）
# ~/.claude/skills/              (Claude Code)
# ~/.openclaw/skills/            (OpenClaw)
# <workspace>/skills/            (项目级 workspace)
# ~/.config/<agent>/skills/      (XDG 标准路径)

# 复制 skill
cp -r skills/pdd-cli <平台-skills-目录>/
```

### 平台特定指南

**Claude Code**

```bash
# 手动复制到 Claude Code 全局目录
cp -r skills/pdd-cli ~/.claude/skills/

# 验证（在 Claude Code 中执行）
/pdd-cli
```

**OpenClaw**

```bash
# CLI 安装
openclaw skills install ./skills/pdd-cli --global

# 或从 ClawHub 安装（如果已发布）
openclaw skills install @owner/pdd-cli

# 验证
openclaw skills list | grep pdd-cli
openclaw skills check  # 确认 Node.js 依赖满足
```

**其他 Agent 平台**

大多数 Agent 平台遵循 MCP (Model Context Protocol) 或类似的 skill 规范。查阅你所用平台的文档，通常支持：

1. 直接读取项目内 `skills/` 目录（无需安装）
2. 通过 CLI 命令安装外部 skill
3. 手动复制到平台指定的 skills 目录

### Envelope 契约

所有命令加 `--json` 输出单行 JSON：

```json
{"ok":true,"command":"orders.stats","data":{...},"error":null,"meta":{...}}
```

退出码：`0 OK / 1 GENERAL / 2 USAGE / 3 AUTH / 4 RATE_LIMIT / 5 NETWORK / 6 BUSINESS / 7 PARTIAL`

---

## 运行配置

`config/config.example.json` 是仓库提交的必需运行基线；本机差异写入被 Git 忽略的 `config/config.json`，只需保存需要覆盖的字段。配置优先级为：基线 → 本地配置 → 环境变量 → 本次 CLI 参数。

```bash
pdd config show                         # 查看有效值、本地覆盖和来源
pdd config set rateLimitQps 4           # 类型校验后原子写入本地覆盖
pdd config unset rateLimitQps           # 删除本地覆盖，回退到环境变量或基线
pdd config validate --json              # 分层校验；配置损坏时仍可执行
```

配置命令只管理项目内公开字段，不写 `.env`；修改后由下一次命令加载；已运行的 `pdd daemon` 需重启后生效。旧本地配置中的 `refreshIntervalMs` / `refreshJitterMs` / `authStatePath` 会被忽略，设置这些字段会返回未知字段错误。代理 AuthKey、测试和安全开关继续只允许通过环境变量安全注入。

## 环境变量

商家和消费者账号及登录态统一存入 SQLite，默认数据库为 `data/pdd.db`，可通过 `PDD_DB_PATH` 覆盖。主密钥自动生成在数据库同目录的 `master.key`（默认 `data/master.key`）；数据库和密钥均为敏感文件，勿提交，须一起备份与恢复。账号 slug 保持稳定，供 `--account` 等选项选择账号；首次使用需登录创建账号。旧版 JSON 数据保留原样，升级后请重新登录所有商家和消费者账号；`doctor` 检测到旧数据时会给出固定提示。

CLI 日志固定写入 `log/cli/YYYY-MM-DD.log`；引导阶段写 stderr。日志路径不可通过 `PDD_LOG_DESTINATION` 配置。完整变量、默认值与安全开关见 [.env.example](.env.example)。

商家登录先独立检查登录，再从固定只读接口核对店铺身份和店铺读取权限，全部通过后才保存同次冻结材料。首次自动登记，不需要手填店铺 ID；已有账号的店铺绑定保持一致。已注册 slug 不随店铺显示名变化。普通网络故障返回 `E_AUTH_CHECK_INDETERMINATE`（退出码 5），明确未登录返回 `E_AUTH_EXPIRED`（退出码 3）；店铺读取被拒绝返回业务错误（退出码 6）。订单、商品、营销权限仍在各自命令中检查。

登录态中的 `cookies/origins` 在数据库中加密保存，使用时仅在内存中解密交给浏览器；商家校验元数据单独保存。并发更新使用账号租约与 revision CAS（仅当修订号匹配时提交），删除账号会级联删除关联数据。Token/ck 不导出、不额外保存。`--json` 登录只向 stdout 输出最终一行，二维码等待信息在 stderr，授权结束后删除临时二维码。协议及批准的兼容性例外见 [核验记录](docs/merchant-auth-protocol-verification.md)。

`goods publish --url` 可选择仅为消费者端源商品抓取启用青果短效 HTTP 代理：

```text
PDD_SOURCE_PROXY_PROVIDER=qingguo
PDD_QINGGUO_AUTH_KEY=<青果提取接口 AuthKey>
PDD_QINGGUO_AREA=<可选，6 位地区代码；多个用英文逗号分隔>
```

未设置 `PDD_SOURCE_PROXY_PROVIDER` 时保持直连；未设置 `PDD_QINGGUO_AREA` 时由青果随机选择地区。启用后配置、提取或连接失败不会自动回退直连；代理不作用于商家后台及其他命令。首版不配置代理节点账号/密码鉴权。不要把真实 AuthKey 写入仓库、日志或命令行参数。

---

## daemon 与人工控制台

```bash
pdd daemon start            # 后台启动（已运行则返回状态）
pdd daemon status           # 心跳、控制台地址、最近巡航时间
pdd console link [--account <slug>]   # 生成 10 分钟有效的一次性控制台链接
pdd daemon stop             # 请求停止，15 秒未退出则强杀本机进程
pdd daemon run              # 前台运行（调试）
```

- 控制台用于录入/清除密码（只写，不回显）、解除熔断、开始重登并在浏览器画面中完成短信/滑块验证、改用扫码登录。密码与验证码只在控制台输入，不经过聊天。
- 默认只监听 `127.0.0.1:47821`（`consoleHost` / `consolePort`）。改为局域网地址时为 http 明文，启动会警告；需要外网或 HTTPS 时用 nginx/Caddy 反代，并设置 `consolePublicUrl` 为外部地址（Host 头只接受监听地址或该地址）。局域网访问时 `consoleHost` 填具体网卡地址（如 `192.168.1.10`）；填 `0.0.0.0` 时必须同时设置 `consolePublicUrl`，否则请求会被 421 拒绝。反代须挂在站点根路径（页面使用 `/api`、`/app` 等绝对路径）。
- 反代须关闭对 `/api/sessions/*/frames` 的缓冲（SSE），例如 nginx `proxy_buffering off;`。
- 一次性链接打开后由页面脚本兑换为 8 小时会话，聊天应用的链接预览不会消耗链接。
- 巡航默认关闭（`patrolEnabled`）；开启后按 `patrolIntervalMs`（默认 30 分钟 ±20%）逐账号检查并在失效时自动重登。
- 不做开机自启：重启机器后需重新 `pdd daemon start`。日志写 `log/daemon/YYYY-MM-DD.log`。

## 故障排查

- `E_AUTH_EXPIRED` → `pdd login`
- `E_AUTH_HUMAN_REQUIRED` / `E_AUTH_RELOGIN_BLOCKED` → `pdd console link`，在控制台完成验证、重设密码或解除熔断；也可 `pdd login --qr`
- `E_DAEMON_NOT_RUNNING` 或 warning `daemon_not_running` → `pdd daemon start`
- `E_CHROMIUM_MISSING` → `npx patchright install chromium`
- 命令挂起 → 风控拦截，`pdd doctor` 自检后重新登录

---

## 测试

```bash
npm test                           # 全部测试（vitest；数量以本地输出为准）
npx vitest run test/<file>.test.js # 单文件
npm run test:watch                 # 监听模式
npm run check                      # 当前项目门禁，等同于 npm test
```

分层：`test/contract/`（data 契约 v2 守卫，覆盖全部已注册命令）/ `test/e2e/`（子进程）/ `test/services`、`test/commands`、`test/adapter`、`test/infra`（模块）。当前没有属性测试（PBT）。`npm run lint` 当前仅输出 `no-lint`，不是有效 lint 门禁；项目没有 build 命令，也没有仓库级 CI workflow。

---

## 许可

本仓库不授予绕过平台风控/爬取他人数据的使用许可。使用者自负法律责任。
