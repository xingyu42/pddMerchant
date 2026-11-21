# 03: `goods traffic` 输出全店商品今日实时概况（不带 `--goods-id`）

**What to build:** `pdd goods traffic`（不带 `--goods-id`）在 `data.today` 输出全店商品今日实时概况（上游 `/sydney/api/goodsDataShow/queryGoodsPageRT`，含 `snapshot_at`、全店商品访客/浏览、有访问商品数、成交订单数/金额、转化率，解析千分位与百分号字符串），复用 `02` 确立的 `today` 采集与降级规则，历史商品明细、推广拆分与退出码不变。

**Blocked by:** 01, 02

**Status:** resolved

- [x] `today` 含 `snapshot_at` 与全店商品今日访客、浏览、有访问商品数、成交订单数、成交金额（`_yuan`）、成交转化率（`_pct`）
- [x] 千分位字符串（如 `"1,203.64"`）与百分号字符串（如 `"9.55%"`）按 `data` 契约 v2 解析；解析失败输出 `null` 并写入 `meta.warnings`
- [x] 排除昨日无 `Rt` 后缀字段；命中私有区字体混淆字符时拒绝并抛出业务错误（经可选采集降级）
- [x] headline 新增全店商品今日概况行（`today: null` 时省略）；历史商品明细与推广拆分输出不变
- [x] 业务/网络失败降级为 `today: null` 并写入 hint，退出码 0；整条命令超时、内部错误与取消照旧失败
- [x] `data-contract-v2` 中 `goods.traffic` 用例覆盖 `today`；合成 fixture、adapter/view/service/e2e 测试覆盖以上行为
- [x] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [x] `npm run check` 通过
- [x] 真实账号只读验证（执行前确认范围）：`today` 数值与后台一致；结果写入 Comments

## Comments

- 2026-11-22：默认真实账号只读验证通过：`node bin/pdd.js goods traffic --days 7 --json` 返回 `ok: true`、`exit_code: 0`、`meta.warnings: []`，`items: 7 / total: 7` 不变，`today`（`2026-11-22 04:43:03`）含全店访客/浏览/有访问商品/成交单数/成交金额 `0`、转化率显式 `null`（未产生误告警），`headline` 含今日全店商品概括行。`npm run check`（`knip` + 127 个测试文件、2182 个通过）通过。
