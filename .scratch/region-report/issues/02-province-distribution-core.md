# 02: 省级成团地域汇总主干（默认区间）

**What to build:** 按 `01` 敲定的命令入口与明文上游端点，端到端输出店铺默认区间的省级成团分布汇总（显式标注成团口径），按省输出省份名、成团金额 `_yuan`、成团订单数、成团买家数与客单价 `_yuan`（最终字段与单位以 `01` 结论为准），不含任何收件人、地址或手机号 PII。

**Blocked by:** 01

**Status:** needs-triage

- [ ] 输出遵循 `data` 契约 v2 并显式标明成团口径
- [ ] 仅白名单投影省级汇总字段，不含收件人、地址、手机号等 PII
- [ ] 命中私有区字体混淆字符时 fail-closed 报错
- [ ] 输出事实型 headline（无经营建议或评分）
- [ ] `data-contract-v2`、合成 fixture、adapter/service/view/e2e 测试覆盖主干输出与白名单过滤
- [ ] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [ ] `npm run check` 通过
- [ ] 真实账号只读验证（执行前确认范围）：省级汇总与后台页面一致；结果写入 Comments

## Comments

- 2026-11-22：已立项为 `needs-triage`，待 `01` 侦察定稿命令归属、请求体与字段单位后细化为 `ready-for-agent`。
