# Design: 统一 log/ + 默认文件 + 按天轮转

## Boundaries

| 模块                                                       | 职责                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/infra/paths.js`                                       | 导出 `LOG_DIR`、`CLI_LOG_DIR`、`DAEMON_LOG_DIR` 固定目录常量                                              |
| `src/infra/logger.js`                                      | 按 channel 选择固定目录、创建父目录、按本地日轮转                                                         |
| `src/infra/config.js`                                      | 不再公开 `logDestination` 配置                                                                             |
| `bin/pdd.js`                                               | 继续 `createLogger({ level, config })`；依赖 logger 默认落盘                                             |
| `bin/pdd-daemon.js`                                        | 后台默认使用 daemon 基路径；foreground 无配置时不传 file destination                                     |
| `.gitignore` / docs / `.env.example` / Trellis infra specs | 路径与行为文档                                                                                           |

不改：redaction 列表、fingerprint 算法、envelope 输出、业务 command 打点方式。

## Path constants

```text
LOG_DIR            = <PROJECT_ROOT>/log
CLI_LOG_DIR         = <LOG_DIR>/cli
DAEMON_LOG_DIR      = <LOG_DIR>/daemon
```

实际文件为对应 channel 目录下的 `YYYY-MM-DD.log`。

## Destination resolution algorithm

```
resolveDatedLogPath(logDirectory, date = now local):
  // e.g. /proj/log/cli + 2026-07-20 -> /proj/log/cli/2026-07-20.log
```

### createLogger destination selection

输入：内部测试 `destination` 或运行 channel。

| 场景                                                     | 结果                                        |
| -------------------------------------------------------- | ------------------------------------------- |
| 传入 `destination` 且为 stream/对象（测试用）            | 原样使用，不轮转、不 mkdir                  |
| 传入 `destination` 为 string 目录（内部/测试）           | 目录内按日轮转 + mkdir                       |
| `channel: 'foreground'`                                  | stderr                                      |
| `channel: 'daemon'`                                      | `DAEMON_LOG_DIR`                            |
| `config` 存在且无特殊 channel（CLI）                     | `CLI_LOG_DIR`                               |
| 无 config、level silent 等 bootstrap                     | 保持现有 stderr destination（不落盘）       |

`bin/pdd-daemon.js` 调整：

```js
createLogger({
  level: config.logLevel,
  config,
  channel: isForeground ? 'foreground' : 'daemon',
});
```

foreground 明确走 stderr，后台 daemon 明确走固定 daemon channel。

## Daily rotation (no new dependency)

不引入 `pino-roll`：用薄封装满足「按天 + 跨日切换」。

```js
// 伪代码
class DailyRotatingFileDestination {
  constructor(basePath, { now = () => new Date(), mkdirSync } = {}) { ... }
  write(chunk) {
    this.#ensureStreamFor(this.#todayKey());
    return this.stream.write(chunk);
  }
  flushSync / end / destroy  // 委托给当前 sonic-boom 或 fs stream
  #ensureStreamFor(dayKey) {
    if (dayKey === this.dayKey && this.stream) return;
    // close previous best-effort
    // mkdirSync(dirname(file), { recursive: true })
    // this.stream = pino.destination({ dest: datedPath, sync: false })
  }
}
```

要点：

- **日期键**：本地时区 `YYYY-MM-DD`（`Intl` 或手动 pad，避免 UTC 跨日偏移误解）。
- **切换时机**：每次 `write` 检查（daemon 低频写也足够；无需定时器）。
- **测试注入**：`createLogger({ ..., now: () => fakeDate })` 或 destination 工厂可注入 `now`。
- **兼容 pino**：对象需实现 pino destination 最小接口（`write`；按 pino 版本需要时补 `flushSync`）。现有测试用 `{ write(chunk){} }` 已证明 pino 接受 plain object destination。

## Sync vs async

`createLogger` 保持 **同步** API（`bin/pdd.js` / daemon / 测试均同步调用）。

- 目录创建用 `mkdirSync(..., { recursive: true })`。
- 不把 `ensureDir`（async）塞进热路径。

## Compatibility

| 项                                  | 策略                                 |
| ----------------------------------- | ------------------------------------ |
| 旧 `data/daemon.log`                | 不读不迁；文档说明新路径             |
| 旧环境变量 `PDD_LOG_DESTINATION`    | 不再映射，不影响固定路径             |
| 旧本地配置键 `logDestination`       | 严格 schema 拒绝；不做迁移兼容       |
| redaction / withOp                  | 不变                                 |
| config schema                       | 不变（仍 optional string file path） |
| JSON purity                         | 日志只进文件/stderr，不进 stdout     |

## Tradeoffs

| 方案                            | 取舍                                                 |
| ------------------------------- | ---------------------------------------------------- |
| 自研 DailyRotating vs pino-roll | 零新依赖、行为可控；需自测 flush/跨日                |
| 默认落盘 vs stderr              | 满足 B；调试时需看 `log/` 或提高 level               |
| 全量保留按天文件                | 实现简单；磁盘由用户自行清理                         |
| 固定 channel 目录               | 行为单一、可预测；不支持运行时改路径                 |

## Rollout / rollback

- 前向兼容：仅改变默认落点与文件名形态。
- 回滚：恢复 CLI stderr 默认与 daemon 的旧 `data/daemon.log`。
- 无需数据迁移脚本。

## Docs / spec touch list

- `.gitignore` → `log/`
- `.env.example` → 说明固定 `log/cli/YYYY-MM-DD.log` 与 `log/daemon/YYYY-MM-DD.log`
- `README.md` / `docs/architecture-overview.md`（修正错误默认 `stdout`）
- `.trellis/spec/infra/logging-redaction.md`、`env-paths.md`
- 可选：`skills/pdd-cli/SKILL.md`、`.agents/skills/pdd-local-development/SKILL.md` 中路径一句
