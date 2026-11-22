# PRD：商品评价确定性过滤（`pdd goods reviews`）

Status: ready-for-agent

来源：2026-11-22 设计访谈与只读实测（见 `docs/research/reviews-filter-recon-2026-11-22.md`、`GLOSSARY.md` 与 `docs/adr/0005-goods-reviews-deterministic-filtering.md`）。

## Problem Statement

商家与下游 Agent 使用 `pdd goods reviews` 拉取商品评价明细时，虽然上游评价列表接口本身已排除纯系统默认评价，但返回结果里仍混杂大量无可读内容的条目：后端自动填充的 **Platform Placeholder Review（平台占位评价）**（如 `status === 4` 对应的「该用户觉得商品很好，给出了5星好评」「该用户觉得商品较好」）、空正文、纯标点或纯 Emoji、纯数字串、单字重复水评，以及按隐私契约已剥离 URL 后模型无法查看画面的 4–5 星纯图评或纯视频评。在评价量较大的店铺或单品下，这些条目占据大量输出篇幅与上下文 Token，增加了人工排查与自动化分析的噪音。

同时，`pdd-cli` 遵循事实报告与零外部 AI 依赖边界，需要在不引入 LLM、不做主观词库打分的前提下，稳定地把真正有可读内容或负面评分事实的评价筛出来，并与拼多多数据中心官方口径的「有效评价」保持清晰区分。

## Solution

对 `pdd goods reviews` 默认启用确定性内容过滤，只保留 **Substantive Review（实质内容评价）**——即主评或追评带有买家自填有效文字（排除平台占位文案、空白、标点、符号、Emoji、纯数字及长度 `>= 2` 的单字重复），或属于 **Negative Review（中差评）**（有效评分 `<= 3` 星，含历史评分）。

- 默认模式无需额外参数即返回过滤后的实质内容评价，同时原样保留平台过滤前总数 `total`，并新增 `fetched_count`、`filtered_out_count` 与 `filter` 规则回显，在 `headline` 中同步报出平台总数与保留条数。
- 提供 `--all` 跳过内容过滤、输出完整采集列表，保留原有全量查询能力。
- 提供 `--min-length <n>` 严格按清洗后主评或追评有效字数 `>= n` 筛选长文本评价（与 `--all` 互斥）。
- 过滤在本地对已采集列表无损执行，避免上游筛选丢掉无文字 1–3 星中差评或在零命中时将 `totalNum` 清零导致丢失平台总数。
- `diagnose reviews` 维持原有完整中差评诊断视图，不做默认过滤，对外单条评价字段白名单保持兼容。

## User Stories

1. 作为商家，我希望运行 `pdd goods reviews` 时默认过滤掉平台自动填充的 4–5 星 **Platform Placeholder Review（平台占位评价）**，以便直接看到买家自己写下的评价内容。
2. 作为下游 Agent，我希望默认输出里不再包含 `status === 4` 的系统预设好评模板，以便显著减少无效上下文 Token 消耗。
3. 作为维护者，我希望即使夹具或历史响应缺失 `status` 字段，已知的后端与前端平台占位模板（含「给出了5星好评」与「给出去了5星好评」等变体）仍能被确定性识别，以便行为在实测与离线夹具间保持一致。
4. 作为商家，我希望默认过滤剔除主评与追评均为空或纯空白的 4–5 星评价，以便列表保持紧凑。
5. 作为商家，我希望默认过滤剔除仅由标点、符号或 Emoji 构成的 4–5 星评价，以便不再逐条翻阅纯表情好评。
6. 作为商家，我希望默认过滤剔除纯数字串（如 `666`、`111111`）构成的 4–5 星评价，以便过滤常见凑数评价。
7. 作为商家，我希望默认过滤剔除清洗后全部字符相同且长度 `>= 2` 的单字重复文本（如「好好」「谢谢」「好好好」「哈哈哈哈」「aa」「AaAa」，含夹杂标点/Emoji 的「好！好！」），以便去掉重复字符水评。
8. 作为商家，我希望单字真实评价（如「差」「假」）以及含有效汉字或字母的非重复短评（如「破了」「尺码小」「38码」）在默认模式下被保留，以便不误杀极短但有信息的反馈。
9. 作为商家，我希望当一条评价主评为平台占位文案或空正文、但追评（`append_comment`）带有买家自填有效文字时，该条评价仍被保留，以便不错过后续追评暴露的问题。
10. 作为商家，我希望 1–3 星的 **Negative Review（中差评）** 即使主评为空或属于 `status === 4`（「该用户未填写文字评价」）且无追评，在默认模式下依然被保留，以便不错过任何无文字负面评分事实。
11. 作为商家，我希望使用历史评分（`desc_score` 为 `null`、`history_score <= 3`）的老评价同样按中差评兜底保留，以便历史低星记录不被误删。
12. 作为下游 Agent，我希望无买家自填正文的 4–5 星纯图评、纯视频评与仅带平台标签的评价在默认模式下被剔除，以便上下文里不再出现因 URL 脱敏而无法查看内容的空壳条目。
13. 作为商家，我希望被保留下来的评价继续原样输出既有的 `picture_count`、`tags`、`replied` 等事实字段，以便结合图文数量与回复状态判断后续跟进动作。
14. 作为商家，我希望保留下来的静默中差评（如 `status === 4` 的 3 星评价）仍保留其原始 `comment` 文本（如「该用户未填写文字评价」），以便输出忠实于平台原文。
15. 作为商家，我想通过 `--all` 跳过默认过滤并拿到当前窗口内全部采集到的评价，以便在需要核对全量原始明细时随时切换。
16. 作为商家，我希望 `--all` 模式下 `filtered_out_count` 为 `0`、`filter` 明确回显全量模式，且 `headline` 保持原有未过滤陈述格式，以便与旧习惯无缝衔接。
17. 作为商家，我想通过 `--min-length <n>` 只查看主评或追评清洗后有效字数达到 `n` 字及以上的评价，以便聚焦详细的使用体验与问题反馈。
18. 作为下游 Agent，我希望传入 `--min-length <n>` 时严格按有效字数门槛筛选、不再混入零字数的无文字中差评，以便输出严格符合长度预期。
19. 作为脚本作者，我希望 `--all` 与 `--min-length` 同时传入时命令立即返回用法错误（`E_USAGE`，退出码 2）且不发起上游请求，以便尽早发现参数冲突。
20. 作为脚本作者，我希望 `--min-length` 传入 `0`、负数、小数或非数字时命令立即返回用法错误（`E_USAGE`，退出码 2）且不发起上游请求，以便参数校验可预测。
21. 作为商家，我希望 `--all` 和 `--min-length` 能与现有的 `--days`、`--goods-id`、`--stars`、`--json`、`--all-accounts` 自由组合，以便覆盖单品、指定星级与多店铺批量查询。
22. 作为下游 Agent，我希望 `total` 始终保持平台返回的过滤前总数，`fetched_count` 报告本次翻页实际采集条数，`filtered_out_count` 报告本次被过滤规则剔除的条数，以便明确区分「过滤剔除」和「平台 2000 条截断」。
23. 作为商家，我希望当平台总数超过 2000 条触发截断时，`fetched_count` 为 `2000`、`items.length + filtered_out_count === 2000`，且截断提示行准确报告已采集 2000 条而非过滤后条数，以便不被误导采集规模。
24. 作为自动化脚本作者，我希望输出顶层带有 `filter` 对象（包含 `mode` 与 `min_length`），以便下游解析器仅凭 JSON 就能确认这份列表经过了哪种确定性过滤。
25. 作为商家，我希望终端 `headline` 在默认过滤模式下同时给出平台总数与实质内容条数，在 `--min-length` 模式下给出平台总数与达标条数，以便一眼看清过滤比例。
26. 作为商家，我希望 `diagnose reviews` 不受本次默认过滤影响、继续返回完整中差评列表与聚合指标，以便店铺级诊断报告的口径保持连续。
27. 作为注重隐私的使用者，我希望内部用于识别占位的 `status` 字段不进入对外输出，且手机号脱敏、图片/视频 URL 与买家 PII 剔除规则保持原样，以便输出可安全留档与交给模型。
28. 作为维护者，我希望过滤完全基于客观确定性规则，不包含主观中文好评词表或外部 AI 调用，以便同样输入在任何环境下都得到完全一致的输出。
29. 作为维护者，我希望所有术语与文档严格使用术语表中的 **Substantive Review**、**Platform Placeholder Review** 与 **Negative Review**，避免与拼多多数据中心官方「有效评价」混淆。

## Implementation Decisions

### 领域边界与架构定位

- 严格沿用领域术语表中的 **Substantive Review（实质内容评价）**、**Platform Placeholder Review（平台占位评价）** 与 **Negative Review（中差评）**，不与数据中心官方「有效评价」混用；全部设计遵循 ADR 0005。
- 过滤逻辑保持纯确定性，零外部 AI/LLM 依赖，不内置「好评」「不错」「可以」等主观中文短语黑名单。
- 过滤仅作用于 `goods reviews`；`diagnose reviews` 的服务逻辑、参数、数据结构与 `headline` 保持完全不变。

### 命令接口与参数校验（命令注册层与命令入口）

- 在 `goods reviews` 命令上新增两个选项，保留既有 `--days`、`--goods-id`、`--stars` 选项与行为：
  - `--all`：布尔开关，关闭确定性过滤，返回全部采集到的评价。
  - `--min-length <n>`：正整数参数（最小值为 `1`），开启严格有效字数门槛筛选。
- 在命令入口与服务层入口均做前瞻校验（不触发浏览器启动或上游请求）：
  - `--min-length` 非整数或小于 `1` 时抛出 `E_USAGE`（退出码 `2`）。
  - 同时传入 `--all` 与 `--min-length` 时抛出 `E_USAGE`（退出码 `2`），提示两项互斥。
- 支持既有 `--json` 与 `--all-accounts` 批量执行，单行 JSON 与 v2 envelope 契约不变。

### 适配层规范化（评价列表端点规格 `REVIEWS_LIST`）

- 继续向上游 `/saturn/reviews/list` 发送无内容筛选的请求体（仅转发时间窗口、分页、`descScore` 与 `goodsId`），不下推 `mainReviewContentStatus` 或 `appendStatus`，确保：
  - 不因 `descScore` 与 `contentFilter` 的服务端 AND 交集而漏掉无文字 1–3 星中差评；
  - 不因服务端零命中时 `totalNum` 归零而丢失过滤前平台 `total`；
  - 本地可统一执行字符级清洗与 `--min-length` 判定。
- 评价项规范化函数新增提取上游 `status`：存在有限整数时保留该整数，缺失或无效时记为 `null`（向后兼容未填 `status` 的既有夹具）。
- `status` 仅在服务层与视图层内部使用，不加入对外 `REVIEW_FIELDS` 白名单；不新增 `has_video` 或任何媒体 URL 字段。

### 确定性清洗与保留判定（评价服务层与视图层）

- **平台占位判定（仅作用于主评 `comment`）**：
  - 满足上游 `status === 4`，或主评 `trim()` 后精确命中已知平台占位模板集合时，主评有效字数直接计为 `0`：
    - 后端实测模板：`该用户未填写文字评价`、`该用户觉得商品较好`、`该用户觉得商品很好，给出了5星好评`
    - 前端空正文兜底同族模板：`该用户觉得商品稍有不足`、`该用户觉得商品不符合预期`、`该用户觉得商品一般`、`该用户觉得商品很好，给出去了5星好评`
  - 追评文本（`append_comment`）独立判定，不受主评 `status === 4` 影响。
- **有效字符提取与重复判定**：
  - 对非占位文本提取全部 Unicode 字母与汉字（`\p{L}`），天然剔除空白、标点、符号、Emoji 与数字（`\p{N}`）。
  - 若提取结果为空，有效字数为 `0`。
  - 将提取字符转为小写后，若长度 `>= 2` 且所有字符完全相同（单字重复），有效字数计为 `0`；长度为 `1`（如「差」「假」）不视为重复，有效字数为 `1`。
  - 其余情形有效字数为提取到的字符个数。
- **三种过滤模式**：
  - 默认模式（`mode: 'substantive'`，`min_length: 1`）：主评有效字数 `>= 1`，或追评有效字数 `>= 1`，或有效评分 `<= 3`（历史评分非 0 时取 `history_score`，否则取 `desc_score`）即保留；仅带图片、视频或平台标签的 4–5 星条目不构成保留条件。
  - 长文本模式（`mode: 'min_length'`，`min_length: n`）：仅当主评有效字数 `>= n` 或追评有效字数 `>= n` 时保留，不适用无文字中差评兜底。
  - 全量模式（`mode: 'all'`，`min_length: null`）：保留全部已采集条目。
- 保留下来的条目照旧对 `comment` 与 `append_comment` 执行手机号脱敏，保留平台原文（例如被兜底保留的 `status === 4` 三星评价仍输出其原始文案）。

### 输出数据结构与 `headline`（`goods reviews` 视图）

- 单条评价白名单 `REVIEW_FIELDS` 保持完全不变（11 个既有字段，不含 `status`）。
- 顶层保留全部既有字段（`headline`、`items`、`total`、`truncated`、`window_days`、`goods_id`、`stars`、`hints`、`mall_id`），新增 3 个顶层字段：
  - `fetched_count`：本次翻页从上游实际采集到的条目数，恒满足 `fetched_count === items.length + filtered_out_count`。
  - `filtered_out_count`：本次被过滤规则剔除的条目数（`all` 模式下恒为 `0`）。
  - `filter`：生效过滤规则回显对象，固定字段集 `{ mode, min_length }`，其中 `mode` 取值 `'substantive' | 'min_length' | 'all'`，`min_length` 在 `all` 模式下为 `null`，其余模式下为正整数阈值。
- `total` 始终保持上游首页返回的未过滤 `totalRows`；`truncated` 与截断提示仍按是否触达平台 2000 条查看上限判定。
- `headline` 生成规则：
  - `all` 模式：`近 ${days} 天${scope}${starsLabel}评价 ${total} 条`
  - `substantive` 模式：`近 ${days} 天${scope}${starsLabel}评价 ${total} 条，实质内容 ${items.length} 条`
  - `min_length` 模式：`近 ${days} 天${scope}${starsLabel}评价 ${total} 条，有效字数 ≥ ${min_length} 字 ${items.length} 条`
  - 当 `truncated` 为 `true` 时追加 `已采集 ${fetched_count} 条，结果已截断`（使用 `fetched_count` 而非过滤后的 `items.length`，避免在过滤开启时低报实际采集条数）。

### 文档与契约同步

- 同步更新 `goods reviews` 命令说明、面向 Agent 的 CLI 技能文档（命令速查与报表参考）、服务与命令契约文档；实现并完成验收后，将 ADR 0005 的状态更新为 `Accepted`。

## Testing Decisions

- 好的测试只验证外部行为：CLI 退出码、envelope `data`、计数字段关系、`headline`、`error.code`、零请求校验、隐私脱敏与端点规范化边界，不断言内部文本清洗辅助函数的实现细节。
- 零新增接缝，全程复用现有测试接缝：
  - **主接缝（最高层）：CLI E2E + Fixture Adapter**。通过隔离 CLI 运行器与合成夹具覆盖完整链路：
    - 默认 `substantive` 模式：验证剔除 `status === 4` 平台占位、缺失 `status` 时的前后端精确占位模板、空/纯空白、纯标点/Emoji、纯数字、长度 `>= 2` 单字重复（含大小写与混入标点）以及 4–5 星纯图/纯视频/纯标签条目；验证保留单字评价（「差」「假」）、短非重复评价、主评占位但追评实质有效的条目、1–3 星静默中差评（含 `status === 4`）以及 `history_score <= 3` 老评价。
    - `--all` 模式：验证返回全部采集条目、`filtered_out_count === 0`、`filter` 回显与未过滤 `headline`。
    - `--min-length <n>` 模式：验证主评或追评达到清洗后有效字数门槛才保留、无文字 1–3 星中差评不再兜底保留，以及单字重复不计入有效字数。
    - 参数校验：`--all` 与 `--min-length` 互斥，以及 `--min-length` 取 `0`、负数、小数、非数字均返回退出码 `2`、`E_USAGE` 且 `xhr_count === 0`。
    - 截断核算：超过 2000 条时验证 `total` 为原始总数、`fetched_count === 2000`、`items.length + filtered_out_count === 2000`、`truncated: true`、截断 `headline` 报出 `已采集 2000 条` 并附带截断提示。
    - 隔离与隐私回归：验证 `diagnose reviews` 不受过滤影响、仍返回完整中差评列表且不含 `goods reviews` 新增过滤字段；验证 `status` 未泄露至输出、`REVIEW_FIELDS` 保持不变、手机号脱敏与私有字段剔除照常生效。
  - **契约接缝（复用现有契约套件）**：
    - `data-contract-v2` 契约套件中 `goods.reviews` 用例补充顶层 `filter` 对象的字段集约束，同时继续校验 `items[]` 严格等于 `REVIEW_FIELDS`。
    - 评价端点契约套件中补测 `REVIEWS_LIST` 规范化提取 `status` 及缺省回退 `null` 的行为。
  - **既有服务/视图测试同步**：更新评价服务与评价视图既有测试中受默认过滤及新增顶层计数字段影响的断言。
- Prior art：评价领域现有 E2E 测试、合成评价夹具工厂、评价端点契约测试、`data-contract-v2` 契约测试、评价服务与视图测试。
- 自动化验证默认在 `PDD_TEST_ADAPTER=fixture` 下运行；是否追加真实账号只读验收需另行与用户确认。

## Out of Scope

- 对 `diagnose reviews`（中差评汇总列表）施加默认或可选内容过滤。
- 向 `/saturn/reviews/list` 下推 `mainReviewContentStatus`、`appendStatus`、`pictureStatus`、`videoStatus`、`replyStatus` 等服务端内容筛选，以及按星级拆多路请求再按 `reviewId` 去重合并的优化方案。
- 向公开 `REVIEW_FIELDS` 新增 `has_video`、`status`、`audio.text` 或任何图片/音视频 URL 字段。
- 内置主观中文水评短语黑名单（如「好评」「不错」「可以」）、分词统计、情绪打分或接入外部 AI/LLM 过滤服务（如 Jev）。
- 当 `appendNum > 0` 时额外调用 `/saturn/reviews/append/list` 拉取更多追评。
- 新增 `--has-picture`、`--has-video`、`--has-append`、`--unreplied`、`--keyword` 等独立筛选选项。

## Further Notes

- 2026-11-22 只读实测（180 天基线 54 条评价 + 8 次只读重放对照，各轮均 `ok: true`、`warnings: []`）已确认：`status === 4` 100% 对应平台占位文案；`contentFilter` 组内参数为 OR 并集，与 `descScore` 为 AND 交集；服务端内容过滤命中 0 条时 `totalNum` 同步清零；按本次规则在 180 天实测样本上保留 42 条（40 条买家自填 + 2 条静默 3 星中评）、剔除 12 条（4–5 星平台占位）。
- 实测店铺近 365 天追评为 0 条，未能直接采集到 `appendReview` 非空时的真实响应对象，实现沿用既有适配层对字符串与对象（`comment` / `content` / `text`）的兼容提取及前端 `B95x` 模块观测结果；合成测试夹具须显式覆盖 `status === 4` 叠加字符串及对象形式 `appendReview` 的场景。
- 实测样本中观察到 `data[].audio` 含有 `{ url, text, duration }`，本次未验证 `audio.text` 是否已同步写入 `comment`，暂保持在范围之外。
- 若未来高评价量单品在 `--stars 4,5` 或 `--min-length` 场景频繁触达 2000 条截断，可在后续迭代再评估服务端下推配合首页未过滤总数的双请求优化。
