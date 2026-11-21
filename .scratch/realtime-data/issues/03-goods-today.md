# 03: `goods traffic` 输出全店商品今日实时概况（不带 `--goods-id`）

**What to build:** `pdd goods traffic`（不带 `--goods-id`）在 `data.today` 输出全店商品今日实时概况（上游 `/sydney/api/goodsDataShow/queryGoodsPageRT`，含 `snapshot_at`、全店商品访客/浏览、有访问商品数、成交订单数/金额、转化率，解析千分位与百分号字符串），复用 `02` 确立的 `today` 采集与降级规则，历史商品明细、推广拆分与退出码不变。

**Blocked by:** 01, 02

**Status:** ready-for-agent

- [ ] `today` 含 `snapshot_at` 与全店商品今日访客、浏览、有访问商品数、成交订单数、成交金额（`_yuan`）、成交转化率（`_pct`）
- [ ] 千分位字符串（如 `"1,203.64"`）与百分号字符串（如 `"9.55%"`）按 `data` 契约 v2 解析；解析失败输出 `null` 并写入 `meta.warnings`
- [ ] 排除昨日无 `Rt` 后缀字段；命中私有区字体混淆字符时拒绝并抛出业务错误（经可选采集降级）
- [ ] headline 新增全店商品今日概况行（`today: null` 时省略）；历史商品明细与推广拆分输出不变
- [ ] 业务/网络失败降级为 `today: null` 并写入 hint，退出码 0；整条命令超时、内部错误与取消照旧失败
- [ ] `data-contract-v2` 中 `goods.traffic` 用例覆盖 `today`；合成 fixture、adapter/view/service/e2e 测试覆盖以上行为
- [ ] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [ ] `npm run check` 通过
- [ ] 真实账号只读验证（执行前确认范围）：`today` 数值与后台一致；结果写入 Comments

## Comments
