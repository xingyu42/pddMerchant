# pdd-cli

拼多多商家后台命令行工具，面向 AI Agent 与人类运营。Patchright 驱动 Chromium，输出统一单行 JSON envelope。

**风险声明**：仅限本人店铺运营，滥用可能导致封禁。`data/pdd.db` 与同目录 `master.key` 均为敏感文件，勿上传仓库，备份恢复须成对保留。

## 快速开始

运行环境要求 Node.js >= 24。

```bash
npm install && npx patchright install chromium
pdd init && pdd doctor      # 登录 + 自检
pdd orders list --json      # AI 消费加 --json
```

系统 Chrome 优先，Patchright Chromium 为必须保留的回退运行时；Linux 部署需自行准备 Chromium 运行库，硬件 WebGL 验收配置见 [Chromium Headless GPU](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md)。

## 核心能力

- **AI 友好输出**：`{ ok, command, data, error, meta }` 单行 JSON envelope 与结构化退出码（0–7）
- **经营数据与报表**：订单、库存、推广、售后、体验星级、客服、评价与流量，只输出事实指标与数据完整性标记
- **商品运维与上货**：支持商品查询、预演校验、改价改库存上下架，以及从链接抓取发布
- **多账号与按需鉴权**：SQLite 加密保存多店登录态，支持会话自动重登与 `pdd daemon` 托管控制台人工验证
- **本地成本核算**：本地录入商品成本并结合平台服务费与推广计算商品净利润

## AI Agent 接入（Skill 与命令文档）

完整的 CLI 命令清单、选项参数、配置规则、控制台说明与故障排查已收拢至 `skills/pdd-cli`：

```bash
cp -r skills/pdd-cli ~/.claude/skills/
```

- 命令与操作入口：[skills/pdd-cli/SKILL.md](skills/pdd-cli/SKILL.md)
- 经营报表口径与字段说明：[skills/pdd-cli/reports.md](skills/pdd-cli/reports.md)

## 开发与文档

纯 Node.js ESM，无构建步骤；提交前运行 `npm run check`（`knip` lint + Vitest 测试）。

- [docs/architecture-overview.md](docs/architecture-overview.md) — 分层架构、传输链与存储说明
- [.env.example](.env.example) — 环境变量清单
- [CHANGELOG.md](CHANGELOG.md) — 版本变更记录

## 许可

本仓库不授予绕过平台风控/爬取他人数据的使用许可。使用者自负法律责任。
