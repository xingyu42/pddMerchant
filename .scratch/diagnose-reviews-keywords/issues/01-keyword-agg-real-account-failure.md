# 01: `diagnose reviews` 的评价标签聚合在真实账号上拉取失败

**What to build:** 查明 `reviews.keywordAgg` 在真实账号上失败的原因并修复，让 `diagnose reviews` 的 `keyword_tags` 能输出平台标签聚合。

**Blocked by:** None（需要真实账号只读运行，执行前确认范围；当前登录态已失效，需先重新登录）

**Status:** resolved

## 现象

2026-11-18，默认账号，`diagnose reviews`（30 天，`--timeout 150000`）：

- `ok: true`，退出码 0，`meta.warnings` 为空
- `keyword_tags: null`，`hints: ["评价标签聚合拉取失败"]`
- 同一次运行里 `issue_types` 有 5 项，`negative_reviews.total` 为 0，说明导航、登录态、时间窗口参数都正常，失败只发生在标签聚合这一个端点
- `log/cli/<UTC 日期>.log` 里没有记录失败原因

## 已知事实

- 端点定义：`src/adapter/endpoints/reviews.js` 的 `REVIEWS_KEYWORD_AGG`，POST `/saturn/reviews/keywords/agg`，请求体 `{ startTime, endTime, rangeType }`，成功码 `1000000`
- `normalize`：`positiveKeywordList` / `negativeKeywordList` 为 `null` 时按空列表读取；**键缺失**时抛结构异常
- 服务层（`src/services/reviews.js` `getReviewsView`）用 `report.optional('keywords_unavailable', …)` 采集，普通 `PddCliError` 会降级成 hint，错误码不会出现在 envelope 里
- 请求体最初是根据页面 bundle 推断的（`docs/research/traffic-cs-review-recon-2026-10-31.md` 6.1）
- `goods reviews` 那次改动没有碰这个端点和它的请求体

## 待查方向（均未验证）

- 响应里某个列表键缺失，或 `result` 整体为 `null`
- 成功码或外壳与 `type/agg` 不同
- 上游返回了业务错误

## 排查方法

`PDD_DEBUG_RAW=1 node bin/pdd.js diagnose reviews --json`，stderr 会输出脱敏后的原始载荷（JSONL），stdout 的 envelope 不受影响。只记录响应结构，不记录标签以外的评价正文。

- [ ] 记录真实响应的外壳、`result` 的键和各键类型
- [ ] 定位失败发生在成功判定、结构校验还是上游业务错误
- [ ] 修复，并补一份还原真实形态的合成 fixture 用例
- [ ] 真实账号重跑，`keyword_tags` 非 `null`，或者把上游确实不可用的原因写进 hint 文案
- [ ] 评估可选采集降级时是否应把错误码写入日志，方便下次定位

## Comments

- 2026-11-19：从 `goods reviews` 真实账号复验中发现并单独立项。
- 2026-11-19 更正：立项有误，这个问题已在 `2006790` 修复。原因是店铺没有不满意标签时平台返回 `negativeKeywordList: null`，原实现判为结构异常并降级成提示；现按空列表读取（见 CHANGELOG「`diagnose reviews` 标签聚合」）。上面「现象」记录的是修复前的那次运行，「待查方向」已无需排查。修复后的真实账号结果记在 journal Session 51：满意标签 10 个、`keyword_tags.negative` 为 `[]`、`hints` 为空。清单里「可选采集降级时把错误码写入日志」一项没有做，需要时另行立项。
