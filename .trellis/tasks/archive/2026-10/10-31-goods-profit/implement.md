# 商品净利润与成本录入实施清单

## 0. 当前阶段与执行约束

当前为 PLANNING。本清单只规划后续执行，本轮仅修订 `design.md` 与本文件；保留评审者已更新的 PRD，其他文件及 task/ADR 状态原样，也不执行任务 start。文中新增测试路径是计划新增文件，现有测试路径已对照当前仓库核验。

实施全程遵守：函数 < 50 行、嵌套 <= 3、描述性命名、ESM、async/await、无新增运行依赖。依赖方向 `commands -> services -> adapter -> infra`；命令只校验和接线，领域计算进 services，输出进 views，SQL 进 infra。先增加失败测试，再写最小实现，逐步扩大验证范围。所有测试隔离临时 `PDD_DB_PATH`，CLI 使用 fixture，不连接真实账号和后端。

## 1. 开工审查：对齐已确定口径

- [ ] 阅读本任务 PRD、父 PRD、ADR 0004、`implement.jsonl` 全部引用、`design.md`；核对工作树，保留已有未提交改动。显式选择本任务，避免会话 fallback 指向其他 planning 子任务。
- [ ] 按 PRD R2.1/R2.5/R2.8/R2.9 和 design §11 的已定决策执行：group_time 完整自然日窗口、days 1–90、报表 totals 推广总额、零成本、退款可选费用及取消单、无截断的有符号利润率。Q1–Q5 均已解决，无待补证据门禁。
- [ ] 获准进入实施后更新相应约束文件：`.trellis/spec/commands/{command-contracts,runner-lifecycle}.md`、`.trellis/spec/infra/sqlite-storage.md`、`.trellis/spec/services/domain-service-contracts.md`、`.trellis/spec/infra/envelope-errors-output.md`。记录本地账号能力、成本 schema、成团窗口及报表口径；明确 `gross_margin_pct/net_margin_pct` 可为负、可超过 ±100，作为通用 `_pct` 0–100 规则的显式例外。
- [ ] 重查 `db.js` 当前 schema 最大版本；如 v3 已被占用，统一顺延新迁移及本清单测试预期。

验证：人工对照 R1.1–R3.3（含 R2.8/R2.9）与 Q1–Q5 的已定结论；阅读 `git diff --stat`、`git status --short`。此步为规划审查，无需执行新测试。回退点 G0：未批准前保持 planning，尚无运行代码或 DB 变更。

## 2. 数据库迁移：先红后绿

- [ ] 先改 `test/infra/db.test.js`：新库最终 v3、重复打开幂等、v1 -> v3 与 v2 -> v3 保留全部旧表数据，v4 被拒绝；新增 DDL 和版本号同事务，失败回滚。
- [ ] 老迁移测试构造旧库时移除新表后再设置旧版本，避免 fixture 伪装 v2 却仍含 v3 表。保留原 v1/v2 表定义语义，断言账户序列、凭据密文、控制台行均原样。
- [ ] 修改 `src/infra/db.js`：追加 V3 DDL，更新最大支持/最终 user_version；仍由该文件唯一 import `node:sqlite`。
- [ ] 用合成账号补删除级联测试，验证同一账号多个 mall/goods/spec 的成本被删，其他账号保留。

验证：`npx vitest run test/infra/db.test.js`。

审查门 G1：SQL 参数/类型约束、默认 spec 唯一性、同步事务、路径脱敏、新旧 schema 测试全部通过。回退：开发临时库直接重建；部署迁移失败自动回滚，已成功迁移的运行库采用 G9 的备份恢复流程。

## 3. 成本 store 与隔离

- [ ] 先新增 `test/infra/goods-cost-store.test.js`：空列表、默认/规格共存、set 覆盖、updated_at 使用提交时间且同毫秒覆盖可同值、多账号/多 mall/多商品隔离、精准删除与幂等删除。
- [ ] 覆盖 import 同事务多行提交、第二行 SQL 失败全回滚、账号删除与写入竞争、consumer 账号被拒绝、商品 ID 文本保持精度、金额安全整数约束。
- [ ] 新增 `src/infra/goods-cost-store.js`，通过 db.js 的 all/get/run/transaction 访问；内部 `spec=''` 与外部 null 映射，批内统一更新时间，固定安全错误。
- [ ] 扩展 `test/infra/account-store.test.js`：通过 `removeAccount` 删除账号时成本级联，重新登记同店铺后新账号不继承旧成本。

验证：`npx vitest run test/infra/goods-cost-store.test.js test/infra/account-store.test.js test/infra/db.test.js`。

审查门 G2：infra 无上层 import、无网络/Promise 事务、last-writer-wins 与级联行为明确。回退：尚未接命令，可独立撤回 store 实现；保留已发布 schema 的版本保护。

## 4. 单条成本校验、view 与本地服务

- [ ] 先新增 `test/services/goods-cost.test.js`、`test/services/goods-cost-view.test.js`：必填项、可选项默认规则、所有成本项允许 0、超两位/负数/布尔/指数/超安全值、长数字 ID、精确 spec 与整条覆盖。
- [ ] 测试 `Entry` 字段集完全等于 `GOODS_COST_ENTRY_FIELDS`、上游/输入噪声被丢弃、时间为上海字符串、预演 updated_at 为 null、数字单位为元。
- [ ] 新增 `src/services/goods-cost-input.js` 拥有共享单项 validator；新增 `src/services/goods-cost.js`、`src/services/views/goods-cost.js`。set/remove/list 返回 design §8.1 的固定形状，默认行与覆盖行精准操作，预演零写入；导入模块与主服务均单向依赖 input 模块。
- [ ] 本地 scope 从账号、有效 mall 参数/配置默认、账号 identity 确定；无 merchant 账号和无有效 mall 时 usage 错误，日志无导入内容及数据库路径。
- [ ] 所有新增枚举表放 `src/services/views/labels.js`；纯文本 spec 原样，不当枚举翻译。

验证：`npx vitest run test/services/goods-cost.test.js test/services/goods-cost-view.test.js test/infra/units.test.js`。

审查门 G3：元/分精度、当前值语义、预演无更新时间变化；现有 `parseYuanToFen` 行为保持不变。回退：服务尚未注册，无用户可见入口。

## 5. JSON 导入：校验全批再写

- [ ] 先新增 `test/services/goods-cost-import.test.js`：UTF-8/BOM、根数组、语法损坏、原生 JSON 属性语义、对象类型、未知列、账号/mall 列拒绝、缺字段、重复 goods/spec、特殊字符 spec、字节/记录上限。
- [ ] 钉死语义行错误为 1-based 记录序号；JSON 语法错误仅报告 row:null，使用固定安全消息，错误中无原始值/文件路径；保持省去物理行号计算与输出的简化。多条坏行同时报告，全批失败前后 DB 快照一致。
- [ ] 新增 `src/services/goods-cost-import.js`，复用 input 模块的单条 validator，所有异步读文件/解析校验均在事务外；通过 store 的单批 upsert 写入。
- [ ] 扩展 `goods-cost.js`/view：预演和确认的 items/total/inserted_count/updated_count 一致，确认分类在事务内复查；导入同键覆盖完整记录，省略可选项归零。

验证：`npx vitest run test/services/goods-cost-import.test.js test/services/goods-cost.test.js test/infra/goods-cost-store.test.js`。

审查门 G4：一条错误零写入、SQL 中途失败全回滚、解析器小函数拆分且无新依赖。回退：单次异常事务回滚；已提交的误录入使用校正 set/import 或备份恢复。

## 6. Runner 本地账号能力与成本命令接线

- [ ] 先新增 `test/commands/goods-cost-runtime.test.js`：`needsAccount:true` 的无浏览器路径仍填 accountId/account/meta；needsAccount 默认 false、stored 仅显式启用，每个既有命令的账号/认证/店铺/浏览器行为保持原样；多账号歧义/无账号/未知账号均正确 envelope。
- [ ] 最小修改 `src/commands/runner/{batch-executor,single-lifecycle}.js`：增加默认 false 的可选 `needsAccount`，仅显式 `needsMall:'stored'` 启用本地范围声明，其余默认值及既有分支不变。fixture/live 的本地分支共用一次执行路径。
- [ ] 测试过期/损坏登录态、无主密钥、被熔断账号仍可管理本地成本；不读 auth-state、不启动浏览器、不探测 mall、不自动重登、不访问 daemon；确认和预演 xhr_count 均为 0。DB 本身不可读仍按既有错误失败。
- [ ] 新增 `src/commands/goods/cost/{list,set,remove,import}.js`，修改 `src/commands/registry/goods.js`；金额 flags 原字符串、位置参数从 config.args 取；全部拒绝 all-accounts，写入保留 confirm。
- [ ] 新增 `test/commands/goods-cost-contract.test.js` 与 `test/e2e/goods-cost.e2e.test.js`；同一临时 DB 子进程串行 set -> list -> import -> remove -> account remove，验证成本及其他账号隔离。
- [ ] 注册命令同一步更新 `test/contract/data-contract-v2.test.js` 的四个 V2_CASES，防止注册清单出现缺口。list/remove/import 采用现有 execute hook 扩展方式建立临时数据，保证 items/entry 的白名单路径实际出现；不借空数组绕过检查。
- [ ] 如需复用 CLI 多次调用与临时文件，仅新增 `test/helpers/goods-cost-cli.js`；复用 `createCliSandbox`、`seedDb`、offline preload，不改 shared runCli 的默认行为。

验证：`npx vitest run test/commands/goods-cost-runtime.test.js test/commands/goods-cost-contract.test.js test/e2e/goods-cost.e2e.test.js test/contract/data-contract-v2.test.js test/commands/runner-deadline.test.js`。

共享 runner 门禁：`npm test`。审查门 G5：单行 JSON、emit exactly once、超时/abort、原有 needsAuth 和 batch/relogin 行为不变；本地能力与 spec 同步。回退：先撤销新命令注册避免半接线，再撤相关 handler；不改现有命令参数和输出。

## 7. 利润纯计算：先覆盖全部口径矩阵

- [ ] 先新增 `test/services/goods-profit-calculation.test.js`，测试输入不可变、稳定排序、普通整数分加减计算与数量乘法。
- [ ] 覆盖有成本、无成本 -> null、spec 精确覆盖、未命中回落、空 spec 默认、cost_updated_at 仅取实际使用记录的最大 updated_at、两账号同 ID 的隔离输入。
- [ ] 覆盖收入=实付+平台优惠、含买家运费、商家优惠不重复扣、数量按件而四类费用按单、普通待发货订单、退款已发货/未发货/发货未知、10/11 正常计入并单独合计金额。
- [ ] 覆盖未付款取消的收入和所有成本为 0；退款运费险/技术服务费随包材/快递：已发货扣、未发货为 0、shipping_time 缺失/无效为 null；未知售后码/字段缺失/缺数量/缺金额逐字段传播 null；拒绝读取 refund_status 等伪字段。
- [ ] 覆盖推广失败 -> null、完整无记录 -> 0、只有推广无订单商品、店铺级花费只影响 summary、全店所需输入未知时传播、零分母利润率 null、负利润和超过 ±100 的利润率原值保留。
- [ ] 覆盖订单截断/限流、group_time 缺失/无效时窗口财务 null，观测收入和单数保留，空样本与来源缺失区别明确。
- [ ] 新增 `src/services/goods-profit-calculation.js`，实现小粒度纯函数，不引用 DB/时钟/网络/环境。

验证：`npx vitest run test/services/goods-profit-calculation.test.js test/infra/units.test.js`。

审查门 G6：逐条对照 ADR 0004，不引入销量 valid scope、退款金额猜测、店铺推广分摊、保本 ROI 或盈亏分类。回退：算法尚未公开，可独立调整，保留已核对的输入输出测试。

## 8. 订单/推广采集与窗口编排

- [ ] 先新增 `test/services/goods-profit-collection.test.js`：固定上海完整自然日窗口且不含当天、跨月/跨年/UTC 宿主、since=start/until=end-1、all scope、50 pageSize、末页/触顶/限流、按 group_time 过滤、重复订单及缺 ID/成团时间；group_time 与下单时间不同的样本以成团时间归窗。
- [ ] 扩展 `test/services/orders-scope.test.js`、`test/adapter/orders-contract.test.js`，保证利润显式 all；复用 `src/services/diagnose/orders-collector.js` 的现有实现，不更改其 valid 默认。
- [ ] 先新增 `test/services/goods-profit-promo.test.js`：跨页同 goodsId 合计、重复 totals 不累加、已删除推广保留、无 goodsId 不按名称归属、完整无记录为 0、失败/截断/限流/未知单位为 null。
- [ ] 测试 `summary.promo_spend_yuan=entityReport totals.spend`，shop 花费为总计减商品归属额；负差额仅使 shop 花费 null 并提示，保留总计及按总计计算的净利润。保留跨页总额漂移测试，并断言固定 hint“仅含商品推广报表口径”。
- [ ] 修改 `src/adapter/endpoints/orders.js`：`fixtureListKey:'orders'`；修改 `src/adapter/endpoints/promo.js`：entityReport 的 `fixtureListKey:'entities'` 和可选明确日期入参，保留旧 since/until 路径。
- [ ] 扩展 `test/adapter/promo-money.test.js`，并新增 `test/adapter/goods-profit-promo-contract.test.js`，断言新日期参数、排他订单 end 对应包含式推广末日、旧 payload 不变、MoneyVO 空值传播与需要的报表字段。
- [ ] 新增 `src/services/goods-profit-promo.js`、`src/services/goods-profit.js`，调用既有 listOrders/getPromoReport；成本一次性快照、网络在事务外、abort 继续上抛、源失败不吞路径/敏感错误文本。
- [ ] fixture 分页使用临时 `endpoints/orders.list.page2.json`、`promo.entityReport.page2.json` 与 `__throws/__error`。正常 fixtures 通过真 normalize 生成；保持 direct fixture 分支，不替换成 FixtureEndpointClient。

验证：`npx vitest run test/services/goods-profit-collection.test.js test/services/goods-profit-promo.test.js test/services/orders-scope.test.js test/adapter/orders-contract.test.js test/adapter/promo-money.test.js test/adapter/goods-profit-promo-contract.test.js`。

审查门 G7：所有页与成团时间窗口一致，报表总计扣一次，负差额处理与固定口径 hint 正确；数据完整即可计算全店净利润。回退：新日期参数可独立撤回，旧端点调用行为保留；不更改共享 collector 默认值和限流器。

## 9. 利润视图、命令与契约全链路

- [ ] 先新增 `test/services/goods-profit-view.test.js`：严格匹配 item/summary/data_quality 全部字段白名单，上海 _at、元金额、cost_updated_at 为实际使用记录的最大时间、毛利率/净利率定义与有符号百分数例外、中文 availability 标签、null 与明确零。
- [ ] 新增 `src/services/views/goods-profit.js`、修改 `src/services/views/labels.js`；按 design §8.2 生成最多三句事实 headline，固定两项高估提示、当前成本重算提示、商品推广报表范围提示和动态质量 hints。
- [ ] 新增 `src/commands/goods/profit.js` 并在 `src/commands/registry/goods.js` 注册，`--days` 默认 30、只接受整数 1–90；测试 1/90 成功及 0/91/负数/小数/非数为 E_USAGE / exit 2。goodsId 保持文本；`--goods-id` 仅筛 items，summary 全店。
- [ ] 扩展 `test/fixtures/test-data.js` 的利润合成 builders，明确提供窗口内的 group_time（动态或固定时钟可控），并覆盖与下单时间不同的样本；不改变旧 fixtures 默认值。
- [ ] 新增 `test/e2e/goods-profit.e2e.test.js`：set/import 成本后查利润；有/无成本、规格覆盖/回落、退款已发货/未发货、10/11、推广失败/空记录、shop-level 花费、空窗、过滤、分页截断/限流、负利润、长 ID、无 PII/原始对象；准确断言字段值和完整性状态，避免仅测键存在。
- [ ] 更新 `test/contract/data-contract-v2.test.js` 的 goods.profit V2_CASES；通过 execute hook 在同一 sandbox 先录入成本，再返回实际 profit envelope。entityFields 覆盖 items、summary、summary.data_quality；使用非空路径样本。
- [ ] 扩展 `test/e2e/factual-surface.e2e.test.js` 或新 e2e 断言无 break_even、盈亏分类、评分、建议文字，技术 warning 在 meta，业务 hint 在 data，stdout 恰好单行。

验证：`npx vitest run test/services/goods-profit-view.test.js test/e2e/goods-profit.e2e.test.js test/contract/data-contract-v2.test.js test/e2e/factual-surface.e2e.test.js`。

审查门 G8：逐一勾对 PRD 八类 fixture 场景与父任务契约；全店总额不随商品过滤改变；无成本商品不会从 summary 被悄悄排除。回退：先撤新命令注册再撤编排/视图；成本数据继续保存，不自动清库。

## 10. 文档、部署回退与最终门禁

- [ ] 更新 `README.md` 命令表/示例、`skills/pdd-cli/SKILL.md` 参数与字段说明；解释本地成本需要登记账号但无需在线登录、confirm 预演、JSON 模板、days 1–90 与成团时间完整自然日窗口（上海、不含当天、结束排他）、spec 精确覆盖、当前值重算、全店 summary、免费后台缺少商家成本/退款明细/补贴共担信息。
- [ ] 说明两项高估：仅退款不退货、商家共担的平台补贴；说明未知值 null、成功无推广记录 0、截断不完整和成本更新时间含义。
- [ ] 同步 `.trellis/spec/infra/sqlite-storage.md` 的最新 schema、级联表与版本测试；同步服务/命令/runner/输出 spec 的已定新契约，显式记录 gross_margin_pct/net_margin_pct 允许负值和超过 ±100、保持原值的百分数例外。README 旧分层守卫描述如在相关段落修正为人工 review，避免承诺已删除测试。
- [ ] 满足功能验收后，将 `docs/adr/0004-goods-profit-reporting-semantics.md` 状态改 Accepted，同步评审已明确的补充口径；本轮 planning 保留该文件原样。
- [ ] G9 部署演练仅用临时数据库：升级前一致备份 DB + master.key、升级 v2 -> v3、确认旧版拒绝新库、恢复备份和旧版可读。禁止手动降 user_version；恢复前保留升级后的完整副本，记录回退会丢失备份后的更新。

文档相关针对验证：`npx vitest run test/contract/data-contract-v2.test.js test/e2e/goods-cost.e2e.test.js test/e2e/goods-profit.e2e.test.js test/e2e/sqlite-auth-storage.e2e.test.js`。

最终必须执行：

```bash
npm test
git diff --check
git diff --stat
git status --short
```

- [ ] 人工检查 import 方向、函数长度/嵌套、无 console.log、新 runtime dependency 为零；不新增 layering guard。
- [ ] 复核 diff 仅含本任务范围，无真实账号/订单/图片 URL、data/log/master.key、临时 fixture 和本地配置混入。fixture 账号/订单/店铺均为合成值，按 spec.name 命名。
- [ ] 检查新增五个命令均已被 v2 guard 发现并实际执行成功，PENDING_COMMANDS 保持空。
- [ ] 最终 `npm test` 全通过后完成本期功能验收；店铺关注/询单覆盖可留后续有投放数据时验证，本期按已确定的商品推广报表口径交付。
- [ ] 汇报实际执行的测试与结果、未执行的真实来源验证、部署备份/回退风险；`npm run lint` 是 no-op，无 build 步骤，不声称 lint/build/CI 覆盖。提交与归档按用户指示及 Trellis 流程另行完成。
