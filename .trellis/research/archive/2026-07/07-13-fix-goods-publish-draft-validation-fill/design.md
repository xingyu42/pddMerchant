# 技术设计：修复上货草稿校验与 SKU 字段写入

## 1. 问题拆解

本任务不是单一选择器修复，而是三段数据契约同时不完整：

```text
消费者源商品页
  -> source-scraper（当前只有最低价 + skuText）
  -> pricing-validator（当前只生成统一价格，无库存）
  -> form-filler（当前按全页输入框顺序填写）
  -> 保存请求体（当前只注入运费模板，不校验 SKU）
  -> 草稿详情查询（缺少业务状态守卫；原始误报的具体响应尚未留证）
```

真实证据：

- `src/adapter/goods-publish/source-scraper.js:219-225` 只提取一个 DOM 价格和 `skuText`，没有逐 SKU 数据。
- `src/services/pricing-validator.js:9-30` 只基于最低价生成统一团购价/单买价/参考价，`skuPrices` 恒为空。
- `src/adapter/goods-publish/form-filler.js:274-280` 取全页前两个 `placeholder*=请输入` 输入框，真实页面前面还有商品货号等字段。
- 库存没有任何填写逻辑。
- 原始运行只留下三项 issue，没有留下详情接口业务状态或响应结构。当前已加载编辑页证明页面状态与三项全空冲突，但原始误报仍可能来自业务失败、响应嵌套漂移或保存后竞态；本次没有取得一次干净的重新加载证据，不能把当前页面状态进一步表述为已证明的原始持久化状态。
- 事后手工调用复现了 `success=false / error_code=2000000 / result=null`；当前 `verifyDraft()` 会把该失败响应交给 `collectDraftIssues()` 并生成相同三项 issue。这证明代码存在该缺陷路径，但重复探测可能触发频率限制，不能反推原始调用一定收到同一响应。
- 人工确定性复现还确认：成功响应若将详情包在 `result.data`，当前代码也会生成相同三项 issue；现有 62 个 goods-publish 单测没有覆盖这两个分支。因此原始错误文本不能用于区分“业务失败”与“响应层级漂移”。
- 真实源接口 `/proxy/api/api/oak/integration/render` 返回 `encrypt_status=3`，主要数据位于约 20KB 的 `encrypt_info`；页面运行时没有稳定的 `rawData`，两次实时探测也没有可遍历的 React 根状态。因此不能把未经验证的全局变量或浅层 React props 继续当稳定契约。

## 2. 设计原则

- 不猜数据：禁止统一最低价覆盖所有 SKU，禁止库存默认 `999` 或其他魔法值。
- 先验证源数据，再创建商家草稿：源 SKU 不完整时在 `selectCategory()` 前失败。
- 写前验证优先：保存请求体是本次实际写入的最直接证据，应在放行网络请求前校验。
- 平台查询失败与字段缺失分开：接口不可用不能转成三个字段缺失。
- 外部结构在 adapter 归一化，service 只消费稳定领域对象。
- 不实现或复制 PDD 加密算法；使用页面自身已解密的数据边界，找不到时失败关闭。

## 3. 稳定领域契约

源抓取层新增结构化字段，保留旧的展示字段仅用于诊断：

```js
{
  goodsID,
  goodsName,
  categoryIds,
  carousel,
  detailImgs,
  sourceReferencePriceCents: 5900,
  skuDimensions: [
    {
      name: '颜色分类',
      values: [{ id: '...', text: '蓝色' }],
    },
  ],
  skus: [
    {
      sourceSkuId: '...',
      specValues: { 颜色分类: '蓝色', 身高: '90' },
      sourcePriceCents: 1470,
      sourceNormalPriceCents: 2580,
      stock: 12,
    },
  ],
}
```

约束：

- `skus[].specValues` 必须能唯一覆盖一个规格组合。
- `sourcePriceCents` 与 `sourceNormalPriceCents` 必须为正整数。
- 源商品顶层 `linePrice` 按“元”精确转为正整数 `sourceReferencePriceCents`；它必须严格高于所有 `sourceNormalPriceCents`。
- SKU `marketPrice` 不是参考价来源；字段缺失或值为 `0` 时也不得用倍率猜值。
- `stock` 必须为非负安全整数；字段不存在与真实 `0` 必须区分。
- 多 SKU 的组合数量必须等于规范化 SKU 数量，且组合键唯一。
- 不把仅有 `skuText` 的结果标记为完整多 SKU。

## 4. 源 SKU 提取边界

### 4.1 首选路径：页面自身解密后的运行时对象

在 `evaluateInMainWorld()` 中增加一个有界、可测试的 extractor：

1. 遍历页面实际存在的框架状态入口，而不是固定 4 个浅层 props。
2. 用商品 ID、规格维度、SKU 数组和价格/库存字段共同判定候选对象。
3. 只把候选对象投影成稳定领域字段，不返回完整运行时对象。
4. 设置对象数、深度和 SKU 数量上限，防止循环结构和超大遍历。

实施前必须先用目标商品取得一份脱敏结构样本（只保留键名、类型和数量）。没有样本时不提交猜测字段的 extractor。

### 4.2 接口响应路径

保留 `oak/integration/render` 响应引用用于诊断和未来兼容：

- 明文响应可交给同一个 normalizer。
- `encrypt_status=3` 且只有 `encrypt_info` 时，不在 CLI 内实现私有解密；等待页面自身解密结果。
- 页面未落地结构化数据时返回明确 `E_SOURCE_SKU_UNAVAILABLE`（仍使用 `PddCliError` / `ExitCodes.BUSINESS`），并在商家草稿创建前停止。

### 4.3 缓存迁移

`goods-publish-source-cache` 的投影和版本必须包含 `skuDimensions + skus`。旧版只有 `price + skuText` 的缓存视为 miss，不能用于新流程。

## 5. 逐 SKU 定价

`pricing-validator` 对每个源 SKU 保留真实售价语义：

- 拼单价：原样使用该 SKU 的 `sourcePriceCents`。
- 单买价：原样使用该 SKU 的 `sourceNormalPriceCents`，不得再由拼单价乘倍率生成。
- 参考价：原样使用源商品顶层 `linePrice` 对应的 `sourceReferencePriceCents`，不得使用 SKU `marketPrice` 或 `groupPrice * 1.8` 回退。
- 参考价必须为正数并严格大于所有 SKU 单买价，否则整个源快照不完整，在创建草稿前失败。
- 库存：使用规范化的源库存，不提供隐式默认值。
- 价格/库存缺一项则整个源快照不完整，在创建草稿前失败。

输出稳定 `skuPricing[]`，每项带规格组合键，而不是依赖数组顺序。

## 6. 商家表单填写

### 6.1 规格选择

- 根据 `skuDimensions` 填写颜色、尺码等规格值。
- 等待商家后台生成组合表格，并读取每行可见规格文本。
- 将规格文本规范化成组合键，再与 `skuPricing[]` 按键匹配。
- 任一行未匹配、重复匹配或行数不一致时停止，不能按索引回退。

### 6.2 价格和库存

- 输入框必须在已识别的 SKU 表格行容器内按列语义定位。
- 单 SKU 也走同一行级填写契约；不再使用全页前两个输入框。
- 用 Playwright `fill()` 触发框架事件，并读回输入值；必要时等待保存 payload 反映新值。
- 参考价单独按现有语义选择器填写。

## 7. 保存请求校验

扩展现有 `routeSaveDraftWithCostTemplate()`：

1. 解析 `/glide/mms/goodsCommit/action/edit` 的真实请求体。
2. 注入 `cost_template_id`。
3. 调用纯函数 `validateDraftEditPayload()`，校验：
   - 标题非空；
   - `gallery` 非空；
   - 运费模板存在且匹配；
   - SKU 数量与预期组合数一致；
   - 每个 SKU 的拼单价、单买价和库存有效；
   - 规格组合唯一且与源快照一一匹配。
4. 校验失败时在 `route.continue()` 前中止保存，并返回非敏感问题代码。
5. 校验成功才放行请求，保存响应仍需满足平台成功码。

这解决“页面看起来填了但 React 保存状态没更新”的问题，也避免依赖不稳定的详情查询来判断本次实际提交内容。

## 8. 保存后详情查询语义

- 下一次真实写入前先加脱敏观测：只记录 `success / error_code / result 类型 / 规范化候选路径 / issue`，不记录字段值或原始响应。
- 先检查 HTTP/业务成功，再读取 `result`。
- `success=false`、`result=null` 或平台瞬时错误归类为 `verification_unavailable`，不能调用 `collectDraftIssues()`。
- 字段缺失问题只能从成功的详情对象中产生。
- 默认草稿模式：保存请求体校验成功且保存响应成功时可返回草稿成功；详情查询不可用通过 warning 暴露。
- `--confirm`：提交前要求保存请求体和保存响应均成功。详情查询不可用只产生 warning，不阻止提交；查询成功且确认字段缺失时阻止提交。这样既不依赖持续返回“网络繁忙”的辅助接口，也不绕过写前严格校验。

## 9. 错误与日志

- 新问题代码使用稳定、非敏感枚举，例如：
  - `source_sku_unavailable`
  - `sku_combination_mismatch`
  - `sku_price_invalid`
  - `sku_stock_missing`
  - `draft_verification_unavailable`
- 不在日志或 envelope 输出原始响应、图片 URL、Cookie、消费者身份或代理节点。
- 日志只记录 SKU 数量、维度数量、问题代码、草稿 ID 和散列/非敏感标识。

## 10. 兼容与回滚

- CLI 参数和默认“仅保存草稿”行为不变。
- Fixture 模式不启动真实浏览器，新增结构化 SKU fixture。
- 源缓存版本升级自动使旧缓存失效，不做就地迁移。
- 实施分为可独立回滚的三个提交面：源 SKU 契约、表单/保存请求校验、详情校验语义；不恢复已删除的旧 API payload 模块。
