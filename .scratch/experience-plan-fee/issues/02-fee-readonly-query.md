# 02: 只读查询服务费

**What to build:** 新增只读命令，按时间窗口原样输出平台给出的消费者体验提升计划服务费。命令形态和字段由 01 的粒度决定。

**Blocked by:** 01

**Status:** needs-triage

- [ ] 金额 `_yuan`，时间 `_at`，缺失为 `null`；上游对象和 PII 不进入 `data`
- [ ] 未开通计划时给出事实性 headline，不报错
- [ ] 契约测试、`SKILL.md`、e2e fixture

## Comments
