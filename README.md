# pdd-cli

拼多多商家后台命令行工具，面向 AI Agent 与人类运营。Patchright 驱动 Chromium、拦截 XHR 响应，输出统一 envelope JSON。

**风险声明**：仅限本人店铺运营，滥用可能导致封禁。`data/merchant/`、`data/consumer/` 下的登录数据勿上传公共仓库。

---

## 快速开始

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
- **店铺健康诊断**：`diagnose shop` 四维加权 + 运营动作清单
- **从链接上货**：`goods publish --url <链接>` 一键抓取发布
- **Auth 自动续期**：`daemon start` 后台刷新，防并发 file lock
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

依赖单向：`commands/ → services/ → adapter/ → infra/`，层级守卫测试保障。

---

## 命令总览

| 分组 | 命令 |
|------|------|
| **orders** | `list` / `detail` / `stats` |
| **goods** | `list` / `stock` / `segment` / `publish` / `templates` |
| **goods update** | `status` / `price` / `stock` / `title` / `batch`（需 `--confirm`） |
| **promo** | `roi`（`search` / `scene` 已合并废弃） |
| **diagnose** | `shop` / `orders` / `inventory` / `promo` / `funnel` |
| **action** | `plan` |
| **shops** | `list` / `current` |
| **config** | `show` / `set <key> <value>` / `unset <key>` / `validate` |
| **account** | `add` / `list` / `default` / `remove` |
| **daemon** | `start` / `stop` / `status` |
| **utility** | `init` / `login` / `doctor` |

### 全局选项

`--json` / `--no-color` / `--timeout <ms>` / `--mall <id>` / `--headed` / `--verbose` / `--account <slug>` / `--consumer-account <ref>` / `--all-accounts`

`--consumer-account` 接受消费者账号的昵称、手机号或存储 slug；解析到注册表后，实际登录态仍按 slug 归档。

详细参数见 `pdd <command> --help` 或 [SKILL.md](skills/pdd-cli/SKILL.md)。

---

## AI Agent / OpenClaw 集成

### OpenClaw Skills 安装

本项目提供 `skills/pdd-cli/SKILL.md`，需手动安装到 OpenClaw：

**推荐方式（本地安装）：**

```bash
# 在项目根目录执行
openclaw skills install ./skills/pdd-cli

# 全局安装（所有 agent 可用）
openclaw skills install ./skills/pdd-cli --global

# 验证安装
openclaw skills list | grep pdd-cli
openclaw skills check  # 确认 Node.js 依赖满足
```

**从 ClawHub 安装**（如果已发布）：

```bash
openclaw skills install @owner/pdd-cli
```

**手动复制**：

```bash
# 复制到 OpenClaw workspace
cp -r skills/pdd-cli <openclaw-workspace>/skills/

# 或复制到全局目录
cp -r skills/pdd-cli ~/.openclaw/skills/
```

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

配置命令只管理项目内公开字段，不写 `.env`，也不会自动重启 daemon。修改刷新间隔或日志级别后，结果会提示显式重启。代理 AuthKey、主密码、测试和安全开关继续只允许通过环境变量安全注入。

## 环境变量

没有注册账号时，商家和消费者登录态分别使用 `data/merchant/stores/default/auth-state.json` 与 `data/consumer/accounts/default/auth-state.json`。登录成功并注册身份后，文件归档到各自 `registry.json` 记录的 `<slug>/auth-state.json`；slug 由显示名生成并处理冲突，不等同于原始店铺名、昵称或手机号。`PDD_AUTH_STATE_PATH` 与 `PDD_CONSUMER_AUTH_STATE_PATH` 可显式覆盖单个登录态文件，账号目录和注册表也有独立覆盖变量。

CLI 与后台 daemon 日志分别固定写入 `log/cli/YYYY-MM-DD.log` 和 `log/daemon/YYYY-MM-DD.log`；foreground/引导阶段写 stderr。日志路径不可通过 `PDD_LOG_DESTINATION` 配置。完整变量、默认值与安全开关见 [.env.example](.env.example)。

`goods publish --url` 可选择仅为消费者端源商品抓取启用青果短效 HTTP 代理：

```text
PDD_SOURCE_PROXY_PROVIDER=qingguo
PDD_QINGGUO_AUTH_KEY=<青果提取接口 AuthKey>
PDD_QINGGUO_AREA=<可选，6 位地区代码；多个用英文逗号分隔>
```

未设置 `PDD_SOURCE_PROXY_PROVIDER` 时保持直连；未设置 `PDD_QINGGUO_AREA` 时由青果随机选择地区。启用后配置、提取或连接失败不会自动回退直连；代理不作用于商家后台及其他命令。首版不配置代理节点账号/密码鉴权。不要把真实 AuthKey 写入仓库、日志或命令行参数。

---

## 故障排查

- `E_AUTH_EXPIRED` → `pdd login`
- `E_CHROMIUM_MISSING` → `npx patchright install chromium`
- 命令挂起 → 风控拦截，`pdd doctor` 自检后重新登录

---

## 测试

```bash
npm test                           # 全部测试（vitest；数量以本地输出为准）
npx vitest run test/<file>.test.js # 单文件
npm run test:watch                 # 监听模式
npm run test:endpoints             # endpoint 规范校验
npm run check                      # 当前项目门禁，等同于 npm test
```

分层：smoke（契约）/ unit（模块）/ e2e（进程）/ PBT（属性测试）。PBT 同时使用项目 `_harness.js` 和 `fast-check`；`PBT_SEED` / `PBT_RUNS` 只控制项目 harness，fast-check 用例在测试内配置运行参数和失败复现信息。`npm run lint` 当前仅输出 `no-lint`，不是有效 lint 门禁；项目没有 build 命令，也没有仓库级 CI workflow。

---

## 许可

本仓库不授予绕过平台风控/爬取他人数据的使用许可。使用者自负法律责任。
