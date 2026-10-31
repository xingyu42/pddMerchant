# 商品净利润与成本录入技术设计

## 1. 状态与依据

本文件为 PLANNING 产物，实施须经过规划审查。权威需求为本任务 `prd.md` R1–R3、父任务 `10-31-operating-data-gaps/prd.md` 和 ADR 0004。本轮仅修订本文件与 `implement.md`，保留评审者已更新的 PRD、ADR 状态、任务状态和所有运行代码原样。

核心方案：成本使用现有 SQLite，金额以整数分保存；命令薄封装，service 负责采集与编排，纯函数负责利润计算，view 负责字段白名单、元/时间换算和中文文案。新增运行依赖为零。第 11 节记录评审后已确定的 Q1–Q5；本设计无剩余口径确认门禁，代码实施仍待用户批准。

已核对的实现事实：

| 位置 | 事实及设计影响 |
| --- | --- |
| `src/commands/registry/goods.js:13` | goods 注册集中在一个 registrar；新增五个命令在此接线，无须改 `bin/pdd.js` |
| `bin/pdd.js:128` | 位置参数进入 `config.args`；import 从 `ctx.config.args[0]` 取得文件名 |
| `src/commands/runner/single-lifecycle.js:157` | `needsBrowser:false + needsAuth:false` 跳过账号解析；单设两个开关尚不足以提供成本主键 |
| `src/commands/runtime-options.js:13` | `opts.mall` 已合并 `runtimeConfig.defaultMall`，本地成本命令须声明并展示有效店铺范围 |
| `src/services/orders.js:16` | `listOrders` 返回 adapter 结果，含原始订单；计算保留原始数值码，避免从中文售后标签反推 |
| `src/services/views/order.js:29` | 件数 `goods_number`，收入基数 `order_amount`，平台优惠 `platform_discount`，商家优惠 `merchant_discount`，买家运费 `shipping_amount`，发货时间 `shipping_time` |
| `src/services/diagnose/orders-collector.js:15` | 可复用分页扫描，默认 `valid`，须显式改传 `all`；返回 `orders/truncated/ratelimited` |
| `src/adapter/endpoints/orders.js:68` | 时间参数落到 `groupStartTime/groupEndTime`；按 PRD R2.1，以相同口径的 `group_time` 做客户端窗口过滤 |
| `src/services/promo-roi.js:39` | 默认过滤已删除推广、按商品名回退、只查一页；利润采集单独编排，直接复用 `getPromoReport` 和 MoneyVO normalize |
| `src/adapter/endpoints/promo.js:147` | entityReport 默认商品推广类型 9；使用 UTC 日期格式化，无总页数输出；全店合计取此报表 totals.spend，固定 hint 明示商品推广报表范围 |
| `src/infra/db.js:119` | 当前 v2，迁移硬编码最大版本与最终版本，需同时改为 v3 |
| `test/helpers/data-contract.js:29` | 数字键含 cost/spend/amount 等词必须 `_yuan` 结尾；计数用 `entry_count`、`missing_entry_order_count`，避免把计数命名成金额 |
| `test/fixtures/test-data.js:146` | fixture 由 builder + 真 normalize 生成，再写临时目录；仓库当前没有 endpoint JSON 文件 |

## 2. 层次、文件与接口

| 层 | 新增/修改文件 | 职责 |
| --- | --- | --- |
| commands | 新增 `src/commands/goods/cost/{list,set,remove,import}.js`、`src/commands/goods/profit.js`；修改 `src/commands/registry/goods.js` | flags/位置参数接线，调用一个 service，返回 `{ data, meta, warnings }` |
| runner | 修改 `src/commands/runner/{batch-executor,single-lifecycle}.js` | 显式 `needsAccount` 的本地账号解析；统一 envelope/deadline 不变 |
| services | 新增 `src/services/goods-cost.js` | 本地账号/店铺范围、set/remove/import 预演及提交 |
| services | 新增 `src/services/goods-cost-input.js` | 单项成本与商品 ID/spec/金额校验，供命令服务与导入共同使用，保持无反向依赖 |
| services | 新增 `src/services/goods-cost-import.js` | 读取 JSON、校验全批、生成安全的逐行错误；复用 goods-cost-input 的单项校验 |
| services | 新增 `src/services/goods-profit.js` | 确定窗口、订单扫描、读取成本快照、调用推广采集、调用纯计算与 view |
| services | 新增 `src/services/goods-profit-calculation.js` | 纯 `computeGoodsProfit(input)`，包含订单到计算记录的最小投影、分组、成本匹配与空值传播 |
| services | 新增 `src/services/goods-profit-promo.js` | entityReport 分页、goodsId 归属、全店总额核对；独立于 ROI 分组策略 |
| views | 新增 `src/services/views/{goods-cost,goods-profit}.js`；修改 `labels.js` | 导出字段白名单与视图；所有新增枚举集中在 labels |
| infra | 新增 `src/infra/goods-cost-store.js`；修改 `src/infra/db.js` | SQL CRUD、同步事务、v3 migration；无领域算法、无上层 import |
| adapter | 修改 `src/adapter/endpoints/{orders,promo}.js` | 为现有分页端点补 `fixtureListKey`；entityReport 支持明确日期入参，复用已有报表字段 |

`goods-cost-store` 放在 infra，拥有持久化与隔离契约；成本匹配、元金额校验、是否扣费由 service 拥有。services 可直接依赖 infra，依赖方向沿用 `commands -> services -> adapter -> infra`，所有底层均无反向 import。沿用现有订单 collector 的位置和名称，避免本任务顺带重构 diagnose。

建议接口：

```js
// infra，全部同步；入参金额已经转换为整数分
listGoodsCosts({ accountId, mallId, goodsId })
upsertGoodsCosts({ accountId, mallId, entries }) // 单条 set 也走同一事务入口
removeGoodsCost({ accountId, mallId, goodsId, spec })
// services，纯函数
validateCostEntry(input, { row })
computeGoodsProfit({ orders, entries, promo, window, quality })
// services，异步编排
listGoodsCostView(ctx, params)
setGoodsCostView(ctx, params)
removeGoodsCostView(ctx, params)
importGoodsCostView(ctx, params)
getGoodsProfitView(ctx, { days = 30, goodsId })
```

每个函数 < 50 行、嵌套 <= 3；ESM、async/await、描述性变量。读文件与网络在事务外，短同步事务只处理 SQL。日志仅记录命令、数量、错误码，省略导入内容、订单内容和数据库路径。

## 3. CLI、账号、确认机制

```text
pdd goods cost list [--goods-id <id>]
pdd goods cost set --goods-id <id> [--spec <text>]
  --purchase-yuan <yuan> --packaging-yuan <yuan> --courier-yuan <yuan>
  [--insurance-yuan <yuan>] [--technical-service-yuan <yuan>] [--confirm]
pdd goods cost remove --goods-id <id> [--spec <text>] [--confirm]
pdd goods cost import <file> [--confirm]
pdd goods profit [--days 30] [--goods-id <id>]
```

- 金额 flags 保留字符串，所有成本项允许 0，经 `parseYuanToFen` 精确解析为非负整数分，最多两位小数；价格命令原有 >0 规则保持原样。商品 ID 保持数字文本，避免 `Number` 丢失长 ID 精度。正整数 ID 校验复用现有规则含义，先核对 `validateGoodsId` 的数值转换，必要时为本域保留安全字符串入口。
- `--spec` 缺省表示商品默认成本；指定文本按原字符串精确匹配，保留前后空格和 Unicode。空串、纯空白和 NUL 拒绝；默认行在输出中 `spec:null`。不依赖 SKU ID。
- set 为整条替换，三个基础项必填，可选项省略代表商家明确未录入该项、此次按 0；覆盖行也是完整记录，避免逐字段混合默认值。所有项共享此次 `updated_at`，因此各项更新时间一致。
- set/remove/import 都是本地写入，整批先校验；缺 `--confirm` 仅预演，`xhr_count:0`，不改变记录及时间。沿用 goods 写入确认惯例，PRD 无需改写命令名。
- remove 缺 `--spec` 仅删除默认行；指定 spec 仅删对应覆盖行；不存在时幂等成功 `removed_count:0`。本期无“删除该商品全部规格”的隐式行为。
- 本地四个命令均 `needsBrowser:false, needsAuth:false, needsAccount:true, needsMall:'stored', allowAllAccounts:false`。其中 `needsAccount` 与 `stored` 是本任务拟增的显式选择能力：`needsAccount` 默认 false，`stored` 仅在命令明确指定时启用，既有 `needsMall` 默认值保持原样。启用后 runner 解析本地 merchant 账号，`stored` 声明消费店铺参数，跳过页面探测与切店；成本 service 确定有效 `mallId`。改动仅增加这一可选分支，每个既有命令的账号、认证、店铺及浏览器行为均保持不变。
- 账号采用 `resolveAccountContext` 既有优先级（显式账号/默认/唯一启用账号）；无账号报 `E_ACCOUNT_REQUIRED`。仅需已登记账号，不读登录态、不解密、不校验在线状态、不触发重登或 daemon。店铺优先有效 `ctx.config.mall`（含配置默认店铺），否则使用账号 `identity`；输出始终带 `mall_id`。显式选择的本地店铺键不做网络验证，未来 profit 仍按真实已解析店铺查同一键。该取舍支持离线录入，也要求用户核对输出范围。
- runner 新能力只负责账号解析和 meta；本地店铺范围与商品成本逻辑留在 service。`buildCommandCtx` 继续从 accountCtx 取得 account/accountId；原有无账号本地命令不受影响。此改动同步更新 runner/command spec 中 `needsBrowser` 的旧限制。
- profit 使用既有 `needsAuth:true, needsMall:'switch'` 与只读多账号循环；查询所用账号 + 当前切换后的 mall 是成本检索范围。普通命令的商家认证及成功后的复核保持原样。

## 4. SQLite、迁移与并发

追加 `SCHEMA_V3`，建议 DDL：

```sql
CREATE TABLE goods_cost_entries (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mall_id TEXT NOT NULL CHECK (length(mall_id) > 0),
  goods_id TEXT NOT NULL CHECK (length(goods_id) > 0),
  spec TEXT NOT NULL DEFAULT '',
  purchase_fen INTEGER NOT NULL CHECK (typeof(purchase_fen) = 'integer' AND purchase_fen >= 0),
  packaging_fen INTEGER NOT NULL CHECK (typeof(packaging_fen) = 'integer' AND packaging_fen >= 0),
  courier_fen INTEGER NOT NULL CHECK (typeof(courier_fen) = 'integer' AND courier_fen >= 0),
  insurance_fen INTEGER NOT NULL DEFAULT 0 CHECK (typeof(insurance_fen) = 'integer' AND insurance_fen >= 0),
  technical_service_fen INTEGER NOT NULL DEFAULT 0 CHECK (typeof(technical_service_fen) = 'integer' AND technical_service_fen >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, mall_id, goods_id, spec)
);
```

- `spec=''` 是库内默认行哨兵，避免 SQLite 可空复合唯一键允许多个 NULL 的问题。service 校验真实 spec 为非空文本，store 映射 `null <-> ''`。
- `purchase_fen` 按件，其余四项按单。以固定列覆盖首期可选的运费险、技术服务费；新增任意自定义收费项目留后续需求，避免引入 EAV 表和自由键输出。可选项扩展范围若审查认为应支持任意项，先回到规划。
- 成本为商家提供的本地业务值，按现有账号元数据方式保存；不引入新密钥或加密方案，数据库整体继续视为敏感文件。
- `migrate` 最大支持版本、最终 `PRAGMA user_version` 同时改 3：新库 V1 -> V2 -> V3；v1 库 V2 -> V3；v2 库仅 V3；v3 重开幂等；v4+ 继续 `E_DATABASE_VERSION_UNSUPPORTED`。DDL 与版本设置处于现有同一事务，失败全部回滚。版本号在实施前重查，若其他任务已占 v3，顺延并同步测试与文档。
- 所有 SQL 参数化；批量 upsert 一个 `BEGIN IMMEDIATE`，写入前复查账号仍存在且为 merchant。账号删除自然外键级联；并发删除导致提交失败时整批回滚，保持账号删除结果，无复活逻辑。
- 当前值采用普通 last-writer-wins；每次提交在事务内以当前提交时间生成 ISO `updated_at`，批内所有行使用同一时间戳。同毫秒内覆盖允许保留相同时间戳。单次查询将该账号/店铺全部成本一次性读成不可变快照；网络采集期间不持有 DB 事务。输出精度到秒，内部保留毫秒。

## 5. 导入格式与全批拒绝

首期仅 JSON，UTF-8（接受 BOM），根为非空数组。一条对象即一行；语义错误 `row` 为数组中从 1 开始的记录序号。JSON 语法错误统一报告 `row:null` 和固定安全消息，省略原始解析消息；仅使用记录序号定位错误，省去物理行号的计算与输出。

```json
[
  { "goods_id": "101", "spec": null, "purchase_yuan": "8.20", "packaging_yuan": "0.50", "courier_yuan": "3.00" },
  { "goods_id": "101", "spec": "红色 / 大号", "purchase_yuan": "9.20", "packaging_yuan": "0.60", "courier_yuan": "3.00", "insurance_yuan": "0.30", "technical_service_yuan": "0.20" }
]
```

允许列与上例一致；`spec` 可省略或 null 表示默认，后两个金额可省略。账号和店铺由命令上下文绑定，导入行中的 account/mall 等额外字段一律作为未知列报错，防止写入意外范围。ID 推荐字符串；数字只接受正安全整数。金额支持十进制字符串或安全 number，所有成本项均允许 0，校验符号、最多两位小数和整数分安全范围；字符串中的指数、NaN、Infinity、布尔、负数均拒绝。JSON number 采用原生数值语义，再经 `parseYuanToFen` 校验；精确录入推荐字符串。

文件大小上限 1 MiB、记录上限 5000、spec 最长 2000 字符；超限报 usage。先 `stat` 再读，并在读后复查字节数；拒绝目录与扩展名不符的文件。先解析与校验全部记录，收集全部行错误（大小上限限制资源消耗），包含白名单字段名或固定“未知列”标识、固定中文原因，省略输入值及文件路径。相同 `(goods_id,spec)` 重复的后续行报错并指出首行序号；记录间不采用最后一行覆盖。对象解析采用原生 `JSON.parse` 语义（同名属性保留最后值），不实现额外 JSON 词法解析器；模板与说明要求每个字段只出现一次。

任一错误：`E_COST_IMPORT_INVALID` / exit 2，`error.detail={ row_errors:[{row,field,message}] }`，`data:null`，包括 `--confirm` 场景均零写入。JSON 语法错误返回一条 `row:null,field:null` 的固定错误；语义错误遍历全批。全批合法才生成预演或开启一次短事务，SQL 中途失败也全批回滚。JSON 原生支持带逗号、引号、换行的 spec，暂不增加 CSV 维护面。

## 6. 采集范围、窗口与完整性

### 6.1 订单

`--days` 为 1–90 的整数，默认 30；非整数或超出范围均 `E_USAGE` / exit 2，保留输入校验结果而非取整或截断。使用上海时区最近 N 个完整自然日，不含当天，结束于运行当天 00:00:00，窗口 `[start,end)`；`window={start_at,end_at,days}` 明确 end_at 为排他上界。订单与推广日汇总使用同一窗口。

复用 `collectOrdersForStaleAnalysis(ctx.page, ctx, { scope:'all', since, now:end-1, scanDays:days, pageSize:50, maxPages })`，`maxPages=max(10,ceil(days/7)*3)`，沿用 200ms 页间延迟和端点限流。`ORDER_LIST_SCOPES.all` = `orderType:0/afterSaleType:0`，包含退款和 10/11；`valid` 会过滤掉所需订单。以原始 `group_time` 再做 `[start,end)` 窗口过滤，并检查 ID/成团时间缺失及重复订单；订单号仅内部去重，输出省略订单号。相同订单重复且字段冲突视为不完整，保留首条并给 hint。

上游 `groupStartTime/groupEndTime` 与客户端 `group_time` 均为成团时间口径，覆盖关系由 PRD R2.1 明确。采集传 `since=start,until=end-1` 以适配秒级时间和排他上界；完整分页后即可计算窗口财务。个别记录缺失或无效 `group_time` 时保留字段缺失提示并标采集不完整，避免将无法定位窗口的记录计入完整周期。

保留 collector 返回的 `truncated/ratelimited`。pageSize 不提升到 100；最后一页满额且触顶时保守视为截断。补 `ORDER_LIST.fixtureListKey='orders'` 以支持分页 fixture 的尾页合成。首请求网络/认证/业务失败继续原错误；捕获到的限流保留已观测样本并标不完整，首请求限流也保留该事实而非伪造空周期。

### 6.2 推广

按同一自然日窗口调用 `getPromoReport({type:'entity',page,size:50,...})`，最多 100 页，顺序采集；整页继续，短页结束，触顶为不完整。所有页的 `entities` 合并，仅按非空合法 `goodsId` 归属商品；同商品多计划累加，包含已删除/停用计划在窗口内的历史花费。商品名仅作显示，绝不用来匹配。缺 goodsId 的实体留在全店待归属部分。

`analyzePromoRoi` 的默认过滤与一页读取不适合本需求，故复用端点与 money normalize，不复用其分组流程。端点请求含 `returnTotalSumReport:true`，`totals` 作为该报表的全窗口汇总，保留首份、后续有 totals 时核对一致性，绝不逐页相加。entityReport 新增可选 `startDate/endDate`（已校验 `YYYY-MM-DD`）入参，优先于旧 `since/until`；订单 `[start,end)` 对应推广 `startDate=上海 start 日期,endDate=上海 end 前一日日期`，按接口包含结束日期的规则查询，避免多计一天。旧调用路径保持原样，避免 UTC 格式化令上海午夜错日。fixture key 为 `entities`。

按 R2.5 的商品推广报表口径计算，无额外覆盖核验条件：

```text
summary.attributed_promo_spend_yuan = sum(全部有 goodsId 实体的 spend)
summary.shop_promo_spend_yuan = totals.spend - summary.attributed_promo_spend_yuan
summary.promo_spend_yuan = totals.spend
goods.promo_spend_yuan = sum(goodsId 精确匹配该商品的 spend)
```

该“店铺级推广花费”是本报表总计中未归属商品的部分，字段说明保留此定义。`mallFavSpend/inquirySpend/goodsFavSpend` 保持现有 normalize 行为，利润计算仅按 totals.spend 扣一次，不再叠加这些子项。差额为负时仅 `shop_promo_spend_yuan:null` 并给 hint，保留已知 `summary.promo_spend_yuan=totals.spend` 与商品归属花费；全店净利润仍按报表总计公式计算。分页总额漂移、金额单位未知或分页不完整使受影响花费及利润 null，并提示来源。固定 hint 始终写明“仅含商品推广报表口径”；报表总计是否覆盖店铺关注、询单等计划，等有投放数据时再验证，作为后续研究记录，不影响本期全店净利润计算，也不增加其他报表类型。

推广请求失败、被限流、截断：`promo_complete:false`，商品与全店推广花费和净利润 null，订单收入、成本仍可展示。完整拉取且该商品无记录：该商品 `promo_spend_yuan:0`。成功且空实体列表可以表示商品归属额为 0，全店花费仍取 totals.spend；须确认分页已终止。空 entities 与 totals 缺失分别处理，全店总额缺失只影响全店净利润。订单、成本和本报表数据完整时直接计算全店净利润。abort/命令超时由 runner 终止，避免捕获成正常推广缺失。

### 6.3 输出范围与缺失策略

商品集合为窗内订单 goodsId 与推广 goodsId 的并集；`--goods-id` 未出现时返回该 ID 的零订单行，说明收入为 0 的依据。仅有成本、窗内无订单也无推广的其他商品不扩充列表。无需额外扫描商品库存，商品名来自订单/推广，可缺省为 null。缺失 goodsId 的订单保留全店收入观测、计入 `unattributed_order_count`，全店利润为 null，省略虚构商品 ID。

`--goods-id` 只筛 `items`，`total` 为返回行数，`summary` 始终为全店窗口合计，另带 `filter_goods_id` 以消除歧义；先算全店再筛选。缺成本的任一贡献订单使对应商品成本合计、毛利和净利润为 null；全店合计沿用严格空值传播，无“只合计有成本商品”的暗中排除。完整的无订单商品仍按 R3.1 检查是否有成本记录：无任何成本时利润 null，有成本且已知零用量时成本 0，推广按实扣。

订单截断/限流或记录缺少有效成团时间：数量与退款/售后计数明确为观测样本；窗口财务合计（收入、成本、毛利、净利润、利润率）为 null，保留 `observed_revenue_yuan` 和 `observed_order_count`。完整来源内的个别缺字段按受影响字段传播 null；未知份额不靠其他商品补齐。

## 7. 纯函数计算口径

输入只含规范化订单（ID/spec/数量/分金额/数值售后码/发货秒/支付状态/成团秒）、成本快照、推广归属结果、窗口与质量标志；无 DB、时钟、网络、日志或进程环境读取。金额加减乘使用普通整数分算术；推广已经规范成元，先经 `round` + `parseYuanToFen` 转分，异常/负数为未知。最终 view 用 `yuanFromFen`，率四舍五入两位。输入保持不变，输出稳定按 goodsId 排序。

每单规则：

| 订单 | 收入 | 货本 | 包材/快递 | 可选按单项 |
| --- | --- | --- | --- | --- |
| 普通订单、10/11 售后处理中 | `order_amount + platform_discount` | 匹配成本 `purchase_fen * goods_number` | 各扣一次，按订单计提，含待发货 | 各扣一次 |
| 5 退款成功且 `shipping_time > 0` | 0 | 0，按货已退回 | 各扣一次 | 各扣一次 |
| 5 退款成功且 `shipping_time === 0` | 0 | 0 | 0 | 0 |
| 5 退款成功且 shipping_time 缺失/无效 | 0 | 0 | null | null |
| 明确未支付取消（`pay_status=0`） | 0 | 0 | 0 | 0 |

先处理明确未付款取消，再判断退款/售后状态；取消单的零收入与零成本规则优先，省去对其金额、数量、发货字段的依赖。收入已含买家支付的运费，`shipping_amount` 只供解释，不重复加收入；`merchant_discount` 已影响实付，不重复扣。R2.4 的售后处理中金额定义为这批 10/11 订单的 `paid + platform_discount`，独立计数/合计，不另作退款扣除。退款前收入可在内部用于核对，输出收入按上表净额；`platform_discount_yuan` 同样为计入收入的优惠，成功退款与未付款取消贡献 0。

匹配顺序：订单 spec 原文本命中该商品覆盖 -> 否则商品默认行 -> 都无则缺成本。命中覆盖整条替代；fallback 计数仅在订单有非空 spec、无精确覆盖且实际使用默认行时 +1；空 spec 使用默认时无“规格未命中”计数。完整零扣费的退款订单仍遵循 R3.1 的成本存在性要求，避免“无录入”被表示为零成本。数量缺失只影响依赖件数的成本；零扣货本的退款无需用数量推定货本。售后字段缺失和未知码都使该订单财务分类未知；保留观测实付，相关收入/成本/利润 null。仅 10/11 计售后处理中，沿用数值码兼容字符串 `'5'/'10'/'11'`，不沿用现有统计函数“任意非 5 码都计处理中”的宽规则。

```text
merchant_cost = purchase + packaging + courier + insurance + technical_service
gross_profit = revenue - merchant_cost
net_profit(goods) = gross_profit(goods) - goods_attributed_promo_spend
net_profit(summary) = sum(gross_profit(goods及未归属订单)) - totals.spend
gross_margin_pct = gross_profit / revenue * 100
net_margin_pct = net_profit / revenue * 100
```

分母为 0 时率为 null；`gross_margin_pct/net_margin_pct` 是有符号百分数，允许负值、绝对值超过 100，计算结果原样保留，不做截断。这是 R2.9 明确的通用 `_pct` 0–100 规则例外，实施时同步相应 spec。无成本、推广缺失、窗口不完整分别触发各自空值规则，独立已知项继续输出。全店各成本分项逐项相加、任一未知则该项 null；货本与其他分项仍有独立可得性。`cost_updated_at` 为实际使用成本记录中最大的更新时间，未使用成本记录时为 null。默认值会重算历史窗口，输出说明成本使用当前值。

## 8. 精确 data 契约

以下字段均为必有键，可缺失的标量用 null。所有金额为元 number（两位精度），时间为上海 `YYYY-MM-DD HH:mm:ss`；ID 为 string，枚举为中文。`*_FIELDS` 白名单必须与输出键集合严格相等。data 内无 raw/meta/warnings。

### 8.1 成本

`GOODS_COST_ENTRY_FIELDS`：

```text
goods_id, spec, purchase_yuan, packaging_yuan, courier_yuan,
insurance_yuan, technical_service_yuan, updated_at
```

`spec:null` 表示商品默认行；其余是原规格文本。`updated_at` 为实际持久化时间，预演计划为 null。

```text
goods.cost.list
{ headline, items: Entry[], total, mall_id }

goods.cost.set
{ headline, entry: Entry, dry_run, mall_id }

goods.cost.remove
{ headline, goods_id, spec, matched_count, removed_count, dry_run, mall_id }

goods.cost.import
{ headline, items: Entry[], total, inserted_count, updated_count, dry_run, mall_id }
```

import 的 inserted/updated 是本次预演/提交计划分类；确认提交时在同一事务复查并返回实际分类。remove 预演 `matched_count=0|1,removed_count=0`，确认后 `removed_count=0|1`。成功 headline 模板：

- list：`已录入商品成本 {total} 条`。
- set 预演：`预演录入商品 {goods_id} 的{商品默认/指定规格}成本`；确认：`已录入商品 {goods_id} 的{商品默认/指定规格}成本`。
- remove 预演：`预演删除商品成本，匹配 {matched_count} 条`；确认：`已删除商品成本 {removed_count} 条`。
- import 预演：`预演导入成本 {total} 条，新增 {inserted_count} 条、更新 {updated_count} 条`；确认：`已导入成本 {total} 条，新增 {inserted_count} 条、更新 {updated_count} 条`。

### 8.2 利润

```text
goods.profit
{
  headline,
  window: { start_at, end_at, days },
  filter_goods_id, items: ProfitItem[], total,
  summary: ProfitSummary,
  hints: string[], mall_id
}
```

`ProfitItem` / `GOODS_PROFIT_ITEM_FIELDS` 的确切键：

```text
goods_id, goods_name,
order_count, observed_order_count, quantity, refunded_order_count,
after_sales_order_count, after_sales_revenue_yuan,
paid_amount_yuan, platform_discount_yuan, revenue_yuan, observed_revenue_yuan,
purchase_yuan, packaging_yuan, courier_yuan, insurance_yuan, technical_service_yuan,
merchant_cost_yuan, gross_profit_yuan, promo_spend_yuan, net_profit_yuan,
gross_margin_pct, net_margin_pct,
cost_updated_at, default_fallback_order_count, missing_entry_order_count, data_status
```

`data_status` 使用 `DATA_STATUS_LABEL` 的“数据完整/数据不完整”，只表达输入可得性。计数 `order_count` 为全窗该商品订单数，订单扫描不完整时 null；`observed_order_count` 恒为已观测单数；`quantity` 为收入订单的件数，成功退款与未付款取消计 0，缺数量或不完整时 null。refund/open/fallback/missing 的计数均为已观测样本，数据质量与 hints 明示范围。`cost_updated_at` 仅取实际使用记录的最大 updated_at。

`ProfitSummary` / `GOODS_PROFIT_SUMMARY_FIELDS`：

```text
goods_count, order_count, observed_order_count, quantity,
refunded_order_count, after_sales_order_count, after_sales_revenue_yuan,
paid_amount_yuan, platform_discount_yuan, revenue_yuan, observed_revenue_yuan,
purchase_yuan, packaging_yuan, courier_yuan, insurance_yuan, technical_service_yuan,
merchant_cost_yuan, gross_profit_yuan,
attributed_promo_spend_yuan, shop_promo_spend_yuan, promo_spend_yuan,
net_profit_yuan, gross_margin_pct, net_margin_pct,
cost_updated_at, default_fallback_order_count, missing_entry_order_count,
unattributed_order_count, data_status, data_quality
```

`goods_count` 是全店已观测商品数（与过滤后的 total 可不同）；未归属订单会令全店利润未知。`paid_amount_yuan` 与 `platform_discount_yuan` 都只计贡献收入的订单；`observed_revenue_yuan` 为已采样并能确定收入规则的合计，若样本自身缺金额/售后字段也为 null。空的完整窗口合计金额与计数为 0、利润率为 null；推广失败时即使无订单，全店净利润仍为 null。item/summary 的 data_status 在对应订单来源完整、所需成本和金额已知、商品推广报表数据完整时为“数据完整”；归属差额为负时 summary 标记数据不完整并提示差额异常，已知总花费及其净利润计算仍保留。

`data_quality` 的固定布尔键：

```text
orders_complete, orders_truncated, orders_ratelimited,
promo_complete, promo_truncated, promo_ratelimited
```

金额缺失、成本缺失等由对应 null、missing_entry_order_count 与 hints 表达。成本未配置不会错误置成“订单扫描失败”。profit headline 最多三句：

1. 完整：`{start_date} 至 {last_included_date} 统计商品 {total} 件，订单 {summary.order_count} 单（全店）`；其中 last_included_date 为排他 end_at 的前一日；过滤时追加“商品列表按 ID 筛选”，summary 仍全店。
2. 财务已知：`全店收入 {revenue_yuan} 元，净利润 {net_profit_yuan} 元`；未知：`全店利润数据不完整，相关金额为 null`。
3. 售后可用：`退款成功 {refunded_order_count} 单，售后处理中 {after_sales_order_count} 单`；缺字段则 `售后数据部分不可用`。

截断时首句改为 `已采集订单 {observed_order_count} 单，商品 {total} 件`，避免把样本说成完整周期。列表空且完整时 `统计窗口内无订单和商品归属推广记录`。

动态 hints：订单采集上限、限流、推广失败/不完整/负归属差额、缺成本的观测单数、规格回落单数、缺失字段、筛选只影响 items。所有文案由 view 生成；新增枚举与原因表在 `labels.js`。固定 hints 始终包含：

- `成本按当前录入值计算，历史窗口会随成本更新重算`。
- `退款成功按全额退款且货已退回处理；仅退款不退货时，利润可能高估`。
- `平台优惠按全部结算给商家计入收入；商家共担补贴活动时，利润可能高估`。
- `推广花费仅含商品推广报表口径`。

数字正负直接保留；无保本 ROI、盈亏分类、评分、推荐操作或标签。技术单位警告并入 `meta.warnings`，业务数据质量留在 data.hints。

## 9. 错误、退出码与兼容

| 场景 | code / exit | 处理 |
| --- | --- | --- |
| CLI ID/spec/金额/days 非法，写入 all-accounts | `E_USAGE` / 2 | 先校验，零写入 |
| 无已登记 merchant 账号 | `E_ACCOUNT_REQUIRED` / 2 | hint 指向账号选择/登录登记 |
| 显式账号不存在/歧义 | 既有 `E_ACCOUNT_NOT_FOUND` / `E_ACCOUNT_AMBIGUOUS` / 2 | 复用错误工厂 |
| JSON 语义/语法/重复记录/大小错误 | 新 `E_COST_IMPORT_INVALID` / 2 | 安全 row_errors，全批拒绝 |
| 导入文件不可读 | 新 `E_COST_IMPORT_IO` / 2 | 固定文案，无原生错误路径 |
| 成本 CRUD SQL 失败 | 新 `E_COST_STORE_IO` / 1 | 固定文案；事务回滚 |
| DB 无法打开、超前 schema | 既有 `E_AUTH_STATE_IO` / `E_DATABASE_VERSION_UNSUPPORTED` / 3 | 保留 db.js 错误，不吞掉版本错误 |
| profit 主订单来源认证/网络/业务失败 | 既有错误 / 3、5、6 | runner 单次错误 envelope |
| 订单截断/collector 捕获限流；推广可选来源失败 | OK / 0 | 部分数据、null 与 hints；与现有事实报表一致 |
| 多账号执行部分账号失败 | 既有 batch / 7 | 不改变 batch 汇总策略 |

仅使用 `PddCliError/ExitCodes`，新错误构造留所属模块，确需跨模块复用才放 errors.js；不改变 envelope 顶层。费用缺失是成功查询中的未知数。所有新增命令加入 v2 guard，无 PENDING 豁免。现有命令 flags、字段与上下游行为保持兼容；新增日期入参仅由新调用者使用。

## 10. 回退与取舍

- 上线前通过 SQLite 受支持备份方式生成一致性副本，备份 DB 与同目录 master.key；停止写入/关闭连接后处理 WAL，避免只复制活跃主库。备份与成本导出含业务数据，沿用敏感存储要求。
- 迁移仅增表；迁移失败原版本和数据自动回滚。升级成功后旧二进制会拒绝 v3，即使尚无成本也如此。安全回退是恢复升级前 DB + 配对主密钥并运行旧版，会丢失升级后的新认证/成本更新；恢复前先保存当前完整副本。禁止仅调低 user_version 或自动删表。
- 单批导入失败天然回滚；已确认的成本改动按当前值覆盖，没有历史自动撤销。误写可通过校正 set/import 或受控备份恢复处理。
- 只保存当前成本降低复杂度，代价是历史利润随更新变化；精确 spec 匹配清晰可审计，代价是后台改名后可能回落默认；JSON-only 减少格式歧义；本地账号能力要改共享 runner，需全量回归；有上限的扫描避免无界请求，代价是大店窗口可能返回未知利润。

## 11. 已确定的评审决策

| 编号 | 已确定的口径 | 设计及实施影响 |
| --- | --- | --- |
| Q1 已决定 | 成团时间 `group_time`；上海最近 N 个完整自然日，不含当天，结束排他；days 为 1–90 整数，默认 30 | 与 groupStartTime/groupEndTime 同口径采集及客户端过滤；非法 days 为 E_USAGE / exit 2，完整采集即可计算窗口财务 |
| Q2 已决定，方案 (a) | 全店推广取 entityReport totals.spend；店铺级花费为总计减商品归属合计 | 负差额仅使店铺级花费 null 并提示；始终提示“仅含商品推广报表口径”；订单、成本及报表完整时计算全店净利润。关注/询单覆盖留后续有投放数据时验证 |
| Q3 已决定 | 所有成本项 >=0，最多两位小数 | 使用 parseYuanToFen，与价格命令共用单位/精度解析；价格命令原有 >0 行为保持不变 |
| Q4 已决定 | 退款的可选按单项随包材/快递：已发货照扣，未发货为 0；未付款取消收入及全部成本为 0 | 发货时间缺失/无效时，退款包材、快递及可选按单项为 null，保留字段缺失传播 |
| Q5 已决定 | gross_margin_pct/net_margin_pct 为有符号百分数，可负、可超过 ±100，原样保留 | gross 为扣商家成本后的毛利率，net 为扣推广后的净利率；spec 更新步骤明示通用 `_pct` 0–100 规则的此项例外 |

Q1–Q5 已全部决定，无剩余 open question 或来源覆盖验收门禁。本轮保留 PLANNING，ADR 状态原样；实施时同步 spec 与已确定口径，最终功能验收通过时按 PRD 修改 ADR 状态。其他设计保持：本地写 confirm、JSON-only、完整记录覆盖、filter 仅作用列表、summary 全店，以及实际使用成本记录的最大更新时间。
