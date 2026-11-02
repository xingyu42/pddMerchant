# Design

## Boundary

本任务只更新文档、示例配置和项目技能说明，不改变运行时代码。代码与可执行配置是事实源，文档之间不得通过相互引用来证明正确性。

## Consistency Model

建立一份执行期核对矩阵，至少覆盖：

1. 命令树、全局参数、关键子命令参数和 dry-run/confirm 契约。
2. 安装命令、Node 版本、测试脚本、lint 实际能力和 CI 存在性。
3. 商家与消费者 auth-state、账号目录、registry、slug、default 和显式覆盖。
4. CLI、daemon、foreground 日志通道与禁止配置项。
5. PBT harness、fast-check、seed/runs 和测试发现规则。
6. README、架构、配置示例、专项文档、根 skill 和项目 skills 的对应落点。

每一行矩阵都包含代码证据、需更新文档、修改结果和反向检索关键词。矩阵作为实施检查手段，不新增长期维护工具。

## Document Structure

- `README.md` 保持用户入口，只放快速开始、稳定契约、常用配置和文档索引。
- `docs/architecture-overview.md` 只描述当前架构和命令域，不承载迁移流水账。
- `.env.example` 说明真实可用变量、用途和重要安全边界。
- `test/pbt/README.md` 说明当前两类 PBT 实现及复现方式。
- `skills/pdd-cli/SKILL.md` 面向调用者，保留完整但紧凑的 CLI 契约。
- `.agents/skills/pdd-*` 面向开发工作流，各自只声明职责范围内的事实，避免复制完整 README。
- `.trellis/spec/` 中的项目测试、依赖和运行契约必须同步当前事实；不改 Trellis 生命周期或平台工作流。
- ADR、recon 和 research 保持专项内容，通过索引提升可发现性。

## Compatibility And Risk

- 文档修改不产生运行时兼容风险，主要风险是错误地把局部行为写成全局规则，或漏改重复表述。
- 对账号路径、日志通道和安全变量采用“默认、显式覆盖、例外”三段式描述，避免只写常见路径。
- 对用户未提交的 `AGENTS.md`、`CLAUDE.md` 采用最小差异策略，只修正项目事实并保留用户自定义规则。
- 如代码证据互相冲突，停止文档修改并先报告，不通过猜测选择口径。

## Rollback

所有改动应按主题保持小范围 diff。若某一主题核验失败，只回退本任务对该主题文档的修改，不触碰用户原有 WIP。
