# pdd-cli · V0 Playwright 模式

> 拼多多商家后台命令行工具，面向 AI Agent 与人类运营。通过 Playwright 驱动 Chromium 访问 `mms.pinduoduo.com`，复用前端 Anti-Content 风控签名，以 XHR 拦截器捕获业务响应。

## 风险声明

- 仅限 **本人店铺** 运营自查与数据导出；滥用可能导致账号被风控/封禁，**后果自负**。
- 不要将 `data/auth-state.json` 上传到公共仓库或云端。

---

## 快速开始

```bash
npm install && npx playwright install chromium

pdd init            # 首次登录（扫码/账密）
pdd doctor          # 自检
pdd orders list --size 20
pdd orders stats
```

---

## 核心特性

- **AI-friendly envelope**：统一 `{ok, command, data, error, meta}` 输出；`--json` 模式 stdout 单行 JSON。
- **8 个退出码**：`0 OK / 1 GENERAL / 2 USAGE / 3 AUTH / 4 RATE_LIMIT / 5 NETWORK / 6 BUSINESS / 7 PARTIAL`。
- **多店铺**：`--mall <id>` 切店铺；`pdd shops list` 查看列表。
- **店铺健康诊断**：`pdd diagnose shop` 四维加权评分。
- **Auth 自动续期**：`pdd daemon start` 后台定时刷新 cookie，advisory file lock 防并发。
- **QR 无头登录**：`pdd init --qr` 终端渲染二维码 + 保存 PNG，无需弹出浏览器。
- **敏感字段自动脱敏**：日志中 cookies/Anti-Content/authorization 等以 SHA256 指纹替代。

---

## 架构

```
bin/pdd.js          CLI 入口 (Commander routing, signal handlers)
src/commands/       命令处理 — withCommand() 薄封装
src/services/       领域逻辑 (orders, goods, promo, diagnose)
src/adapter/        Playwright 集成, XHR 拦截, auth, mall context
src/infra/          横切关注: envelope, errors, logger, timeouts, abort
```

依赖单向流动：`commands/ → services/ → adapter/ → infra/`，禁止反向引用。

---

## 命令总览

| 分组 | 命令 | 说明 |
|------|------|------|
| orders | `list` / `detail` / `stats` | 订单列表、详情、统计 |
| goods | `list` / `stock` / `segment` | 商品列表、库存告警、SKU 分层 |
| promo | `search` / `scene` / `roi` | 搜索 / 场景推广报表、ROI 诊断 |
| diagnose | `shop` / `orders` / `inventory` / `promo` / `funnel` | 健康评分（shop 支持 `--compare`） |
| action | `plan` | 一键运营动作清单 |
| shops | `list` / `current` | 店铺切换 |
| daemon | `start` / `stop` / `status` | 后台 auth 自动续期 |
| utility | `init` / `login` / `doctor` | 鉴权与环境 |

### 全局 flags

| Flag | 说明 |
|------|------|
| `--json` | stdout 单行 JSON |
| `--no-color` | 关闭彩色输出 |
| `--timeout <ms>` | 全局超时 |
| `--mall <id>` | 指定店铺 ID |
| `--headed` | 有头浏览器（调试） |
| `--verbose` | debug 日志 |

### 命令特定 flags

| 命令 | Flag | 说明 |
|------|------|------|
| `init` / `login` | `--qr` | 无头模式：终端渲染二维码 + 保存 PNG |
| `orders list` | `--page` `--size` `--since` `--until` | 分页与时间范围 |
| `orders detail` | `--sn <sn>` | 订单号（必填） |
| `orders stats` | `--size` | 本地聚合样本数 |
| `goods list` | `--page` `--size` `--status` | 分页与状态筛选（onsale/offline） |
| `goods stock` | `--threshold` | 低库存阈值（默认 10） |
| `promo search/scene` | `--since` `--page` `--size` | 日期与分页 |
| `promo roi` | `--by` `--break-even` `--include-inactive` | ROI 分组/保本线/含已删除 |
| `goods segment` | `--days` `--break-even` `--no-promo` | SKU 分层窗口/保本线 |
| `diagnose shop` | `--compare` `--days` | 环比对比/窗口天数 |
| `action plan` | `--limit` `--compare` `--break-even` `--no-promo` `--no-segment` | 动作数/趋势/保本线 |
| `doctor` | `--probe <mode>` | mall context 探测策略 |

---

## AI Agent 用法

```bash
pdd diagnose shop --json | jq '.data.score, .data.status'

# 退出码分支：0=OK / 3=需登录 / 5=网络 / 6=业务错误
pdd orders stats --json; echo $?
```

Envelope 结构：

```json
{
  "ok": true,
  "command": "orders.stats",
  "data": { "...": "..." },
  "error": null,
  "meta": { "v": 1, "exit_code": 0, "latency_ms": 4321, "xhr_count": 2, "warnings": [] }
}
```

---

## 环境变量

| 变量 | 用途 |
|------|------|
| `PDD_AUTH_STATE_PATH` | 覆盖 auth state 文件路径（默认 `data/auth-state.json`） |
| `PDD_LOG_DESTINATION` | 日志输出目标（绝对路径 / 项目相对路径） |
| `PDD_MALL_ID_STRICT_PARSE` | 设为 `0` 允许 mall ID 至 64 字符（默认严格 1-15 位数字） |
| `PDD_TEST_ADAPTER` | 设为 `fixture` 启用 mock 模式（跳过真实浏览器） |
| `PDD_TEST_FIXTURE_DIR` | 指定 fixture 数据目录 |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Playwright 浏览器下载镜像 |

---

## 故障排查

| 现象 | 排查 |
|------|------|
| `E_AUTH_EXPIRED` | `pdd login` 重新登录 |
| `E_CHROMIUM_MISSING` | `npx playwright install chromium` |
| `E_NETWORK` / 超时 | 检查网络；`--headed` 观察页面 |
| 命令挂起 | 大概率风控拦截；`pdd doctor` → `pdd login` |

---

## 测试

```bash
npm test                              # 运行全部 427 测试（vitest）
npx vitest run test/<file>.test.js    # 运行单个测试文件
npx vitest                            # watch 模式
```

测试分层：

- **smoke**：`test/*.smoke.test.js` — 命令级 envelope 契约验证
- **unit**：`test/*.unit.test.js` — 模块级单元测试
- **e2e**：`test/e2e/*.e2e.test.js` — 子进程 + fixture adapter 端到端
- **PBT**：`test/pbt/*.pbt.test.js` — 零依赖 property-based testing（`PBT_SEED=<n>` 复现）

测试 seam：`PDD_TEST_ADAPTER=fixture` 在 4 个 adapter 入口短路到 fixture，无需 DI。

---

## 退出码

| Code | 含义 | Agent 建议 |
|------|------|------------|
| 0 | OK | 继续 |
| 1 | GENERAL | 检查错误信息 |
| 2 | USAGE | 看 `--help` |
| 3 | AUTH | `pdd login` |
| 4 | RATE_LIMIT | 等待重试 |
| 5 | NETWORK | 检查网络 |
| 6 | BUSINESS | 查看 `error.hint` |
| 7 | PARTIAL | 关注 `meta.warnings` |

---

## 更新日志

版本迁移说明见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 许可与免责

本仓库不授予任何涉及绕过拼多多平台风控 / 爬取他人数据的使用许可。使用者须对其行为承担全部法律与合规责任。
