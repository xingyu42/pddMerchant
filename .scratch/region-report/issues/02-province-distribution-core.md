# 02: 省级成团地域汇总主干（`diagnose orders` `regions` 区块）

**What to build:** 按用户拍板（并入现有 `diagnose orders` 的独立 `regions` 区块，默认近 7 天），接入官方 `/sydney/api/mallCoreData/queryMallGeographyDistributionList`（`{ queryType: 1 }`，导航 `/sycm/stores_data/operation`），在 `diagnose orders` 输出 `regions` 区块（显式标注成团口径「数据中心-地域分布（成团订单）」、window、delayed、按成团额降序的省份分布，字段为 `province`、成团额 `_yuan`、成团单数、成团买家数、客单价 `_yuan`、笔单价 `_yuan`），命中私有区字体混淆字符 fail-closed 并独立降级为 `regions: null`，保持现有 `detail`、`status` 与 `diagnose shop` 不变。

**Blocked by:** 01

**Status:** resolved

- [x] 输出遵循 `data` 契约 v2 并显式标明成团口径
- [x] 仅白名单投影省级汇总字段，不含收件人、地址、手机号等 PII
- [x] 命中私有区字体混淆字符时 fail-closed 报错
- [x] 输出事实型 headline（无经营建议或评分）
- [x] `data-contract-v2`、合成 fixture、adapter/service/view/e2e 测试覆盖主干输出与白名单过滤
- [x] 报表文档、CHANGELOG、`.trellis/spec` 服务契约已同步
- [x] `npm run check` 通过
- [x] 真实账号只读验证（执行前确认范围）：省级汇总与后台页面一致；结果写入 Comments

## Comments

- 2026-11-22：已立项为 `needs-triage`，待 `01` 侦察定稿命令归属、请求体与字段单位后细化为 `ready-for-agent`。
- 2026-11-22：按用户决策并入 `diagnose orders` 独立 `regions` 区块（近 7 天、`queryType: 1`），默认真实账号只读验证通过：`node bin/pdd.js diagnose orders --json` 返回 `ok: true`、`exit_code: 0`、`meta.warnings: []`、`regions.caliber: "数据中心-地域分布（成团订单）"`、`regions.window: { start_date: "2026-11-15", end_date: "2026-11-21", days: 7 }`、`delayed: false`，共 `14` 个省、合计 `74` 单、`1375.96` 元，与 `01` 侦察同窗口实测结果完全一致，主区块 `detail`（待发货 1 单 / 延迟发货 0 单 / P95 22.9 小时 / 样本退款率 10%）与 `headline`（三行）正常。`npm run check`（`knip` + 130 个测试文件 / 2191 个通过）全部通过。
- 2026-11-22：双轴评审修订：补充无成团省份空列表语义（`items: []`、`province_count: 0`、`window: null` 并保留 `window_days: 7`，不用本地日期冒充平台就绪日）；在 `ORDER_REGION_DISTRIBUTION.normalize` 增加 `provinceName` 去重与跨行 `statDate` 一致性校验；统一共用 `isDegradableReportError`（含子账号无权时的 `E_AUTH_EXPIRED` 降级）并清理调用侧死参数 `{ queryType: 1 }`。
