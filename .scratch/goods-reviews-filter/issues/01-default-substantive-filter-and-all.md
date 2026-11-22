# 01: `pdd goods reviews` 默认实质内容过滤与 `--all` 全量切换

**What to build:** 商家或下游 Agent 运行 `pdd goods reviews` 时，默认仅返回 **Substantive Review（实质内容评价）**——自动剔除 4–5 星的 **Platform Placeholder Review（平台占位评价）**、空/纯空白、纯标点或纯 Emoji、纯数字、长度 `>= 2` 的单字重复，以及无买家自填正文的纯图评、纯视频评与纯标签好评；同时完整保留买家自填有效主评或追评、单字真实短评（如「差」「假」）以及全部 1–3 星 **Negative Review（中差评，含历史评分与无文字静默中差评）**。同步提供 `--all` 开关恢复全量采集结果；顶层输出保留过滤前平台总数 `total`，新增 `fetched_count`、`filtered_out_count` 与 `filter` 规则回显，并在 `headline` 同时报出平台总数与保留条数（触达 2000 条截断时准确报出已采集条数）。`diagnose reviews` 行为及公开评价项字段白名单保持不变。完整规格见 `../spec.md` 与 ADR 0005。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 默认调用 `pdd goods reviews` 启用 `substantive` 模式（`filter: { mode: 'substantive', min_length: 1 }`），过滤 4–5 星平台占位评价（`status === 4` 及缺失 `status` 时的后端/前端精确占位模板）、空/纯空白、纯标点/符号/Emoji、纯数字串、清洗后长度 `>= 2` 的单字重复（英文字母忽略大小写），以及无买家自填正文的 4–5 星纯图片、纯视频、纯标签条目
- [ ] 默认模式保留单字有效评价（如「差」「假」）、非重复短评（如「破了」「尺码小」「38码」）、主评占位或为空但追评（字符串或对象形式）含有效字符的条目，以及全部 1–3 星中差评（含 `status === 4` 静默中差评与 `history_score <= 3` 老评价），且保留条目的原始文案与手机号脱敏行为不变
- [ ] `pdd goods reviews --all` 跳过过滤并返回全部采集条目，`filtered_out_count` 为 `0`，`filter` 为 `{ mode: 'all', min_length: null }`，`headline` 保持原有未过滤格式
- [ ] `total` 保持上游首页返回的未过滤总数，`fetched_count` 为过滤前实际采集条数，恒满足 `fetched_count === items.length + filtered_out_count`
- [ ] 触达平台 2000 条查看上限（`truncated: true`）时，`fetched_count` 为 `2000`、`items.length + filtered_out_count === 2000`，`headline` 截断行按 `fetched_count` 报出「已采集 2000 条，结果已截断」并附带截断提示
- [ ] `REVIEWS_LIST` 继续发送无内容筛选的上游请求，内部规范化提取 `status`（缺失时回退 `null`），`status` 不进入对外 `REVIEW_FIELDS` 白名单；`diagnose reviews` 输出与行为保持完全不变
- [ ] 补齐 CLI E2E + 合成夹具测试、评价端点契约测试、`data-contract-v2`（`goods.reviews` 增加 `filter` 字段集校验）并更新受默认过滤影响的既有服务/视图测试，确保隐私脱敏与字段白名单回归通过
- [ ] `npm run check` 通过
