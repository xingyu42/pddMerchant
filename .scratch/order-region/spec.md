# PRD：订单输出收货省市区（`orders list` / `orders detail`）

Status: ready-for-agent

来源：GitHub #2「订单列表和详情不输出省市区」

## Problem Statement

商家想按地区看订单，比如哪些省份下单多、偏远地区订单占比多少、某个区县的订单是否集中出现售后。拼多多的订单对象里本来就带着收货省、市、区，但 `orders list` 和 `orders detail` 的输出里没有这三项。现在要按地区汇总，只能改服务层去读被丢掉的上游字段。`PDD_DEBUG_RAW=1` 也帮不上忙：订单在进入 envelope 之前就已经投影成视图，原始载荷到不了调试输出。

## Solution

`orders list` 的每条订单和 `orders detail` 的订单对象都增加三个字段：`province`、`city`、`district`，值为平台给出的省、市、区名称原文。上游缺失或为空时输出 `null`。

收件人姓名、手机号、联系电话、昵称、详细地址、商家退货地址、快递员电话继续不进入任何输出。

## User Stories

1. 作为商家，我想在订单列表里看到每单的收货省份，以便统计各省订单量。
2. 作为商家，我想在订单列表里看到收货城市，以便判断订单是否集中在少数城市。
3. 作为商家，我想在订单列表里看到收货区县，以便发现个别区县异常集中的订单。
4. 作为商家，我想在订单详情里看到省市区，以便核对单个订单的发货区域。
5. 作为商家，我想在偏远地区订单上一眼看出省份，以便提前确认运费模板和快递能否送达。
6. 作为商家，我想按省份对比售后状态，以便发现某个地区退款偏多。
7. 作为商家，我想用 `--json` 把订单连同省市区交给脚本或 LLM 汇总，以便不再手工改服务层代码。
8. 作为商家，我希望上游缺少省市区时看到 `null`，以便区分"没有数据"和"空字符串"。
9. 作为商家，我希望收件人姓名、手机号和详细地址仍然不出现在输出里，以便输出可以放心转给他人或模型。
10. 作为商家，我希望省市区字段在列表和详情里名字一致，以便同一段脚本两边都能用。
11. 作为商家，我希望 `--status` 各个范围（待发货、已发货待收货等）都带省市区，以便按地区排查待发货积压。
12. 作为商家，我希望人类可读模式下也能看到省市区，以便不开 `--json` 也能快速浏览。
13. 作为维护者，我希望契约守卫明确区分"粗粒度地区"和"收件人 PII"，以便以后新增字段时不会误放行详细地址。
14. 作为维护者，我希望上游多出的地址类字段（如 `consumerAddress`、`refundAddressInfo`）依然被白名单挡住，以便上游变动不影响输出。

## Implementation Decisions

- **修订决定 D5**（2026-10 v2 契约，`upstream-schema-2026-10.md`）：原 D5 把 `province_*` / `city_*` / `district_*` 和收件人、联系方式、详细地址一起列为不进视图的 PII。本次只放行省、市、区三个名称字段；其余 D5 排除项不变。CHANGELOG 中"省市区等粗粒度地理字段保持可见"指日志脱敏，本次把视图白名单对齐到同一口径。
- 订单领域视图增加 `province`、`city`、`district`，分别取上游 `province_name`、`city_name`、`district_name`，经现有文本归一（空串视为缺失）后输出，缺失为 `null`。列表视图字段集与详情视图字段集同时包含这三项（详情视图在列表视图字段集上扩展，自然继承）。
- 只读取上述三个上游字段；不读取 `*_id` 编码、不拼接完整地址、不从 `consumerAddress` 等字段解析地区。
- headline 不变，不加入地区统计。
- `REDACT_KEYS` 不改动：省市区本来就不在脱敏键集中；收件人手机号、详细地址的脱敏键保持原样。
- 契约规范 `.trellis/spec/services/domain-service-contracts.md` 中关于订单 PII 的描述同步写明"省、市、区名称可输出"。

## Testing Decisions

- 好的测试只断言外部行为：CLI 在 fixture adapter 下输出的 envelope `data`，不断言视图内部函数如何取值。
- 主接缝：用 `PDD_TEST_ADAPTER=fixture` 运行 `orders list` / `orders detail`，断言每条订单带 `province` / `city` / `district`，值与合成 fixture 一致；上游缺失或空串时为 `null`。
- `data-contract-v2` 中 `orders.list`、`orders.detail` 的字段集随视图字段列表自动扩展，确认守卫仍然通过。
- e2e PII 守卫（business-contract）的键名正则当前包含 `province|city|district`，需要收窄为只拦收件人、手机、电话、地址、昵称、联系方式；同时保留对 `SYNTHETIC_PII_VALUES` 的值级断言，确认收件人姓名、手机号、详细地址的合成值不出现在输出里。
- 同步更新 `order-view` 单测里断言精确键集和"PII 不出现"的用例。
- Prior art：`test/e2e/business-contract.e2e.test.js`（runCli + fixture、PII 键 / 值扫描），`test/contract/data-contract-v2.test.js`，`test/services/order-view.test.js`。

## Out of Scope

- 按地区聚合的统计或报表（例如 `diagnose orders` 按省分组）。平台有现成的省级地域分布接口，见 Further Notes，适合另立需求。
- 省市区编码、街道、详细地址、邮编。
- 收件人姓名、手机号、联系方式的任何形式输出。
- 修复 `PDD_DEBUG_RAW` 在已投影视图上看不到原始载荷的问题。
- 售后、利润等其他命令中的订单数据。

## Further Notes

- 省市区字段名取自 `createUpstreamOrder` 合成 fixture 和 issue 描述。店透视订单表（静态分析，见 `docs/research/diantoushi-region-realtime-2026-11-11.md` 1.1）同样直接读取订单的 `province_name`、`city_name`、`district_name`，并把详细地址和手机号遮成 `****`，与本 spec 的放行范围一致。`orderDetail` 是否同样带这三个字段仍只在 fixture 中体现（`createUpstreamOrderDetail` 继承列表订单结构）。真实账号只读冒烟需要另行确认范围。
- 平台省级地域分布：`windowsDataCentral/queryMallGeographyDistributionList`（`{ queryType }`，近 1 / 7 / 30 天）和 `queryMallGeographyDataList`（单省逐日），口径为成团，只到省，见同一研究文档 1.2。按地区汇总时优先用它，不需要逐单扫描订单。
- 修订 D5 属于契约变更，合入前在 `.trellis/` 记录这次决定。
