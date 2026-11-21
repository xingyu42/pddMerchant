# 01: 侦察省级地域分布端点

**What to build:** 只读实测 `.scratch/region-report/spec.md` 列出的三个地域端点，补齐请求参数、可选时间窗口、字段单位和缺行语义，结论写回 `docs/research/`。需要真实账号，执行前确认范围；通过页面签名客户端调用。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 官方 `mallCoreData/queryMallGeographyDistributionList`：页面原生请求体、可选的时间参数、一次返回的日期范围
- [ ] `windowsDataCentral` 两个端点是否可用，`queryType` 0 / 1 / 2 的实际窗口，与官方端点的数值是否一致
- [ ] 金额与客单价单位（元 / 分），`cfmOrdrAop` 的含义，`delayData` 的含义
- [ ] 无成团省份的表现（缺行或零值行）
- [ ] 与同窗口订单数据抽样对照，确认「成团」口径
- [ ] 每个端点记录是否出现私有区字符
- [ ] 结合实测结果给出命令归属建议（并入现有报表或独立子命令），供 02 定稿

## Comments
