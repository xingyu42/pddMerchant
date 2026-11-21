# 01: 侦察省级地域分布端点

**What to build:** 只读实测 `.scratch/region-report/spec.md` 列出的三个地域端点，补齐请求参数、可选时间窗口、字段单位和缺行语义，结论写回 `docs/research/`。需要真实账号，执行前确认范围；通过页面签名客户端调用。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 官方 `mallCoreData/queryMallGeographyDistributionList`：页面原生请求体、可选的时间参数、一次返回的日期范围
- [x] `windowsDataCentral` 两个端点是否可用，`queryType` 0 / 1 / 2 的实际窗口，与官方端点的数值是否一致
- [x] 金额与客单价单位（元 / 分），`cfmOrdrAop` 的含义，`delayData` 的含义
- [x] 无成团省份的表现（缺行或零值行）
- [x] 与同窗口订单数据抽样对照，确认「成团」口径
- [x] 每个端点记录是否出现私有区字符
- [x] 结合实测结果给出命令归属建议（并入现有报表或独立子命令），供 02 定稿

## Comments

- 2026-11-22：真实账号只读实测完成，完整结论写入 `docs/research/region-geography-recon-2026-11-22.md`：
  - 官方 `mallCoreData/queryMallGeographyDistributionList` 原生发 `{ queryType: 0 }`，且直接支持 `1`（7 天）/ `2`（30 天），明文无 PUA；返回 `{ geographyDistributionVOList, delayData }`，金额 `cfmOrdrAmt` / `cfmOrdrAup`（客单价）/ `cfmOrdrAop`（笔单价）均为元并附带 `*Cent` 分字段。
  - `windowsDataCentral` 两个端点同样明文可用：分布接口数值与官方完全一致（1/14/26 省，1/74/563 单，25.4/1375.96/10405.24 元）；单省逐日接口返回完整 7/30 日（无成团日期显式置 0），分布接口对无成团省份缺行；与同就绪日 `orders.list` 订单核对完全一致，确认「成团」口径。
  - 建议 02 采用独立子命令 `diagnose region [--days 1|7|30]`，等待用户确认命令归属及是否推进单省逐日（03）。
