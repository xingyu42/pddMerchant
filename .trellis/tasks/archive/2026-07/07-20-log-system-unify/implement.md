# Implement: log 系统统一

## Checklist

### 1. Paths

- [x] 在 `src/infra/paths.js` 增加 `LOG_DIR`、`CLI_LOG_DIR`、`DAEMON_LOG_DIR`
- [x] CLI 与 daemon 使用独立固定 channel 目录
- [x] 导出常量供 logger / daemon / 测试使用

### 2. Logger destination + rotation

- [x] 实现本地日期格式化与 `resolveDatedLogPath(logDirectory, date)`
- [x] 实现 `DailyRotatingFileDestination`（write 时跨日切换、mkdirSync、委托 pino.destination）
- [x] 重写 `buildDestination` / `createLogger` 固定 channel 策略
- [x] 支持内部 string directory 与测试用 stream object；移除公开 `logDestination`
- [x] 注入 `now` 便于跨日单测
- [x] 保持 redaction / withOp / getLogger silent 行为

### 3. Daemon entry

- [x] `bin/pdd-daemon.js` 后台传入 `channel: 'daemon'`
- [x] foreground 传入 `channel: 'foreground'` 并使用 stderr

### 4. Ignore + docs

- [x] `.gitignore` 增加 `log/`
- [x] 更新 `.env.example` 日志段落
- [x] 修正 `docs/architecture-overview.md` 固定路径说明
- [x] README 补充固定路径
- [x] 更新 `.trellis/spec/infra/logging-redaction.md` 与 `env-paths.md`

### 5. Tests

- [x] 新增 `test/logger-destination.unit.test.js`：
  - 默认 CLI 基路径 → 当日 dated 文件存在且可写
  - 相对路径相对 PROJECT_ROOT
  - 显式 destination 插日期
  - 注入 now 模拟跨日，连续 write 落到两个文件
  - stream object destination 不落盘
- [x] 补充 paths 与 channel 默认解析断言
- [x] 定向 logger/config/redaction 测试通过
- [x] 完整 `npm test` 通过

### 6. Issue / task wrap

- [x] 确认仓库不存在 `issue.md`，移除过时收尾要求
- [x] Phase 3 check / spec 回写 / 工作提交完成

## Completion Evidence

- 工作提交：`30fda83`（统一 `log/`、按日轮转、移除可配置日志路径）。
- channel 路由复核：CLI → `log/cli/`，后台 daemon → `log/daemon/`，foreground / bootstrap → stderr。
- 定向验证：logger/config/redaction 相关测试通过。
- 当前完整验证：`1187 passed`、`1 skipped`；`git diff --check` 通过；`npm run lint` 为仓库既有 `echo no-lint`。

## Validation commands

```bash
npx vitest run test/logger-destination.unit.test.js test/pbt/logger-redaction.pbt.test.js test/config.unit.test.js
# 若通过且改动稳定：
npm test
```

手工抽查（可选）：

```bash
# 清空或使用临时环境
node bin/pdd.js doctor --json
# 应产生 log/cli/YYYY-MM-DD.log，stdout 仅 envelope
```

## Rollback points

1. 仅改 paths 常量 → 易回退  
2. logger 轮转落地 → 单测保护  
3. 文档/gitignore → 最后提交  

## Risks

| 风险                                  | 缓解                                                                 |
| ------------------------------------- | -------------------------------------------------------------------- |
| pino destination 接口不全导致缓冲不刷 | 补 `flushSync`；测试写后读文件                                       |
| Windows 路径/日期                     | 用 path.join + 固定 pad 日期；CI/本地 Win 均可测                     |
| 测试污染仓库 `log/`                   | 单测用 tmp 基路径或 mock PROJECT_ROOT/注入 basePath；避免写真实 log/ |
| 默落盘改变开发者习惯                  | 文档说明；level 仍由 config 控制                                     |

## Order

1. paths  
2. logger + unit tests  
3. daemon 确认  
4. docs / gitignore / specs  
5. 全量相关测试  
