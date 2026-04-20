# pdd-cli · V0 Playwright 模式

> 一个面向 AI Agent 与人类运营的拼多多商家后台命令行工具。V0 通过 Playwright 驱动真实 Chromium 访问 `mms.pinduoduo.com`，复用前端 JS 构造的 Anti-Content 风控签名，以 XHR 拦截器捕获业务响应。

---

## 风险与合规声明

使用本工具前请阅读以下条款：

- 本项目通过自动化浏览器访问拼多多商家后台，**可能违反拼多多商家平台服务条款**。
- 仅限你 **本人店铺** 的运营自查与数据导出；严禁用于爬取他人店铺、黑产、批量账号操作。
- 工具使用真实账号凭据；滥用可能导致账号被风控、限流、封禁。
- 若账号产生任何损失（限流 / 封禁 / 罚款），**由使用者自行承担**。
- 推荐仅在小规模、低频率场景下使用（本周 KPI 自查、订单摘要、推广 ROI 一次性检查等）。
- 不要将 `~/.pdd-cli/auth-state.json` 上传到任何公共仓库或云端。

若不接受上述风险，请立即停止使用。

---

## 核心特性

- **AI-friendly envelope**：所有命令统一输出 `{ok, command, data, error, meta}` 结构；`--json` 模式下 stdout 单行合法 JSON，便于 `jq` 与 Agent 消费。
- **6 个退出码**：`0 OK / 1 GENERAL / 2 USAGE / 3 AUTH / 4 RATE_LIMIT / 5 NETWORK / 6 BUSINESS / 7 PARTIAL`，Agent 可直接据此分支。
- **多店铺**：`--mall <id>` 全局切店铺；`pdd shops list` 查看可切列表。
- **店铺健康诊断**：`pdd diagnose shop` 一键输出 4 维度加权总分（orders 40% / inventory 25% / promo 25% / funnel 10%）。
- **敏感字段自动脱敏**：`cookies`、`Anti-Content`、`crawlerInfo`、`authorization` 等在日志中以 SHA256 前 8 位指纹替代。

---

## 系统要求

- Node.js `>=18`
- 首次安装会下载 Chromium（约 150MB）

---

## 安装

```bash
npm install
npx playwright install chromium
```

---

## 快速开始

```bash
# 1. 首次登录（弹浏览器，扫码/账密登录后自动保存凭据）
pdd init

# 2. 自检
pdd doctor

# 3. 列出本周订单
pdd orders list --size 20

# 4. 订单统计（远程 KPI + 本地 P50/P95 聚合）
pdd orders stats
```

---

## 多店铺示例

```bash
# 列出当前账号下所有店铺
pdd shops list

# 切换店铺执行命令
pdd --mall 445301049 orders list

# 当前店铺
pdd shops current
```

---

## AI Agent 示例

所有命令支持 `--json`，stdout 为单行 JSON，易于 Agent 消费：

```bash
# 店铺综合健康分 → 管道给 jq
pdd diagnose shop --json | jq '.data.score, .data.status'

# 根据退出码分支
pdd orders stats --json
# echo $?
# 0 = OK；3 = 需重新登录；5 = 网络问题；6 = 业务错误（如风控触发）

# 一次性收集本周订单与诊断数据
pdd orders list --json --size 50 > orders.json
pdd diagnose orders --json > orders-health.json
```

### Envelope 结构

```json
{
  "ok": true,
  "command": "orders.stats",
  "data": { "...": "..." },
  "error": null,
  "meta": { "latency_ms": 4321, "xhr_count": 2, "warnings": [] }
}
```

---

## 命令总览

| 分组 | 命令 | 说明 |
|------|------|------|
| 📦 orders | `list` / `detail` / `stats` | 订单列表、详情、统计 |
| 🛍️ goods | `list` / `stock` | 商品列表、库存告警 |
| 🚀 promo | `search` / `scene` / `ddk` | 搜索 / 场景 / DDK 推广报表 |
| 🩺 diagnose | `shop` / `orders` / `inventory` / `promo` / `funnel` | 健康评分 |
| 🏬 shops | `list` / `current` | 店铺切换 |
| ⚙️ utility | `init` / `login` / `doctor` | 鉴权与环境 |

### 全局 flags

| Flag | 说明 |
|------|------|
| `--json` | stdout 单行 JSON |
| `--no-color` | 关闭彩色输出（管道场景自动关闭） |
| `--raw` | 输出原始接口响应（调试） |
| `--timeout <ms>` | 全局超时 |
| `--mall <id>` | 指定店铺 ID |
| `--headed` | 有头浏览器（调试） |
| `--verbose` | debug 日志 |

---

## 故障排查

| 现象 | 排查 |
|------|------|
| `E_AUTH_EXPIRED` / `E_AUTH_STATE_MISSING` | `pdd login` 重新登录 |
| `E_CHROMIUM_MISSING` | `npx playwright install chromium` |
| Playwright 下载卡住 | 设置镜像：`PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` |
| `E_NETWORK` / 收集器超时 | 检查网络；或 `--headed` 观察页面；或 `--verbose` 看详细日志 |
| 命令挂起 | 大概率风控拦截；`pdd doctor` 自检后 `pdd login` 重新登录 |
| Windows 上 `chmod 600` 警告 | 正常：Windows 无 POSIX 文件权限，不影响功能 |

---

## 安全与脱敏

- 登录凭据以 `storageState` 形式存储于 `~/.pdd-cli/auth-state.json`（POSIX 下 `chmod 600`）。
- 运行日志中敏感字段自动指纹化（SHA256 前 8 位）：`cookies`、`Anti-Content`、`crawlerInfo`、`authorization`、`set-cookie`、`session_id` 等。
- `--verbose` 打开 debug 日志时仍保持脱敏。

---

## V0 已知限制

- **单账号多店铺**：V0 改用 `--profile` 多账号凭据文件（因 stealth 模式下 `userDataDir` 不自动保留 cookies）。
- **订单详情**：V0 未侦察 `orderDetail` 接口，`pdd orders detail --sn` 使用 `orders list` 过滤兜底，仅限最近订单。
- **推广 DDK**：`pdd promo ddk` V0 为占位（待 V0.1）。
- **funnel 诊断**：需 DMP / SYCM 数据接入，V0 返回 `partial` + hint。

---

## 测试

```bash
npm test
# 涵盖 envelope schema + JSON 纯净度 + CLI 退出码
```

---

## 退出码对照

| Code | 含义 | Agent 建议 |
|------|------|------------|
| 0 | OK | 继续 |
| 1 | GENERAL | 检查错误信息 |
| 2 | USAGE | 参数问题，看 `--help` |
| 3 | AUTH | 执行 `pdd login` |
| 4 | RATE_LIMIT | 等待后重试 |
| 5 | NETWORK | 检查网络或降低调用频率 |
| 6 | BUSINESS | 业务错误，查看 envelope.error.hint |
| 7 | PARTIAL | 部分成功，关注 `meta.warnings` |

---

## 许可与免责

本仓库不授予任何涉及绕过拼多多平台风控 / 爬取他人数据的使用许可。使用者须对其行为承担全部法律与合规责任。
