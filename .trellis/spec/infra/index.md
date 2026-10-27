# Infra Spec Index

Infra 层拥有横切契约：envelope、exit codes、错误映射、日志脱敏、路径/env、timeout/abort 与账号存储基础能力。上层可以调用 infra，但 infra 不认识业务 domain。

## 文件

| 文件                                                     | 内容                                                  | 使用场景                |
| -------------------------------------------------------- | ----------------------------------------------------- | ----------------------- |
| [envelope-errors-output.md](./envelope-errors-output.md) | 输出 envelope、exit codes、`PddCliError`、JSON purity | 改输出/错误/退出码      |
| [logging-redaction.md](./logging-redaction.md)           | pino logger、SHA256 指纹脱敏、禁止 raw secret         | 改日志、debug、敏感字段 |
| [env-paths.md](./env-paths.md)                           | 环境变量、数据库/log/fixture/data 路径、配置边界      | 新增 env/path/config    |
| [sqlite-storage.md](./sqlite-storage.md)                 | SQLite 库、主密钥、secret-box、账号租约 + CAS、账号表 | 改账号/登录态/凭据存储  |

## Pre-Development Checklist

- [ ] 修改输出或错误前确认 envelope 顶层仍是 `{ ok, command, data, error, meta }`。
- [ ] 退出码只使用 0-7，错误使用 `PddCliError` 映射。
- [ ] `--json` stdout 不允许混入日志、进度、人类提示。
- [ ] 任何可能含 cookie、Anti-Content、authorization、二维码、联系人或图片的字段必须脱敏。
- [ ] `data/pdd.db`、`data/master.key`、日志不得提交或暴露；输出中不出现库/密钥路径。
- [ ] 只有 `src/infra/db.js` import `node:sqlite`；事务内不 await。

## Quality Check

- [ ] `meta.warnings` 是唯一允许扩展的 envelope 顶层相关附加信息入口。
- [ ] logger/output 使用同一套敏感字段规则。
- [ ] `PDD_DEBUG_RAW=1` 只写 redacted stderr JSONL，不影响 stdout envelope。
- [ ] 新 env 有默认值、验证规则、测试与文档。
