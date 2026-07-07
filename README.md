# pdd-cli

拼多多商家后台命令行工具，面向 AI Agent 与人类运营。Playwright 驱动 Chromium、拦截 XHR 响应，输出统一 envelope JSON。

**风险声明**：仅限本人店铺运营，滥用可能导致封禁。`data/auth-state.json` 勿上传公共仓库。

---

## 快速开始

```bash
npm install && npx playwright install chromium
pdd init && pdd doctor      # 登录 + 自检
pdd orders list --json      # AI 消费加 --json
```

---

## 核心特性

- **AI-friendly envelope**：`{ok, command, data, error, meta}` + 8 个退出码
- **多店铺/多账号**：`--mall <id>` / `--account <slug>` / `--all-accounts`
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
src/adapter/         Playwright + XHR 拦截 + auth
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
| **account** | `add` / `list` / `default` / `remove` |
| **daemon** | `start` / `stop` / `status` |
| **utility** | `init` / `login` / `doctor` |

### 全局选项

`--json` / `--no-color` / `--timeout <ms>` / `--mall <id>` / `--headed` / `--verbose` / `--account <slug>` / `--all-accounts`

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

## 环境变量

常用：`PDD_AUTH_STATE_PATH` / `PDD_LOG_DESTINATION` / `PDD_FINGERPRINT_SEED` / `PDD_TEST_ADAPTER=fixture`（Mock 模式）

---

## 故障排查

- `E_AUTH_EXPIRED` → `pdd login`
- `E_CHROMIUM_MISSING` → `npx playwright install chromium`
- 命令挂起 → 风控拦截，`pdd doctor` 自检后重新登录

---

## 测试

```bash
npm test                           # 全部测试（vitest；数量以本地输出为准）
npx vitest test/<file>.test.js     # 单文件
```

分层：smoke（契约）/ unit（模块）/ e2e（进程）/ PBT（属性测试，`PBT_SEED=<n>` 复现）

---


## 许可

本仓库不授予绕过平台风控/爬取他人数据的使用许可。使用者自负法律责任。
