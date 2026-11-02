# 完善 config 配置管理命令

## Goal

新增面向人和脚本的 `pdd config` 命令，在不手工编辑 JSON 的情况下，查看、校验和修改项目内 `config/config.json`，同时复用统一配置契约并保持敏感配置只从环境变量读取。

## Parent Dependency

- 本子任务依赖父任务 `07-18-config-example-runtime-defaults` 完成后实施。
- 父任务负责 `config/config.example.json`、严格 Schema、分层加载、环境变量映射、`E_CONFIG_INVALID` 和普通 CLI/daemon 统一注入。
- 本子任务只提供配置管理命令和安全写入能力，不复制 Schema、默认值或优先级逻辑。

## Confirmed Facts

- 当前 CLI 没有 `pdd config`、`config set` 或 `config validate` 命令。
- `CONFIG_PATH` 固定指向项目内 `config/config.json`；不得新增用户目录、系统目录或项目外配置位置。
- 父任务确定的优先级是：基线示例配置 → 本地 `config.json` → 环境变量 → 本次 CLI 参数。
- `config.json` 是稀疏覆盖文件，不需要复制所有默认字段；敏感值和测试/安全开关不进入 JSON Schema。
- 项目已有 `PddCliError`、统一 envelope、日志脱敏和“临时文件写入后 rename”的原子落盘模式，应直接复用。

## MVP Command Surface

- `pdd config show`：显示已脱敏的有效配置、项目内本地覆盖及每个字段当前生效来源。
- `pdd config set <key> <value>`：按父任务 Schema 解析并校验单个公开字段，原子写入本地稀疏覆盖文件。
- `pdd config unset <key>`：删除本地覆盖，使该字段重新使用环境变量或基线；允许删除导致 Schema 失败的未知本地字段以便恢复。
- `pdd config validate`：分别校验基线文件、本地文件和环境变量层，返回可定位但不包含原始值的问题列表。

不在 MVP 中加入交互式编辑器、批量导入、项目外配置目录、秘密字段写入、`reset` 整文件删除或环境变量持久化。

## Requirements

### R1 命令注册与输出

- 新增独立 `config` 命令分组并接入现有 Commander 注册顺序。
- config 命令不需要登录态、店铺、浏览器或 endpoint，不得触发普通业务 runner 的鉴权流程。
- 人类输出清楚说明本地值、有效值和覆盖来源；`--json` 保持单行 `{ ok, command, data, error, meta }` envelope。
- `--help` 在任何配置文件缺失或损坏时仍可正常显示。

### R2 查看与校验

- `show` 只能显示父任务 Schema 中允许公开的字段；环境变量专用秘密、安全和测试字段永不进入结果。
- 当环境变量或显式 CLI 层覆盖本地值时，输出必须明确指出 `set` 已写入但当前未生效的原因。
- `validate` 必须绕过普通运行配置启动门槛，以便在配置错误时仍能报告各层问题。
- 配置错误使用 `E_CONFIG_INVALID`；detail 只包含层、项目相对路径、字段路径和原因，不包含原始配置值。

### R3 安全设置与删除

- `set` 只接受 Schema 已知、允许写入本地 JSON 的公开字段；字段值使用对应字段 Schema 做数字、布尔、枚举、URL 或字符串解析，禁止只按字符串落盘。
- `unset` 只修改本地覆盖，不修改基线示例文件、进程环境变量或 CLI 参数。
- 本地文件不存在时，`set` 创建目录和稀疏 JSON；`unset` 返回稳定的 no-op 结果，不创建空文件。
- 本地文件是合法 JSON 但 Schema 无效时，`set/unset` 可在修改后重新校验完整本地层，用于修复单字段问题。
- 本地候选对象合法后即可原子写入；若基线文件、环境变量或合并层仍有无关错误，命令返回写入成功并附带 `runtime_invalid_after_edit` 警告和安全问题列表，支持逐层修复。
- 本地文件 JSON 语法损坏或不可读时不得覆盖原文件；命令明确失败并提示先修复语法或恢复文件。
- 写入采用同目录临时文件、flush/close、rename 的原子替换模式；失败时保留原文件并尽力清理临时文件。

### R4 项目边界与兼容性

- 所有读写目标必须固定在项目 `config/` 内；解析后的目标路径、符号链接或目录联接指向项目外时立即拒绝。
- 不新增 `--config <path>`，不读取用户主目录、系统配置目录或当前工作目录之外的配置。
- `set/unset` 不需要 `--confirm`：它们只修改可回滚的本地稀疏覆盖；命令结果必须返回修改前后字段状态和本地文件相对路径。
- config 命令不自动停止或重启 daemon；普通 CLI 在下次进程启动时读取新值，daemon 相关字段变更返回 `restartRequired: true` 并提示显式重启后生效。
- config 命令不得打印或接受 `PDD_QINGGUO_AUTH_KEY`、主密码、代理用户名/密码/token 等秘密。

## Acceptance Criteria

- [x] `pdd --help` 出现 `config` 分组，`pdd config --help` 列出约定的 MVP 子命令。
- [x] `show` 同时返回本地覆盖、有效值和来源；环境变量覆盖时不会误报本地值已生效。
- [x] `set` 能按字段类型写入稀疏 JSON，未知字段或非法值返回 `E_CONFIG_INVALID`，且不改变原文件。
- [x] `unset` 能删除已知覆盖，也能移除导致校验失败的未知字段；字段不存在时稳定 no-op。
- [x] 本地候选合法但其他配置层无效时，`set/unset` 仍保存本地修改并返回 `runtimeValid: false` 与警告；不得误报整体配置已可运行。
- [x] `validate` 在示例文件、本地文件或环境变量层损坏时仍可执行，并给出不泄密的问题定位。
- [x] JSON 语法损坏或不可读的本地文件不会被 `set/unset` 覆盖。
- [x] 写入中断或 rename 失败时原配置保持完整，不留下会被 loader 误读的半文件。
- [x] 路径或符号链接试图逃逸项目目录时明确失败，项目外没有创建或修改文件。
- [x] daemon 相关配置修改不会隐式改变后台进程状态，结果明确报告需要重启；下一次普通 CLI 调用读取新配置。
- [x] 安全/测试开关和敏感字段不能通过 config 命令查看或写入。
- [x] `--json` 仍是单行标准 envelope，help baseline、config 单元/e2e 和完整 `npm test` 通过。

## Product Decision

- MVP 采用 `show + set + unset + validate` 四个子命令；诊断、查看来源和安全修复属于配置设置体验的一部分。
- 当本地候选配置合法但其他层仍有无关错误时，`set/unset` 完成本地写入并明确警告整体配置无效，以支持逐层修复。
- `set/unset` 无需额外 `--confirm`；命令在 Schema 校验后原子写入并明确回显结果。
- config 命令不自动重启 daemon；daemon 相关配置由结果提示显式重启后生效。
