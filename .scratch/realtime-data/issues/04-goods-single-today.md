# 04: `goods traffic --goods-id` 输出单商品今日实时汇总与小时趋势

**What to build:** `pdd goods traffic --goods-id <id>` 在 `data.today` 输出该单商品今日实时汇总与按小时累计趋势（上游 `/sydney/api/goodsDataShow/queryGoodsStatDtr` 的 `todayGoodsDetail` 与 `todayGoodsDetailList`），含 `snapshot_at`、`as_of_hour`、单品访客/浏览/收藏/下单/成交/转化/咨询与升序 `hourly[]`，不带 `--goods-id` 保持 03 行为。

**Blocked by:** 03

**Status:** resolved

- [x] `today` 含 `snapshot_at`、`as_of_hour`、单品今日汇总字段与升序 `hourly[]`，按 `data` 契约 v2 归一（`_yuan`、`_pct`、缺失为 `null`）
- [x] 上游昨日对照块（`yesterdayGoodsDetail` / `yesterdayGoodsDetailList`）不混入 `today`
- [x] 尚无小时累计行时 `as_of_hour: null`、`hourly: []`
- [x] headline 新增单商品今日实时行（`today: null` 时省略）；不带 `--goods-id` 保持 03 全店今日概况行为
- [x] 失败降级为 `today: null` 并写入 hint，退出码 0（超时、内部错误与取消照旧失败）
- [x] `data-contract-v2` 新增 `goods traffic --goods-id` 用例覆盖 `today` 与 `today.hourly[]`
- [x] 合成 fixture、adapter/view/service/e2e 测试覆盖单品今日汇总、小时趋势、空趋势与降级分支
- [x] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [x] `npm run check` 通过
- [x] 真实账号只读验证（执行前确认范围）：单品今日数据与小时趋势与后台一致；结果写入 Comments

## Comments

- 2026-11-22：默认真实账号只读验证通过：`node bin/pdd.js goods traffic --days 7 --goods-id <单品> --json`（商品 ID 与商品名已脱敏）返回 `ok: true`、`exit_code: 0`、`meta.warnings: []`，`today`（`2026-11-22 04:43:15`）输出 `as_of_hour: "03"` 与 `"00".."03"` 升序 `hourly[]`（凌晨汇总与分时指标保持 `null`，昨日块已剔除），`headline` 输出单品今日概括行。`npm run check` 通过。
