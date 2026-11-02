# 技术设计：补齐商品属性与 SKU 预览图

## 1. 设计结论

在现有 UI 自动化上货路径中补齐两个写入能力，不新增 CLI 参数，不恢复已删除的整包 API 发布方案：

1. 从消费者端结构化运行时数据保留 `goodsProperty` 与每个 SKU 的 `thumbUrl`。
2. 新草稿创建后，复用官方商家后台内部模板端点 `GOODS_PUBLISH_TEMPLATE` 获取属性定义，生成确定性的属性填写计划。
3. 按精确标签/候选值用真实指针点击填写属性；对同页自动出现的动态属性有界读取当前 React 表单模型并继续精确填写；按颜色规格容器上传一张已证明属于该颜色的预览图。
4. 动态属性稳定后、唯一一次保存前，通过官方两步交互停用可能由尺码规格自动启用的尺码表，并以 DOM 消失作为读回证据。
5. 保存请求发出前同时校验 `goods_properties` 与 `skus[].thumb_url`，保留现有标题、轮播图、运费模板、SKU、价格、库存校验。

本任务保持为一个任务，不拆子任务。原因是 `.trellis/spec/services/goods-publish.md` 已把源投影、表单填写、保存 payload 和草稿核验定义为同一个写安全边界；拆开会产生“新源结构已生效但保存校验尚未生效”的不安全中间状态。

## 2. 当前接缝

- `src/services/goods-publish.js:367-395`：创建草稿、填写表单、保存草稿的活动编排点。
- `src/adapter/endpoints/goods-publish.js:50-68`：已有 `GOODS_PUBLISH_TEMPLATE`，当前活动发布流程尚未消费其结果。
- `src/adapter/goods-publish/source-scraper.js:339-350`：SKU 投影当前丢弃 `thumbUrl`。
- `src/adapter/goods-publish/source-scraper.js:471-502`：当前只把详情文本片段放入 `properties`，未保留 `goodsProperty`。
- `src/adapter/goods-publish/form-filler.js:384-425`：表单已填写规格、标题、图片和价格，但属性只产生 `property_mapping_unavailable` 告警。
- `src/adapter/goods-publish/form-filler.js:554-697`：保存路由已有请求前严格校验和 route abort 接缝。
- `src/adapter/goods-publish/image-handler.js`：已有图片域名白名单、临时下载、独立上传完成响应认领和详情图失败关闭逻辑。
- `src/services/goods-publish-source-cache.js`：缓存版本为 3，当前只接受字符串 `properties`，规范化 SKU 会丢弃缩略图。

## 3. 数据流

```text
消费者端 exact goods_id 运行时对象
  -> 有界投影 goodsProperties + SKU thumbUrl
  -> 源数据规范化/缓存 v4
  -> 类目解析与 UI 创建草稿
  -> GOODS_PUBLISH_TEMPLATE 捕获一次初始同源模板响应
  -> 纯函数生成 propertyPlan + skuPreviewPlan
  -> UI 精确填写属性 + 按颜色上传预览图
  -> 有界读取同页新增属性模型，补写新增 PID，循环到稳定
  -> 官方“停用尺码表” + “确认停用”，验证入口和表格均消失
  -> 页面读回
  -> 拦截 edit payload 并严格验证
  -> route.continue() / route.abort()
  -> 单次保存响应 + 可用时的草稿详情验证
```

模板端点属于 `mms.pinduoduo.com` 官方商家后台内部接口，不是公开稳定 Open API。端点响应结构不符合预期时直接失败，不回退到 DOM 顺序、旧模板或默认属性列表。

## 4. 源数据契约

### 4.1 商品属性

新增稳定字段：

```js
goodsProperties: [{
  name: '件数',
  values: ['两件套'],
  refPid: '367',
  referenceId: '0',
}]
```

- 从 exact `goods_id` 对象的 `goodsProperty`/兼容蛇形字段投影。
- 限制属性数、每个属性值数量和字符串长度；丢弃空记录，但不从详情文本补值。
- `properties` 详情文本只保留为旧诊断字段，不参与映射；后续可单独清理，避免本任务扩大范围。
- 缺少结构化属性时返回稳定 issue `source_properties_missing`，并在创建商家草稿前失败。

### 4.2 SKU 图片

在规范化 SKU 上保留 `thumbUrl`：

```js
{
  sourceSkuId,
  specValues,
  sourcePriceCents,
  sourceNormalPriceCents,
  stock,
  thumbUrl,
}
```

- 不用 SKU 数组索引推断颜色。
- 从 `specValues` 中唯一识别颜色/花色维度，按颜色分组。
- 同一颜色所有 SKU 的非空 `thumbUrl` 必须收敛到一张唯一图片；缺失或多张冲突产生 `sku_preview_mapping_missing` / `sku_preview_mapping_ambiguous`。
- 目标临时 E2E 继续在其数据投影层把 `灰色套装/蓝色套装/米黄色套装` 映射为已现场验证的商家标准色 `灰色/蓝色/黄色`，同时保留每个 SKU 的 `thumbUrl`。生产逻辑不增加通用“去掉套装”猜测。

### 4.3 缓存兼容

- `goods-publish` 源缓存升级到 v4，显式持久化 `goodsProperties` 与 SKU `thumbUrl`。
- v3 缓存缺少本任务需要的安全证据，不做静默迁移；按现有行为视为无效并回退实时抓取。
- 临时 E2E 使用缓存帮助器写入 v4，因此仍能证明没有访问源商品页。

## 5. 属性模板与映射

### 5.1 模板规范化

新增纯函数模块 `src/adapter/goods-publish/property-mapper.js`，把 `modules[].propertys[]` 规范化为：

```js
{
  templateModuleId,
  templatePid,
  pid,
  refPid,
  name,
  required,
  important,
  chooseMaxNum,
  values: [{ vid, value }],
}
```

- `required` 只来自模板 JSON 的 `required === true`。
- `important` 只来自模板 JSON 的 `is_important === true`。
- DOM 中 `<span>重要</span>` 仅用于现场/测试读回，不作为机器契约。
- 模板无 module、属性数组缺失、关键 ID 缺失或字段类型冲突时返回 `property_template_invalid`。

### 5.2 确定性匹配

属性匹配顺序：

1. 非空且相等的 `refPid` 唯一匹配。
2. 无 `refPid` 唯一命中时，使用规范化后的完整属性名唯一匹配。
3. 仅允许显式窄化别名 `面料/材质 -> [面料俗称, 材质]`；每个目标必须在当前类目模型中唯一存在，不做包含、编辑距离、拼音或首项回退。

值匹配规则：

- 对候选值做 Unicode/空白/破折号等无语义格式归一化后精确匹配。
- `棉/棉` 只有在分隔后的所有非空片段都相同时才折叠为 `棉`；不同片段不得选一个代表值。
- 每个源值必须唯一命中一个候选 `vid`；多值数量不得超过 `chooseMaxNum`。
- 一个属性只要有一个值缺失/非唯一，就不做部分填写。

失败策略：

- `required=true`：失败并标记 `required_property_unmapped`。
- `is_important=true`：失败并标记 `important_property_unmapped`，不伪称平台必填。
- 可选：跳过该属性并聚合一个 `property_mapping_partial` warning；日志只记录计数和稳定 issue，不输出完整模板响应。

### 5.3 UI 填写与读回

- 以规范化后的完整 `label` 文本唯一定位属性行，不能使用全页输入框索引。
- 品牌使用其专用搜索框；其他目标控件使用行内 `input[placeholder="请选择"]`。
- 点击后只在当前可见 `ul[role="listbox"] li[role="option"]` 中选择唯一精确候选。
- 候选必须通过 Playwright locator 的真实 `.click()` 触发；禁止 `evaluate()` 内调用 `element.click()`，因为现场证明后者不会触发依赖属性链。
- 多值按计划顺序逐个选择；每次 React 更新后重新定位行和控件。
- 填写后从行内 input/tag/可见文本读回全部计划值。读回失败产生 `property_readback_mismatch`，保存前停止。

### 5.4 同页动态属性

- 初始模板只调用一次；选择 `面料俗称` 后没有新的模板响应，不发送额外 `fetch()`，也不保存阶段草稿或重载页面。
- 新增 `dynamic-property-template.js`：仅扫描当前可见、且不在已知模板中的 `.property-list` 行；在 main world 中有界遍历该行的 React 根，只投影平台 ID、必填/重要标记、控件类型和候选值白名单。
- React 模型名必须与行标签精确相等；模块 ID 只有在初始模板恰好一个 module 时才允许回退。形状漂移、冲突、可见行无法解析均返回 `dynamic_property_template_invalid`。
- 每轮把新模型与已知模板严格合并，重新生成完整计划，仅填写新增 `templatePid`。所有初始填充后都执行稳定检查，最多 5 轮；未稳定返回 `dynamic_property_template_unstable`。
- 合并后的完整计划用于唯一一次最终保存的 payload 校验；SKU 图片 URL 仍必须与本次上传响应精确一致，不允许重载后的宽松 URL 兼容。

## 6. SKU 预览图上传

### 6.1 预览计划

`buildSkuPreviewPlan()` 以规范化 SKU 的规格值分组，返回：

```js
[{ merchantColor: '灰色', sourceImageUrl: '<redacted-at-log-boundary>' }]
```

- 商家颜色值必须已存在于 `skuDimensions`，并与 SKU `specValues` 一致。
- 每个颜色恰好一张源图；同色多个尺码复用，异色不共享。
- 空白新增颜色行不进入计划。

### 6.2 下载、上传、读回

- 复用 `downloadImagesToTemp()` 白名单和清理逻辑；任一计划图片下载失败即 `sku_preview_download_incomplete`，不上传、不保存。
- 在 `.goods-sku-row.standard-spec .new-spec-single-color` 中按行内主色 input 的当前值唯一匹配颜色容器。
- 每个非空颜色容器必须只有一个图片 file input；逐颜色上传并为每次上传预先注册独立 2xx 完成响应等待器。
- 记录上传响应返回的商家图片 URL 只存在内存中，不写日志/测试快照。
- 每次上传后在同一颜色容器检查预览图片/背景状态；没有页面读回则 `sku_preview_readback_mismatch`。

### 6.3 尺码表停用

- 选择标准尺码维度可能让页面自动启用尺码表；活动尺码表会阻塞最终上架，因此它属于保存前写安全门槛。
- 动态属性循环稳定后调用 `disableSizeChart(page)`，唯一定位 `a[data-tracking-click-viewid="disable_size_chart"]`，真实点击后再唯一点击精确文本“确认停用”。
- 只有停用入口和 `[class*="sizeChart_sizeTable"]` 都消失才算成功；两者原本都不存在时为安全无操作。
- 控件/确认缺失、非唯一或读回不一致统一以稳定 `size_chart_disable_*` issue 失败关闭，且不得进入保存。
- 不直接写 `size_spec_id`、`is_size_spec_sync_detail` 等字段。现场证明官方停用后的 `size_spec_id` 仍为非零值，payload 标量不是可靠的启停契约。

## 7. 保存请求硬校验

扩展 `validateDraftEditPayload()` 的 options：

```js
{
  expectedPropertyPlan,
  expectedSkuPreviewPlan,
  expectedSkuPricing,
  expectedCostTemplateId,
}
```

- `goods_properties` 必须包含计划中的每个 `template_pid/template_module_id/pid/vid/value` 组合。
- 所有 required/important 计划项必须存在；不能只检查数组非空。
- 对每个预期 SKU 继续先按规格组合唯一匹配，再校验 `thumb_url` 非空且等于对应颜色上传结果。
- 新增请求 issue：`goods_properties_missing`、`goods_property_mismatch`、`sku_thumb_url_missing`、`sku_thumb_url_mismatch`。
- 任一 issue 继续复用现有 route handler：`route.abort('failed')`，不向平台发出错误 payload。

草稿详情接口如果可用，则额外规范化 `goods_properties` 和 `skus[].thumb_url` 做保存后校验；接口不可用沿用 `draft_verification_unavailable`，因为请求前硬校验和页面读回已经完成。真实 E2E 再从草稿编辑页只读核对最终状态。

## 8. 错误、告警与脱敏

- 对外仍使用 `PddCliError` 和现有 envelope；用户可修复的映射、上传或尺码表停用失败使用 `E_BUSINESS` + `detail.issue(s)`。
- 仅可选属性跳过产生 `property_mapping_partial`。
- 错误 detail 只含属性/颜色计数、稳定 issue、是否 required/important；不含图片 URL、模板 raw、Cookie、代理或请求签名。
- `--json` stdout 继续保持单行；运行时不增加 `console.log`。

## 9. 变更文件计划

计划修改：

- `src/adapter/goods-publish/source-scraper.js`
- `src/adapter/goods-publish/source-sku-normalizer.js`
- `src/services/goods-publish-source-cache.js`
- `src/adapter/endpoints/goods-publish.js`
- `src/services/goods-publish.js`
- `src/adapter/goods-publish/form-filler.js`
- `src/adapter/goods-publish/image-handler.js`
- `test/goods-publish.unit.test.js`
- `test/goods-publish-source-cache.unit.test.js`
- `test/form-filler.unit.test.js`
- `test/adapter/form-filler.unit.test.js`
- `test/adapter/image-handler.unit.test.js`
- `data/investigation/2026-07-15T19-27-48-690Z_goods-447841256386-raw/goods-publish-draft.live.e2e.test.mjs`

计划新增：

- `src/adapter/goods-publish/property-mapper.js`
- `test/adapter/property-mapper.unit.test.js`

## 10. 工作区与回滚

- 当前工作区存在大量其他未提交改动，其中 `src/services/goods-publish.js`、`src/adapter/goods-publish/source-scraper.js` 直接与本任务重叠。实施前逐文件读取 `git diff`，只在现状上追加，不回退其他改动。
- 本任务不自动提交。完成后用按文件/按 hunk 的 diff 汇报范围。
- 回滚边界是上述属性/预览相关 hunk 与缓存 v4；不得用 `git checkout`、`reset` 或整文件覆盖回滚。
