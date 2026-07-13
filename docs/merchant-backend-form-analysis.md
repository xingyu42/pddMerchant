# 拼多多商家后台上货表单结构分析

> 基于真实商家后台页面抓取（2026-07-09）
> URL: https://mms.pinduoduo.com/goods/goods_add/index
> 测试类目：童装/婴儿装/亲子装 > T恤/打底衫

---

## 一、表单整体结构

表单分为 **3 个主区块**，每个区块有独立的序号标识：

```
1️⃣ 基本信息
   - 商品轮播图
   - 商品标题
   - 商品属性（填写率显示）
   - 商品视频（可选）
   - 商品详情

2️⃣ 规格与库存
   - 商品规格（颜色分类 + 尺码/自定义规格）
   - 价格及库存表格
   - 商品参考价
   - 满件折扣

3️⃣ 服务与承诺
   - 商品类型（普通/海外进口）
   - 是否二手/定制/预售
   - 承诺发货时间
   - 运费模板
   - 承诺（7天无理由/假一赔十）
```

---

## 二、核心字段详解

### 2.1 基本信息区

#### 2.1.1 商品轮播图
**selector**: `input[type="file"][accept*="image"]`（文件上传）
**要求**: 宽高比 1:1 或 3:4，宽高均 ≥480px，大小 ≤3M，最多 10 张
**交互**: 拖拽可调整顺序
**状态**: `已上传0/10张`

#### 2.1.2 商品标题
**selector**: `input[placeholder*="商品标题组成"]`
**测试 ID**: `data-testid="beast-core-input-htmlInput"`
**要求**: 最多 30 个汉字（60 字符）
**提示**: "商品标题组成：商品描述+规格"

#### 2.1.3 商品属性
**特征**:
- 显示 **填写率 0%**（动态计算）
- 警告文案: "请准确填写属性，有利于商品在搜索和推荐中露出，错误填写可能面临商品下架或流量损失"
- 每个属性字段都是 `input[placeholder="请选择"]` 或 `input[placeholder="请输入"]`

**关键属性（测试类目）**:
| 属性名 | 类型 | 是否必填 | 选择器特征 |
|--------|------|---------|-----------|
| 品牌 | 输入+搜索 | 重要 | `input[placeholder*="请输入品牌名称搜索"]` |
| 适用性别 | 下拉选择 | **重要** | label 包含 `重要适用性别` |
| 面料俗称 | 下拉选择 | **重要** | label 包含 `重要面料俗称` |
| 袖长 | 下拉选择 | **重要** | label 包含 `重要袖长` |
| 流行元素 | 下拉选择 | 可选 | |
| 图案 | 下拉选择 | 可选 | |
| 商品货号 | 文本输入 | 可选 | `input[placeholder="请输入"]` |
| 适用季节 | 下拉选择 | 可选 | |
| 厚薄 | 下拉选择 | 可选 | |
| 衣长 | 下拉选择 | 可选 | |
| 功能 | 下拉选择 | 可选 | |
| 适用年龄段 | 下拉选择 | 可选 | |
| 风格 | 下拉选择 | 可选 | |
| 上市时节 | 下拉选择 | 可选 | |
| 平方克重 | 下拉选择 | 可选 | |
| 是否加绒 | 下拉选择 | 可选 | |
| 领型 | 下拉选择 | 可选 | |

**注意**: 
- 标注 **"重要"** 的属性会影响填写率计算
- 所有 `input[placeholder="请选择"]` 字段需要点击后触发下拉框
- `input[placeholder="请输入品牌名称搜索"]` 支持搜索联想

#### 2.1.4 商品详情
**两种编辑模式**:

1. **快捷编辑** (`button` 包含 `快捷编辑` 文本)
   - 仅支持图片上传（最多 50 张）
   - 拖拽可调整顺序
   - 图片空间上传 / 本地上传

2. **装修商详** (`button[data-testid="beast-core-button"]` 包含 `装修商详` 文本)
   - 富文本编辑器
   - 可添加文字/图片、商品组件、高级组件

**默认行为**: 若未编辑，轮播图会自动填充至图文详情

---

### 2.2 规格与库存区

#### 2.2.1 商品规格（多 SKU 配置）

##### 颜色分类
**选择器结构**:
```html
<input placeholder="选择或输入主色" type="text" class="IPT_input_5-188-0" 
       data-testid="beast-core-input-htmlInput" value="">
<input placeholder="备注（偏深/浅等）" type="text" class="IPT_input_5-188-0" 
       data-testid="beast-core-input-htmlInput" value="">
<button>本地上传</button> <!-- 上传色卡图片 -->
```

**交互说明**:
- 点击主色输入框 → 弹出标准颜色选择器
- 可额外填写颜色备注（如"偏深"、"偏浅"）
- 支持本地上传色卡图片

##### 尺码/规格选择
**模板选择器**:
```html
<input placeholder="未使用模板" type="text" class="IPT_input_5-188-0" 
       data-testid="beast-core-input-htmlInput">
<a href="#">全部尺码表</a>
```

**尺码类型切换**（单选）:
- `input[type="radio"]` + `label` 包含 `身高`（默认选中）
- `input[type="radio"]` + `label` 包含 `国际标准`

**尺码值选择**（多选）:
```html
<label><input type="checkbox" value="on"> 全选以下规格值</label>
<label><input type="checkbox" value="on"> 48</label>
<label><input type="checkbox" value="on"> 52</label>
<label><input type="checkbox" value="on"> 59</label>
<!-- ... 更多尺码 -->
```

**自定义规格**:
- `input[placeholder="自定义参考分类"]` 可输入自定义规格值
- `button[data-testid="beast-core-button"]` 包含 `添加规格类型` 文本 → 新增规格维度（如"款式"、"口味"）

**新功能**:
- `button` 包含 `AI添加规格` 文本 → 自动识别商品图片并生成规格

##### 多 SKU 组合生成规则
**示例**:
```
颜色: [红色, 蓝色]
尺码: [S, M, L]

→ 自动生成 6 个 SKU 组合:
  红色-S, 红色-M, 红色-L,
  蓝色-S, 蓝色-M, 蓝色-L
```

#### 2.2.2 价格及库存表格

**表头结构**（抓取结果）:
```javascript
["*库存", "*拼单价(元)", "*单买价(元)", "规格编码", "商品编码", "状态"]
```

**表格 class**: `TB_tableWrapper_5-188-0`

**单行输入框**（5 个字段）:
```html
<!-- 库存 -->
<input placeholder="请输入" type="text" 
       data-testid="beast-core-input-htmlInput" value="">

<!-- 拼单价 -->
<input min="0" placeholder="请输入" type="text" 
       data-testid="beast-core-inputNumber-htmlInput" value="">

<!-- 单买价 -->
<input min="0" placeholder="请输入" type="text" 
       data-testid="beast-core-inputNumber-htmlInput" value="">

<!-- 规格编码 -->
<input placeholder="请输入" type="text" 
       data-testid="beast-core-input-htmlInput" value="">

<!-- 商品编码 -->
<input placeholder="请输入" type="text" 
       data-testid="beast-core-input-htmlInput" value="">
```

**状态列**: 显示 `已启用`（只读，无输入框）

**全屏编辑**: `<a href="#">全屏编辑</a>` → 打开弹窗批量编辑 SKU

**库存扣减方式**: 固定为 `支付成功减库存`（当前类目无选项）

#### 2.2.3 商品参考价
**选择器**:
```html
<input placeholder="应大于商品最大单买价" min="0" max="10000000" 
       type="text" class="IPT_input_5-188-0" 
       data-testid="beast-core-inputNumber-htmlInput" 
       data-tracking-click-viewid="goods_advice_price" value="">
```
**单位**: 元（后缀显示）
**校验**: 必须大于商品最大单买价

#### 2.2.4 满件折扣
**选择器**:
```html
<input placeholder="5.0~9.9" type="text" class="IPT_input_5-188-0" 
       data-testid="beast-core-input-htmlInput" 
       data-tracking-viewid="count_discount" value="9.5">
```
**固定配置**: `满2件` × `<输入折扣>` 折
**默认值**: `9.5` 折
**校验**: 5.0 ~ 9.9 范围
**提示**: "商品满件折扣与店铺内设置的优惠券、店铺购物车、新客立减等优惠均不叠加"

**动态显示**: `折后拼单价：--元`（实时计算）

---

### 2.3 服务与承诺区

#### 2.3.1 商品类型（单选）
```html
<input type="radio" checked> 普通商品
<input type="radio"> 海外进口
```
**默认**: 普通商品

#### 2.3.2 是否二手（单选）
```html
<input type="radio" checked> 非二手
<input type="radio"> 二手
```
**默认**: 非二手

#### 2.3.3 是否定制（单选）
```html
<input type="radio" checked> 非定制
<input type="radio"> 部分库存定制
```
**默认**: 非定制

#### 2.3.4 是否预售（单选）
```html
<input type="radio" checked> 非预售
<input type="radio"> 定时预售
<input type="radio"> 时段预售
<input type="radio"> 规格预售
```
**默认**: 非预售

#### 2.3.5 承诺发货时间（单选）
```html
<input type="radio" checked> 48小时发货及揽收
<input type="radio"> 24小时发货及揽收 获额外流量扶持
<input type="radio"> 当日发货及揽收
```
**默认**: 48小时发货及揽收

**周边发货时间**（可选复选框）:
```html
<input type="checkbox"> 周边区域提前至当天发货及揽收，享发货享时效权益 推荐
```

#### 2.3.6 运费模板（单选）
```html
<input type="radio" checked> 新疆西藏收费默认模板 推荐
<input type="radio"> 其他模板
<input type="radio"> 同城配送
```
**默认**: 新疆西藏收费默认模板

**包邮配送区域**: 显示已配置的省份列表（只读）
**买家付运费区域**: 显示西藏、新疆的计费规则（只读）
**不配送区域**: 香港、澳门、台湾（只读）

#### 2.3.7 承诺（多选）
```html
<input type="checkbox"> 7天无理由退货
<input type="checkbox"> 假一赔十
```
**提示**: 该类商品，必须支持【7天无理由退换货】服务

---

## 三、与现有代码的对照

### 3.1 已处理字段

| 必填项 | form-filler.js 实现 | 抓取字段 | 状态 |
|--------|-------------------|---------|------|
| 商品类目 | `selectCategory()` | — | ✅ 已处理 |
| 商品标题 | `findFirst(SELECTORS.goodsTitle)` | `@e10` | ✅ 已处理 |
| 主图（轮播图） | `uploadCarouselViaForm()` | `input[type="file"]` | ✅ 已处理 |
| 商品规格价格 | `fillPrices()` → `priceInputs[0/1]` | `@e80`, `@e81` | ⚠️ **仅单 SKU** |
| 商品参考价 | `findFirst(SELECTORS.marketPrice)` | `@e85` | ✅ 已处理 |

### 3.2 字段填充现状

| 必填项 | 抓取字段 | form-filler.js 现状 | 备注 |
|--------|---------|-------------------|---------|
| **多 SKU 规格配置** | `@e39`（颜色），`@e48`~`@e73`（尺码） | ⛔ 写前安全阻断 | 缺少逐 SKU 价格和可靠行匹配，不再静默回退单 SKU |
| **按 SKU 定价/库存** | `@e80`~`@e84`（表格行） | **未实现** | 需要抓取并按规格值匹配，不能按索引猜测 |
| 商品属性 | `@e12`~`@e29` | ⚠️ 仅 `parseProperties()` | 不自动写入未验证的动态字段 |
| 商品详情图 | `@e34`/`@e35`/`@e36` | ⚠️ 部分实现 | 校验第 8 个文件输入，并逐个确认上传完成；仍需真实表单定位证据 |
| 满件折扣 | `@e86` | **未实现** | 选择器和输入格式尚未验证，不自动写入 |
| 商品类型 | `@e87`/`@e88` | **无代码** | 单选按钮，默认"普通商品" |
| 二手/定制/预售 | `@e89`~`@e96` | **无代码** | 单选按钮，默认全"非" |
| 发货时间 | `@e97`~`@e99` | **无代码** | 单选按钮，默认"48小时" |
| 运费模板 | `@e101`~`@e103` | `clickSaveDraft()` 有 `costTemplateId` 参数 | ⚠️ 未验证表单关联 |

---

## 四、多 SKU 填充流程设计

### 4.1 当前 `parseSkuText()` 输出示例
```javascript
// source-scraper.js 抓取到的 skuText:
"颜色分类\n红色\n蓝色\n尺码\n90\n100\n110"

// parseSkuText() 解析结果:
[
  { name: '颜色分类', values: ['红色', '蓝色'] },
  { name: '尺码', values: ['90', '100', '110'] }
]
```

### 4.2 表单填充步骤

#### Step 1: 填充颜色分类
```javascript
// 目标: 填充 @e39（主色输入框）
const colorDim = skuDims.find(d => d.name.includes('颜色'));
if (colorDim) {
  const colorInput = page.locator('input[placeholder*="选择或输入主色"]');
  await colorInput.click(); // 触发颜色选择器
  // TODO: 需要确认选择器弹窗的 DOM 结构
  // 可能需要遍历 colorDim.values 并点击对应的颜色块
}
```

#### Step 2: 填充尺码
```javascript
// 目标: 勾选 @e48~@e73（尺码复选框）
const sizeDim = skuDims.find(d => 
  d.name.includes('尺码') || d.name.includes('身高')
);
if (sizeDim) {
  for (const sizeValue of sizeDim.values) {
    const checkbox = page.locator(`label:has-text("${sizeValue}") input[type="checkbox"]`);
    await checkbox.check();
  }
}
```

#### Step 3: 等待 SKU 表格生成
```javascript
// 表单会自动生成 SKU 组合表格
// 例如: 2 颜色 × 3 尺码 = 6 行
await page.waitForSelector('table tbody tr', { timeout: 5000 });
const skuRows = await page.$$('table tbody tr');
console.log(`生成了 ${skuRows.length} 个 SKU 组合`);
```

#### Step 4: 填充价格/库存表格
```javascript
// 目标: 逐行填充 @e80~@e84（库存、拼单价、单买价、规格编码、商品编码）
for (let i = 0; i < skuRows.length; i++) {
  const row = skuRows[i];
  const inputs = await row.$$('input');
  
  // inputs[0] = 库存
  await inputs[0].fill(String(pricing.defaultStock || 100));
  
  // inputs[1] = 拼单价
  await inputs[1].fill(pricing.groupPrice);
  
  // inputs[2] = 单买价
  await inputs[2].fill(pricing.singlePrice);
  
  // inputs[3] = 规格编码（可选）
  // inputs[4] = 商品编码（可选）
}
```

### 4.3 风险点

#### 风险 1: 颜色选择器弹窗结构未知
**现状**: 点击 `@e39` 后会弹出颜色选择器，DOM 结构需要额外抓取
**解决**: 需要在已打开的浏览器中点击颜色输入框，然后用 `snapshot` 抓取弹窗

#### 风险 2: SKU 表格行数不可预测
**现状**: 表格初始只有 1 行，勾选规格后动态生成
**解决**: 使用 `page.waitForFunction()` 等待表格行数稳定

#### 风险 3: 单 SKU vs 多 SKU 判定
**现状**: `form-filler.js` 当前假设所有商品都是单 SKU
**当前控制**: 在 `fillGoodsForm()` 的任何页面写入前计算组合数；多于一个 SKU 时明确停止:
```javascript
if (countSkuCombinations(skuDims) > 1) {
  throw new PddCliError({ code: 'E_BUSINESS', message: '暂不支持安全填充多 SKU 商品' });
}
await fillPrices(page, pricing, warnings, log);
```

---

## 五、下一步实施建议

### 优先级 P0（核心必填项，阻塞发布）
1. ⛔ **多 SKU 规格填充**（未实现，当前安全阻断）
   - 需要先补齐源端逐 SKU 价格、规格组合和商家表格行匹配
   - 当前在任何表单写入前返回 `E_BUSINESS`，避免生成错误草稿

2. ⚠️ **商品详情图上传**（部分实现）
   - `uploadDetailImagesViaForm()` 复用 `image-handler.uploadDetailImages()`
   - 部分失败记录警告；全部失败或详情图区缺失时停止保存

### 优先级 P1（提高成功率）
3. ❌ **商品属性映射**（未实现）
   - `parseProperties()` 从纯文本提取"属性名：属性值"结构化键值对
   - 当前仅解析源文本，不向未验证的商家动态字段写值

4. ⚠️ **运费模板关联验证**
   - 确认 `clickSaveDraft(costTemplateId)` 是否正确关联到 `@e101`~`@e103`

### 优先级 P2（完整性）
5. ❌ **满件折扣配置**（未实现）
   - 等待真实表单确认 `@e86` 的选择器、单位和保存请求字段后再实现

6. ❌ **商品类型/二手/定制/预售**
   - 默认值已选中，大部分场景无需修改
   - 可选实现: 新增参数控制这些单选按钮

7. ❌ **发货时间**
   - 默认 48 小时，可选实现: 参数化

---

## 六、技术决策

### 6.1 颜色选择器弹窗抓取
**方案 A（推荐）**: 
- 在已打开的浏览器中，手动点击颜色输入框
- 用 `snapshot --details` 抓取弹窗 DOM
- 分析弹窗中的颜色选项结构（可能是 `<div class="color-item" data-value="红色">`）

**方案 B**: 
- 在 Playwright 脚本中点击颜色输入框
- 用 `page.waitForSelector('.color-picker-popup')` 等待弹窗
- 用 `page.evaluate()` 抓取弹窗 HTML

### 6.2 SKU 表格填充策略
**方案 A（当前推荐）**: 
- 勾选规格后等待表格生成
- 用 `page.$$('table tbody tr')` 获取所有行
- 逐行填充（假设所有 SKU 同价）

**方案 B（未来扩展）**: 
- 支持按 SKU 组合差异化定价
- 需要解析表格每行的规格组合文本（如"红色-S"）
- 匹配到 `source.skuText` 中的价格（需要源商品支持多价格抓取）

### 6.3 商品属性解析
**当前 `source.properties` 示例**:
```
"商品详情\n材质：纯棉\n风格：休闲\n适用季节：春秋\n..."
```

**解析目标**:
```javascript
[
  { name: '材质', value: '纯棉' },
  { name: '风格', value: '休闲' },
  { name: '适用季节', value: '春秋' }
]
```

**实现**: 新增 `parseProperties(text)` 函数（类似 `parseSkuText()`）

---

## 七、总结

### 已验证的核心发现
1. **多 SKU 配置是两阶段流程**: 先填规格维度（颜色/尺码） → 后填价格库存表格
2. **表格是动态生成的**: 勾选规格值后才会生成对应的 SKU 组合行
3. **颜色输入框会触发弹窗**: 需要额外抓取弹窗结构
4. **所有输入框统一使用 `data-testid="beast-core-input-htmlInput"`**: 定位需要结合父元素上下文

### 代码审计结论
当前 `form-filler.js` 的覆盖范围：
- ✅ **单 SKU 商品**: 可正常发布（标题、主图、单一价格、参考价）
- ❌ **多 SKU 商品**: 会生成不完整草稿（缺少规格配置和分 SKU 定价）
- ⚠️ **商品详情图**: 已有独立完成响应校验，但详情图区定位仍需真实表单持续验证
- ❌ **商品属性**: 未填充，可能触发"必填属性缺失"校验

### 风险评估
| 风险项 | 严重程度 | 影响 |
|--------|---------|------|
| 多 SKU 规格缺失 | 🔴 高 | 多 SKU 商品无法发布或生成错误草稿 |
| 商品详情图缺失 | 🟡 中 | 草稿可保存，但商品详情页为空 |
| 商品属性缺失 | 🟡 中 | 可能触发平台校验错误，或影响搜索曝光 |
| 运费模板未关联 | 🟢 低 | `costTemplateId` 参数已存在，但未验证表单关联 |

---

**报告完成时间**: 2026-07-09  
**分析范围**: 商家后台上货表单完整结构 + form-filler.js 代码覆盖度对照  
**后续行动**: 优先实现 P0 多 SKU 规格填充 + 商品详情图上传
