# 实施计划：修复上货草稿校验与字段写入

## 阶段 0：实施前证据门

- [x] 完成人工交叉审查：确认业务失败对象和嵌套成功对象都会稳定复现原始三项错误；确认现有 62 个单测未覆盖这两个分支；确认当前浏览器页标题、模板和图片存在。
- [x] 先增加仅含业务状态、结果类型、字段键名和 issue 的草稿详情脱敏观测点；不得输出原始响应或图片 URL。
- [ ] 下一次真实草稿运行只调用一次详情查询并保留该次脱敏证据，区分业务失败、响应嵌套漂移与保存后竞态；不得用事后重复调用替代原始现场。
- [x] 对目标商品 `447841256386` 完成一次只读运行时原始抓取；原始文件只保留在忽略的 `data/investigation/`，任务记录只保存稳定字段、类型和数量。
- [x] 确认候选对象提供 2 个规格维度、18 个唯一组合、逐 SKU `groupPrice` / `normalPrice` / `quantity`，以及商品顶层 `linePrice`。
- [x] 将脱敏字段形状和目标价格样本固化到 normalizer、source-scraper、pricing 与 cache 单测；测试数据不包含 Cookie、代理节点、图片 URL 或 `encrypt_info`。

人工交叉审查只确认了缺陷机制和测试缺口，没有确认原始事故属于哪一种响应；因此不替代后续同运行证据门。

## 阶段 1：源 SKU 稳定契约

- [x] 在 adapter 层新增纯 normalizer，将显式页面运行时候选对象投影为 `sourceReferencePriceCents + skuDimensions + skus`；目标商品真实规格与价格样本已于 2026-07-16 取证。
- [x] 扩展 `scrapeSourceGoods()`：保留 `oak/integration/render` 响应引用，等待页面解密状态，提取结构化 SKU。
- [x] 扩展 `validateScrapedData()`：区分真实单 SKU、真实多 SKU和抓取缺失；SKU 不完整时在 `selectCategory()` 前失败。
- [x] 增加遍历深度、对象数量、SKU 数量和组合唯一性限制。
- [x] 更新 `goods-publish-source-cache` 投影并升级缓存版本；旧缓存自动失效。

验证：

```powershell
npx vitest run test/goods-publish.unit.test.js test/goods-publish-source-cache.unit.test.js
```

## 阶段 2：逐 SKU 定价计划

- [x] 扩展 `buildPricingPlan()`，对每个源 SKU 生成带组合键的 `skuPricing[]`。
- [x] 扩展 `validatePricingPlan()`，拒绝非正价格、缺库存、重复组合和组合数量不一致。
- [x] 删除任何统一最低价或库存魔法值回退；不得恢复旧 `sku-mapper.js` 的 `quantity_delta: 999`。
- [x] 加入不同 SKU 价格、库存 0、缺库存、重复组合、超大组合数测试。
- [x] 使用目标商品的真实取证确认 `groupPrice="14.7"`、`normalPrice="25.8"` 是“元”的字符串；严格转为 1470/2580 分，并让草稿拼单价/单买价原样使用 14.70/25.80，不再应用售价倍率。
- [x] 确认商品顶层 `linePrice="59"` 是参考价来源，严格转为 `sourceReferencePriceCents=5900` 并写入草稿 `59.00`；SKU `marketPrice=0` 不参与，删除 `groupPrice * 1.8` 回退。
- [x] 参考价缺失、非正数或不严格高于所有 SKU 单买价时，在创建草稿前失败；缓存版本升到 v3，旧缓存自动失效。

验证：

```powershell
npx vitest run test/pricing-validator.unit.test.js test/goods-publish.unit.test.js
```

如果当前没有独立 `pricing-validator` 测试文件，在现有 goods-publish unit 中建立专用 describe，避免为测试拆分生产模块之外的无谓文件。

## 阶段 3：规格与 SKU 表格填写

- [x] 用目标商家草稿页的真实 DOM 结构更新规格选择器和 SKU 表格容器选择器。
- [x] 实现规格值选择与表格稳定等待。
- [x] 实现表格行规格组合键提取，并与 `skuPricing[]` 一一匹配。
- [x] 在每行容器内填写库存、拼单价和单买价；单 SKU 复用相同语义定位。
- [x] 填写后读回值；任一行不匹配或值无效时返回 `E_BUSINESS`。
- [x] 保持标题、轮播图、详情图和参考价现有路径，不扩大到商品属性映射。

验证：

```powershell
npx vitest run test/goods-publish.unit.test.js test/form-filler.unit.test.js
```

## 阶段 4：保存请求体严格校验

- [x] 从 route handler 中抽取纯函数 `validateDraftEditPayload()`。
- [x] 在 `route.continue()` 前校验标题、`gallery`、模板、SKU 组合、价格和库存。
- [x] 返回脱敏的校验摘要给 `clickSaveDraft()`；不保留/输出完整 payload。
- [x] 请求体校验失败时 abort route、移除 handler，并确保不会误报保存成功。
- [x] 覆盖 `gallery` 字段、模板不一致、零价、缺库存和 SKU 组合不一致测试。

验证：

```powershell
npx vitest run test/goods-publish.unit.test.js
```

## 阶段 5：修复详情校验误报

- [x] 草稿详情响应先经过业务成功检查，再规范化 `result`。
- [x] `success=false / result=null`（包括已复现但未证明属于原始现场的 `error_code=2000000`）返回 `draft_verification_unavailable`，不得产生 `title_empty / no_cost_template / no_images`。
- [x] 只有成功详情对象才能产生真实字段缺失问题。
- [x] 将详情不可用作为 `draft_verification_unavailable` warning 传回 service；不阻止已通过请求体校验和保存响应校验的流程。
- [x] 保持 `--confirm` 提交仅发生在所有必需校验通过之后。

验证：

```powershell
npx vitest run test/goods-publish.unit.test.js test/pbt/goods-publish.pbt.test.js
```

## 阶段 6：集成验证

- [ ] Fixture 模式新增结构化单 SKU、多 SKU、SKU 缺失和详情查询业务失败用例。
- [x] 运行现存上货相关 unit/PBT；原 `test/goods-publish.e2e.test.js` 已在本任务开始前处于删除状态，未恢复用户改动。
- [x] 因改动跨 adapter/service/cache/外部错误契约，运行完整测试；沙箱内唯一 PID 探测失败已在沙箱外复跑通过。
- [x] `npm run lint` 已运行并确认为 no-op，不作为质量证明。
- [x] 检查任务范围 `git diff`，未包含 `data/`、消费者登录态、代理信息、完整平台响应或临时诊断脚本。

```powershell
npx vitest run test/goods-publish.unit.test.js test/goods-publish-source-cache.unit.test.js test/pbt/goods-publish.pbt.test.js
npm test
git diff --check
git status --short
```

## 阶段 7：人工真实草稿验证

- [x] 使用目标商品执行不带 `--confirm` 的真实命令，只创建草稿。
- [x] 临时 E2E 预置 v3 源缓存并配置故意不支持的抓取 provider；断言命中缓存，且 stderr 不出现源页面、代理租约或移动商品 URL，证明未触发商品抓取数据源。
- [x] 成功结果返回新草稿 `goods_id=978682033971`、`goods_commit_id=196279140280`，未出现三个历史误报。
- [x] 通过真实 Chrome 只读核对标题、10 张轮播图、19 张详情图、默认运费模板、18 个规格组合、库存 1000、拼单价 14.7 和单买价 25.8。
- [x] 未带 `--confirm`，未触发提交发布，也未删除旧草稿 `195935511588`。

## 风险与回滚点

- 源页面结构/加密边界漂移：阶段 0 未取得真实结构时不实现猜测 extractor。
- 商家表格选择器漂移：请求体严格校验是最终防线，未匹配时阻止保存。
- 缓存结构变化：版本升级使旧缓存失效，可单独回滚缓存版本和投影。
- 详情接口若持续不可用：保留请求体校验和保存响应为主证据，详情查询不再制造字段误报；但必须把“持续不可用”与“原始误报根因”分开记录。

## 当前验证记录（2026-07-13）

- 定向：9 个相关测试文件、132 项通过。
- Fixture CLI：默认草稿模式返回 `status=draft`，未提交发布。
- 全量：129 个文件中 128 个通过；998 项中 997 项通过。唯一失败为任务外既有 `test/pbt/auth-lock.pbt.test.js`，`PBT_SEED=42` 可稳定复现 Windows PID 探测 `Access denied`。
- 真实源：当前消费者会话对目标商品只返回匹配 `goods_id` 的空 SKU 壳对象；严格等待和正式抓取参数复用均未得到非空 `skus`，已停止重复请求。
- 当时阶段 0 的成功源 SKU 取证和阶段 7 的真实新草稿核查均未完成；阶段 0 已于 2026-07-16 补齐，阶段 7 仍未执行，因此任务保持 `in_progress`。

## 环境一致性阻塞项补强（2026-07-14）

- [x] 对照 Patchright、Playwright 和 Chrome 官方资料，确认默认无头壳与统一 Headless Chromium 的运行表面存在差异。
- [x] 默认无头启动改为 `channel: 'chromium'`；有头模式、fresh Context、`storageState` 和消费者代理隔离契约保持不变。
- [x] 未覆盖 UA、请求头或 `navigator`，未恢复 plugins/WebGL/Canvas 等手写伪装脚本。
- [x] 本机启动探针确认 `navigator.webdriver=false` 且 getter 保持原生，plugins 从 0 恢复为 5，`window.chrome` 从缺失恢复为存在；真实 UA 仍含 `HeadlessChrome`，不宣称不可检测。
- [x] 浏览器相关定向验证 6 个文件、19 项通过；全量为 132 个文件通过、1 个沙箱 PID 探测失败，失败文件在沙箱外复跑 6/6 通过。
- [x] 该补强只消除一个已确认的环境差异，不自动触发阶段 7 的真实草稿请求；阶段 0 的真实源 SKU 取证已于 2026-07-16 另行补齐。

## React/MobX 详情边界修复（2026-07-15）

- [x] 对比 `兵哥哥采集解析3.01` 的活跃详情链路，确认其不是直接消费详情 API，而是读取 `window.rawData` / React Fiber 中的 `store.initDataObj.goods`。
- [x] 真实脱敏探针在目标商品上观察到 18 个 SKU；完整记录包含 `goodsId`、`skuID`、`groupPrice`、`normalPrice`、`quantity` 和 `specs[].spec_key/spec_value`，父商品和数组也可能由 MobX observable-value / iterable 包装。
- [x] 源抓取改为主世界有界遍历 `rawData + React expando roots`，识别 MobX `.value` 包装和 iterable observable arrays，并从逐 SKU `specs` 反推规格维度。
- [x] 脱离父数组的完整 SKU 记录只有在精确匹配目标 `goods_id` 且唯一 SKU 数量等于非空父数组数量时才可替换，避免推荐商品或部分 SKU 被误判完整。
- [x] 完整结构化 SKU 不再被通用“打开 APP”文案覆盖；结构不完整时仍失败关闭。
- [x] 软风控诊断只输出维度/SKU 数量、稳定 issue 和 pathname，不再泄露查询参数中的消费者 `uin`。
- [x] 定向回归 6 个文件、90 项通过；新增 MobX、`spec_key/spec_value`、精确目标聚合、推荐排除和 APP 文案优先级用例。
- [x] 全量 132 个文件通过；唯一沙盒内失败仍为 Windows PID 探测 `Access denied`，沙盒外复跑 `test/pbt/auth-lock.pbt.test.js` 6/6 通过。
- [x] 这是 2026-07-15 当时状态；2026-07-16 的只读原始抓取已补齐 SKU/价格证据门，但仍未创建新草稿，阶段 7 继续保持未执行。

## 源参考价证据与严格契约（2026-07-16）

- [x] 用户执行 `scripts/capture-goods-detail-raw.mjs`，产物目录为 `data/investigation/2026-07-15T19-27-48-690Z_goods-447841256386-raw/`；本任务未把 `data/` 内容加入版本控制。
- [x] `runtime-goods.json` 证据：`goodsID=447841256386`、`linePrice="59"`、2 个规格维度、18 个 SKU；每个 SKU `groupPrice="14.7"`、`normalPrice="25.8"`、`quantity=1000`，而 `marketPrice=0`。
- [x] 当前投影 + normalizer + pricing 的只读确定性校验得到：`complete=true`、0 issue、18 SKU、参考/拼单/单买价分别为 `59.00 / 14.70 / 25.80`，`validatePricingPlan().ok=true`。
- [x] 定向验证：6 个文件 109 项通过；扩展商品发布验证：4 个文件 37 项通过；`git diff --check` 和 4 个生产文件 `node --check` 通过。
- [x] 全量验证：沙箱内 1073 项通过、唯一失败为 Windows `tasklist` 权限限制；同种子 `auth-lock` 沙箱外 6/6 通过，随后沙箱外全量 133 个文件、1074 项通过，1 个文件/1 项按设计跳过。
- [x] 该条为 2026-07-16 当时状态；阶段 7 已于 2026-07-17 获得授权并完成，仍未触发提交发布。

## 真实草稿验收（2026-07-17）

- [x] 临时 E2E 位于忽略的 `data/investigation/2026-07-15T19-27-48-690Z_goods-447841256386-raw/goods-publish-draft.live.e2e.test.mjs`，不进入版本控制。
- [x] 运行使用调查数据写入 `tmp/goods-publish-source-cache/447841256386.json`；缓存命中先于故意不支持的抓取 provider，成功后缓存自动删除。
- [x] 真实页面取证并修复：标准色需要真实键盘事件和有界重试；SKU 表头/表体位于共同 `TB_outerWrapper`；同一行三个字段必须顺序写入；详情图使用 `quick_decoration` 语义区域；当前完成接口为 `POST https://file.pinduoduo.com/v3/store_image`。
- [x] 无 `--confirm` 运行成功返回 `status=draft`，草稿标识为 `978682033971 / 196279140280`，运费模板 ID 为 `545736332677433`，并保留 `draft_verification_unavailable` 警告而不制造字段缺失误报。
- [x] 随后只读打开新草稿：标题正确，轮播图 10 张，详情图 19 张，默认运费模板已选，18 行 SKU 全部为库存 1000、拼单价 14.7、单买价 25.8。
- [x] 定向质量门：9 个文件、127 项通过；补充图片/表单回归后 2 个文件、56 项通过。
- [x] 全量质量门：134 个文件中 132 个通过、1 个按设计跳过；1077 项中 1075 项通过、1 项按设计跳过，唯一沙箱失败为既有 Windows `tasklist` 权限限制；同一 `auth-lock` 文件在沙箱外 6/6 通过。
