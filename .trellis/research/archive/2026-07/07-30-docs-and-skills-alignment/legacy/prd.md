# 统一整理与更新项目文档

## Goal

以当前代码、配置和可执行命令为唯一事实来源，统一整理项目的用户文档、开发文档和技能说明，消除已经确认的错误、遗漏和相互冲突，建立可发现且便于持续维护的文档结构。

## Background

- 当前文档漂移不是单点问题，涉及 README、架构说明、环境变量示例、测试说明、根 `skills/` 和 `.agents/skills/`。
- 已确认 `docs/architecture-overview.md` 仍列出不存在的 `shops switch`、`orders export`、`promo detail`、`diagnose goods`，并遗漏部分现有命令。
- 已确认账号文档混用了显示名、手机号、昵称与实际落盘 slug，且遗漏无注册表时的 `default` 回退和显式路径覆盖语义。
- 已确认部分开发说明仍使用 `npx playwright install chromium`，而项目实际依赖并使用 Patchright。
- 已确认部分日志说明没有区分 CLI/daemon 固定文件日志与 foreground stderr。
- 已确认 PBT 文档声称排除 `fast-check`，但依赖和测试代码实际仍在使用。
- 已确认根 `skills/pdd-cli/SKILL.md` 和项目技能存在选项遗漏、旧路径与运行时说明漂移。
- 当前工作区已有用户未提交的 `.gitignore`、`AGENTS.md`、`CLAUDE.md`；任务不得覆盖或回退无关修改。

## Requirements

### R1. 建立代码到文档的事实基线

- 命令、子命令和参数以 `bin/pdd.js`、`src/commands/registry/` 与对应处理器为准。
- 配置、环境变量、账号路径和日志行为以实际读取点、resolver、schema 与 logger 实现为准。
- 安装、测试和开发命令以 `package.json`、Vitest 配置及当前依赖为准。
- 所有动态数量和生产状态不得凭旧文档推断；必要时通过实际命令验证。

### R2. 修正文档中的确认错误

- 校正架构文档中的失效、遗漏或更名命令。
- 统一 Patchright/Playwright 安装口径。
- 统一商家和消费者 auth-state、账号目录、registry、`default` 回退、slug 与显式环境变量覆盖说明。
- 统一 CLI、daemon、foreground 日志去向，并明确 `PDD_LOG_DESTINATION` 当前不受支持。
- 重写 PBT 说明，准确区分自研 harness 与 `fast-check` 测试，移除不存在或不可发现的引用。

### R3. 补齐细节遗漏

- README 和根 skill 补齐 `--consumer-account`。
- 核对并补齐 `goods segment`、`promo roi` 等命令的现有选项。
- 核对 `.env.example` 对消费者登录态变量的用途说明，不得只限定为 goods publish。
- 判断 `PDD_ALLOW_INSECURE_AUTH_STATE` 是否应进入环境变量示例，并明确安全边界。
- 开发说明必须明确 `npm run lint` 当前只是占位命令，不得表述为真实 lint 校验。

### R4. 整理文档入口和归属

- 在主入口提供简洁文档索引，使架构、领域上下文、ADR、接口分析、研究材料和测试契约可发现。
- 架构总览只保留当前结构；历史迁移或已删除实现移动到合适的历史说明，或明确标记为历史。
- 研究文档保留日期和结论时效，不把旧研究结论描述为当前运行状态。
- 纳入根目录 `AGENTS.md` 与 `CLAUDE.md`，只修正安装、路径、配置、日志、测试等项目事实，保留用户的工作流、协作方式和回答偏好。
- 不为整理而大规模改写稳定且正确的领域研究内容。

### R5. 技能文档必须纳入同等级核验

- 覆盖 `skills/pdd-cli/SKILL.md` 及所有声明项目运行、命令、测试、认证、账号或日志事实的 `.agents/skills/**/SKILL.md`。
- 覆盖声明当前依赖、测试或运行事实的 `.trellis/spec/**` 项目规范；这不包括 Trellis 工作流实现。
- Trellis 工作流技能若不声明项目行为，只做范围确认，不进行无意义改写。
- 技能文档中的命令、路径、环境变量和安全约束必须与面向用户的文档保持一致。

### R6. 防止“主干正确、细节遗漏”

- 建立逐项核对矩阵：事实主题、代码来源、所有文档落点、修改结果、验证方式。
- 每个确认问题必须同时搜索同义旧表述和旧路径，不能只修首次发现的位置。
- 修改后反向检索已删除命令、旧路径、旧环境变量语义和冲突安装命令。
- 重点抽查示例命令中的次要参数、默认值、作用范围和例外分支。

## Acceptance Criteria

- [x] AC1: 当前命令树与 README、架构文档、根 skill 的命令清单一致，不再出现已删除命令。
- [x] AC2: `--consumer-account` 以及已确认遗漏的 goods/promo 参数在相应入口准确可见。
- [x] AC3: 所有全局账号路径说明准确区分商家/消费者、registry/default、slug 和显式覆盖。
- [x] AC4: 安装命令统一为当前项目实际支持的 Patchright 流程。
- [x] AC5: 日志说明准确区分 CLI、daemon、foreground，且不宣称支持已移除的日志目的地配置。
- [x] AC6: PBT 文档准确反映自研 harness 与 `fast-check` 的实际共存情况，不再引用不存在的根 `design.md`。
- [x] AC7: 主文档提供清晰索引，专项研究和 ADR 可发现且时效边界明确。
- [x] AC8: 所有相关 `skills/`、`.agents/skills/` 与项目事实类 `.trellis/spec/` 已按事实矩阵核对，确认无遗漏后才能完成任务。
- [x] AC9: 反向搜索不再命中已确认的错误表述；任何保留命中都有明确合理原因。
- [x] AC10: 运行文档相关快速验证和最相关测试；若执行全量测试，结果如实记录，不用占位 lint 冒充质量门禁。
- [x] AC11: `git diff --check` 通过，最终 diff 不包含对用户无关 WIP 的回退或覆盖。
- [x] AC12: `AGENTS.md` 与 `CLAUDE.md` 的项目事实已校正，用户自定义工作流和协作规则保持原样。

## Out of Scope

- 不改变 CLI、账号存储、日志、测试或浏览器运行时行为来迁就旧文档。
- 不新增产品功能，不重构业务代码。
- 不修改 Trellis 工作流本身。
- 不承诺发布新版本；`package.json` 与 CHANGELOG 的版本策略只记录问题，除非用户明确要求统一版本。
