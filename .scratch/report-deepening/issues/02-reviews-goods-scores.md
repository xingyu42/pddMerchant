# 02: `diagnose reviews` 增加商品评分区块

**What to build:** 商家运行 `diagnose reviews` 时，在原有中差评、不满意标签和问题类型之外，看到平台「数据中心-评价数据」口径下每个商品近 30 日的有效评价数和描述 / 物流 / 服务三项平均分。新数据放在 `data.goods_scores`，固定为近 30 日，带自己的口径标签和 `window_days: 30`，在任何 `--days` 下都输出；headline 增加一行「近 30 日有效评价商品 N 个」。商品评分拉取失败时其余内容照常输出。字段、分页和失败规则见 `../spec.md`。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] `data.goods_scores` 含 `caliber`「数据中心-评价数据」、`window_days: 30`、`items`、`total`、`truncated`；每个商品含 `goods_id`（字符串）、`goods_name`、`review_count`、三项 `*_score_avg`（2 位小数）
- [x] 评价数为 0 的商品三项平均分输出 `null`
- [x] `--days` 取 30 / 60 / 90 / 180 时 `goods_scores` 内容相同，现有区块不变
- [x] 每页 10 条、最多 20 页；`total` 取首页的商品总数；取满 20 页仍有剩余时 `truncated: true` 并加 hint「商品评分列表已达 200 个商品上限，结果已截断」
- [x] 今日评价数、排名字段、未确认含义的三个字段、商品图片、商品状态不出现在输出里
- [x] headline 新增「近 30 日有效评价商品 N 个」，N 为评价数大于 0 的商品数
- [x] 拉取失败：`goods_scores` 为 `null`，hint「商品评分拉取失败」，退出码 0，不加 headline 行；命令整体成败仍只由原有三项数据决定
- [x] `data-contract-v2` 中该命令的 case 覆盖 `goods_scores`；CLI + fixture 测试和服务层测试覆盖以上行为，fixture 为合成数据
- [x] 报表文档、CHANGELOG、`.trellis/spec` 的服务契约与命令契约已同步
- [x] `npm run check` 通过
- [x] 真实账号验证（需先重新登录）：商品数、评价数与后台页面一致；顺带记录每页 20 / 30 / 40 条是否可用；结果写入 Comments

## Comments

- 2026-11-19 预先重构排查：没有需要单独先做的重构，不设 00 号工单。本单内顺手做的一处小泛化：评价列表现有的翻页采集（总数取首页、短页或取满即停、达上限标记截断）与商品评分的翻页规则相同，把端点、页大小和页数上限做成参数后复用。全仓另有 6 处手写翻页循环，停止条件各不相同（总数校验、请求间隔、按场景分批），不在本单统一。
- 2026-11-22 离线实现完成（待真号只读验证后收口）：完成 `REVIEWS_GOODS_SCORES`（含数组行校验与 `goodsId` / 数值字段 PUA 混淆检测）、`collectPages` 复用分页、视图投影与 `headline`、合成 fixture、adapter/view/service/e2e/`data-contract-v2` 测试；同步更新 `skills/pdd-cli/reports.md`、`skills/pdd-cli/SKILL.md`、`README.md`、`CHANGELOG.md`、`.trellis/spec/services/domain-service-contracts.md`（`command-contracts.md` 无 `diagnose reviews` 单独条目且无新增选项，无需修改）。`npm run check` 通过（knip lint 通过，127 个测试文件，2159 项通过、1 项跳过）。
- 2026-11-22 真实账号验证（只读，仅记录条数、评价数、均分与分页结果）：
  - 触发账密自动重登后恢复登录态，`diagnose reviews`（默认 30 天）成功返回：`headline` 为「近 30 天中差评 1 条」「近 30 日有效评价商品 1 个」，`keyword_tags` 满意 10 个、不满意 0 个，`issue_types` 5 项，`negative_reviews.total` 为 1，`hints` 为空。
  - `goods_scores` 口径为「数据中心-评价数据」、`window_days: 30`、`total: 2`、`truncated: false`：2 个商品的 `review_count` 分别为 0（三项均分均输出 `null`）与 42（描述 / 物流 / 服务均分均为 4.83）；`--days 60` 下 `window_days` 变为 60，`goods_scores` 完全不变（仍为 `window_days: 30`、2 个商品 0 与 42 条）。
  - 与后台 `/sycm/goods_quality/comment` 页面「近 30 日存在有效评价的商品」表格核对：展示共 2 行，近 30 日评价数分别为 0 与 42，商品数及评价数与 CLI 一致（页面未显示三项均分列，由接口返回）。
  - `queryGoodsEvaluateVO` 分页大小实测：`pageSize` 20 成功（`success: true`、`errorCode: 0`、`total: 2`、`count: 2`）；`pageSize` 30 与 40 均返回 `errorCode 3000000`「分页参数异常」。CLI 仍保持保守的每页 10 条（未改代码）。
