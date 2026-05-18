# PDD 商品链接上货功能 — 接口侦察报告

> 数据来源：jshook 抓包 mms.pinduoduo.com + mobile.yangkeduo.com (2026-05-13)
> category.chunk.js 静态分析 + 实际表单操作抓包

---

## 一、端到端上货流程

```
输入: PDD 商品链接 https://mobile.yangkeduo.com/goods.html?goods_id=XXX

Phase A — 解析源商品 (消费者端, 需独立登录态)
  [A1] Playwright 导航消费者页 (需消费者端登录态, 附加 refer_page_name=search_result)
  [A2] 等待 oak/integration/render XHR 完成 → 客户端 JS 解密 → DOM 渲染
  [A3] page.evaluate 提取:
       title, carousel[], price, skuSpecs, properties[], detailImgs[], catID1/2/3

Phase B — 类目解析 (第三方 API, 无需商家端交互)
  [B1] GET api.gj.dangxun.com/api/v1/crx/PddCate?last_cate_id={catID3} → 类目名称路径
  [B2] 直接构造 cat_id / cat_ids / cats 填入发布 payload (消费者端与商家端同一 ID 体系)

Phase C — 商家后台发布 (mms.pinduoduo.com)
  [B1] 选类目    GET  /vodka/v2/mms/cat1List → categories
  [B2] 建草稿    POST /glide/v2/mms/edit/commit/create_new → {goods_commit_id, goods_id}
  [B3] 查模板    GET  /draco-ms/mms/template/mall?catId=xxx → 属性选项列表 {vid, value}
  [B4] 传图片    Playwright setInputFiles → 页面 JS 自动 upload_init → part → complete
  [B5] 匹配属性  源属性 ref_pid / value → 模板 vid 映射
  [B6] 编辑草稿  POST /glide/mms/goodsCommit/action/edit   (120+ 字段 payload)
  [B7] 存详情图  POST /glide/forward/gorse/.../decoration/commit/save
  [B8] 提交发布  POST /glide/v2/mms/edit/commit/submit
```

---

## 二、解析源商品 (消费者端 — 需登录态)

**URL**: `https://mobile.yangkeduo.com/goods.html?goods_id={goods_id}`

### 2.0 登录态要求

- **消费者端 (mobile.yangkeduo.com) 需要独立登录态**，与商家后台 (mms.pinduoduo.com) 不同体系
- 未登录时会被 302 重定向到 `login.html`
- 导航 URL 需附加 `refer_page_name=search_result&refer_page_id=10033&refer_page_sn=10033` 参数避免重定向
- 消费者端登录态保存路径: `data/consumer-auth-state.json` (与商家端 `data/auth-state.json` 同级)

### 2.1 提取方式 (DOM 提取)

`oak/integration/render` XHR 返回加密数据 (`encrypt_status: 3`)。客户端 JS 解密后渲染到 DOM。

catID 从 React fiber 内部状态提取 (`#main` 容器元素的 `__reactFiber`/`__reactContainer` → `.child.memoizedProps`)，其余数据从 DOM 提取。

```javascript
await page.waitForResponse(r => r.url().includes('oak/integration/render'));
await page.waitForSelector('[class*="sku"]', { timeout: 10000 });

const data = await page.evaluate(() => {
  // --- catID: React fiber ---
  const el = document.getElementById('main');
  const fiberKey = Object.keys(el).find(k =>
    k.startsWith('__reactFiber') || k.startsWith('__reactContainer')
  );
  const fiberStr = JSON.stringify(el[fiberKey]?.child?.memoizedProps);
  const get = (key) =>
    fiberStr.match(new RegExp(`"${key}":(\\d+\\.?\\d*|"[^"]*")`))?.[1]?.replace(/"/g, '') || null;

  // --- 其余: DOM ---
  const body = document.body.innerText;
  const detailIdx = body.indexOf('商品详情');

  return {
    goodsID:    get('goodsID'),
    goodsName:  get('goodsName'),
    catID:      get('catID'),
    catID1:     get('catID1'),
    catID2:     get('catID2'),
    catID3:     get('catID3'),
    price:      body.match(/[¥￥]\s*\n?\s*(\d+\.?\d*)/)?.[1],
    carousel:   [...new Set(
                  Array.from(document.querySelectorAll('img[src*="mms-material-img"]'))
                    .map(i => i.src.split('?')[0])
                )],
    skuText:    document.querySelector('[class*="sku"]')?.innerText,
    properties: detailIdx > -1 ? body.substring(detailIdx, detailIdx + 500) : '',
    detailImgs: [...new Set(
                  Array.from(document.querySelectorAll('img[src*="mms-goods-image"]'))
                    .map(i => i.src.split('?')[0])
                )],
  };
});
```

### 2.1a 提取注意事项

| 约束 | 说明 |
|------|------|
| fiber key 前缀不固定 | `__reactFiber$xxx` 或 `__reactContainer$xxx`，需动态匹配 |
| 价格 | fiber 中可能为 `"0"` (脱敏)，优先从 DOM 正则提取 |
| 容器元素 | 固定 `#main`，类名 `container` |

```javascript
// 备用: 单次 page.evaluate 提取全部数据
({
  title:      商品名文本区域,
  carousel:   img[src*="mms-material-img"][naturalWidth>=300] 去重去 query,
  price:      body.innerText.match(/[¥￥]\s*\n?\s*(\d+\.?\d*)/),
  skuSpecs:   div.sku-plus1 innerText → 按"颜色分类"/"尺码"切分,
  detailImgs: img.loaded[src*="mms-material-img"] 去重,
  properties: 商品详情区域 key/value 文本解析,
})
```

### 2.2 实测数据 (商品 918867803697, SSR rawData 提取)

| 数据 | 结果 |
|------|------|
| 标题 | 汪汪队衣服儿童新款夏季短袖T恤卡通男女童百搭宝宝圆领纯棉上衣t |
| 类目 ID | catID1=14966, catID2=14967, catID3=**15000** |
| 类目路径 | 母婴玩具 → 童装/婴儿装/亲子装 → T恤 |
| 轮播图 | topGallery: **多张** (mms-material-img URL) |
| 详情图 | detailGallery: **多张** (含 width/height) |
| 拼团价 | ¥**8.22** |
| 单买价 | ¥**20.9** |
| SKU | **多色×多码** (specs 含 spec_key_id/spec_value_id) |
| 属性 | **16 项** (含 ref_pid: 340/396/321/750/1885/341/351/889/322/1906/1997/342/347) |

### 2.3 关键约束

- 需 PDD 消费者端登录态（与商家后台登录态不同体系）
- 需 Chrome 浏览器（Firefox 返回降级极简页面）
- 导航 URL 需附加 `refer_page_name=search_result` 避免 302 到 login.html
- SSR rawData 在登录态下包含完整数据，无需等 DOM 渲染
- 无登录态时 rawData 被脱敏（轮播图仅 1 张、价格 "0"、SKU 无规格）
- 反复操作会降低信任度导致数据不完整

### 2.4 关键 XHR 端点

| 端点 | 用途 |
|------|------|
| `/proxy/api/api/oak/integration/render` | 动态渲染完整商品数据 (价格/轮播/SKU) |
| `/proxy/api/api/oak/integration/require_extra` | 补充数据 |

---

## 三、商家后台 API 端点 (mms.pinduoduo.com)

### 3.1 公共请求特征

```
Method:       POST (类目查询为 GET)
Content-Type: application/json
Headers:
  Anti-Content: <动态反爬 token，webpack 生成，每次不同>
  ETag:         <会话 token>
  Cookie:       <登录态>
```

所有接口需 `Anti-Content` 头 → 通过 Playwright `page.evaluate(fetch(...))` 自动携带。

### 3.2 类目选择

| 端点 | 方法 | 用途 |
|------|------|------|
| `/vodka/v2/mms/cat1List` | GET | 一级类目列表 |
| `/vodka/v2/mms/categories?parentId=xxx` | GET | 子类目列表 |
| `/vodka/v2/mms/search/categories/v2` | GET | 搜索类目 |
| `/vodka/v2/mms/category/detail?catId=xxx` | GET | 类目详情 |
| `/vodka/v2/mms/categories/isOpenToMall` | POST | 类目开放检查 |

### 3.3 草稿管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/glide/v2/mms/edit/commit/create_new` | POST | **创建空草稿** → `{goods_commit_id, goods_id}` |
| `/glide/mms/goodsCommit/action/edit` | POST | **编辑草稿（全量字段 120+）** |
| `/glide/v2/mms/edit/commit/update` | POST | 更新草稿 |
| `/glide/v2/mms/edit/commit/submit` | POST | **提交发布** |
| `/glide/v2/mms/edit/commit/delete` | POST | 删除草稿 |
| `/glide/v2/mms/edit/commit/copyGoodsCommitAndSubmit` | POST | 复制发布同款 |
| `/glide/v2/mms/query/commit/detail` | POST | 查询草稿详情 |
| `/glide/v2/mms/query/goods/can_edit` | POST | 可编辑检查 |

### 3.4 SPU / 属性模板

| 端点 | 方法 | 用途 |
|------|------|------|
| `/draco-ms/mms/template/mall?catId=xxx` | GET | **属性模板（含下拉选项 vid/value）** |
| `/martell-ms/mms/query/spu/template` | POST | SPU 模板 |
| `/martell-ms/mms/search/spu` | POST | 搜索 SPU |
| `/martell-ms/mms/spu/match` | POST | SPU 匹配 |
| `/martell-ms/mms/spu/cat_control_info` | POST | 类目管控信息 |

### 3.5 规格 / SKU

| 端点 | 方法 | 用途 |
|------|------|------|
| `/glide/v2/mms/query/spec/name/list` | POST | 规格名列表 (颜色/尺码) |
| `/glide/v2/mms/query/spec/by/name` | POST | 按名称查规格值 |
| `/glide/forward/cabernet/mms/sizespec/query/class/id/cat` | POST | 尺码表类型 |
| `/glide/forward/cabernet/mms/sizespec/query/meta` | POST | 尺码表元数据 |

### 3.6 图片上传

| 端点 | 方法 | 用途 |
|------|------|------|
| `/file/upload_init` | POST | 初始化 → `upload_sign` |
| `/file/upload_part` | POST | 上传分片 (FormData) |
| `/file/upload_complete` | POST | 完成 → `img_url` + `file_id` |
| `/glide/v2/mms/image/thumbnail` | POST | 获取缩略图 |

### 3.7 详情图 / 装修

| 端点 | 方法 | 用途 |
|------|------|------|
| `/glide/forward/gorse/mms/goods/decoration/commit/save` | POST | **保存详情图** |
| `/glide/forward/gorse/mms/goods/decoration/commit/query/V2` | POST | 查询装修 |
| `/glide/forward/gorse/mms/goods/decoration/preview` | POST | 预览装修 |

### 3.8 校验 / 风控

| 端点 | 方法 | 用途 |
|------|------|------|
| `/glide/v2/mms/edit/commit/pre/risk` | POST | 提交前风控检查 |
| `/glide/v2/mms/query/property/weak_verify` | POST | 属性弱校验 |
| `/glide/v2/mms/query/sensitive_word/check` | POST | 敏感词检查 |
| `/glide/v2/mms/query/rules/limit/new` | POST | 发布规则限制 |

### 3.9 运费 / 物流

| 端点 | 方法 | 用途 |
|------|------|------|
| `/express_inf/cost_template/get_list` | POST | 运费模板列表 |
| `/express_inf/cost_template/get_one` | POST | 单个运费模板 |
| `/glide/v2/mms/query/costtemplate/validate` | POST | 运费模板校验 |

---

## 四、编辑表单结构 (连衣裙类目实抓)

**页面 URL**: `/goods/goods_add/index?type=add&from=category&id={goods_commit_id}&goods_id={goods_id}`

### 4.1 基本信息

| 字段 | 必填 | 类型 | 说明 |
|------|:---:|------|------|
| 商品分类 | ✅ | 自动 | 三级类目 (服饰箱包→女装→连衣裙) |
| 商品轮播图 | ✅ | 图片上传 | 多图，Playwright setInputFiles |
| 商品标题 | ✅ | 文本 | max 60 字符 / 30 汉字 |
| 品牌 | ⚠️ | 下拉 | vid + value 匹配 |
| 面料/风格/款式/裙长/袖长/领型/年龄/时节 | ⚠️ | 下拉 | 各 vid + value 匹配，随类目变化 |

### 4.2 多媒体

| 字段 | 必填 | 说明 |
|------|:---:|------|
| 商品视频 | | 可选 |
| 商品详情 | | 详情图编辑器 (decoration floor_list) |

### 4.3 商品规格 (SKU)

| 字段 | 说明 |
|------|------|
| 规格类型 | 通用 / 中国码 / 欧码 |
| SKU 列表 | 颜色×尺码矩阵，每 SKU 设价格+库存+SKU图 |

---

## 五、核心 Payload 结构

### 5.1 `goodsCommit/action/edit` — 保存草稿 (实抓 120+ 字段)

```json
{
  "goods_id": 953009364304,
  "goods_commit_id": "191512609758",
  "goods_name": "测试连衣裙夏季新款女装",
  "goods_desc": "测试连衣裙夏季新款女装",
  "cat_id": 8477,
  "cat_ids": [8439, 8449, 8477, null],
  "cats": ["女装/女士精品", "连衣裙", "连衣裙", null],
  "gallery": [],
  "goods_properties": [
    {"template_pid":471216, "template_module_id":72984, "ref_pid":310, "pid":5,
     "vid": 4643510, "value":"无品牌/无注册商标", "value_unit":"", "content":""},
    // ... 共 13 个属性
  ],
  "skus": [{
    "id": 0, "is_onsale": 1,
    "multi_price": 0, "price": 0,        // 分为单位
    "quantity_delta": 0,
    "thumb_url": "", "spec": "", "weight": 0
  }],
  "groups": {
    "single_price": 0, "group_price": 0, // 分为单位
    "customer_num": 2, "buy_limit": 999999
  },
  "cost_template_id": 544142245494784,
  "shipment_limit_second": 172800,        // 48h
  "goods_type": 1,
  "is_refundable": 1,
  "propertys_tid": 53673,
  "validate_message": "<sha256>",
  "crawlerInfo": "<Anti-Content>"
}
```

### 5.2 `decoration/commit/save` — 保存详情图

```json
{
  "goods_commit_id": "191512609758",
  "goods_id": 953009364304,
  "floor_list": [
    {
      "type": "image",
      "content_list": [{
        "img_url": "https://img.pddpic.com/mms-material-img/...",
        "height": 800, "width": 750
      }]
    }
  ]
}
```

> `floor_list[].type`: `"image"` 纯图 / `"text"` 文字+图 / `"video"` 视频

### 5.3 关键字段说明

| 字段 | 说明 |
|------|------|
| `goods_commit_id` | 草稿 ID，create_new 返回 |
| `goods_id` | 商品 ID，create_new 返回 |
| `cat_id` / `cat_ids` | 叶子类目 ID / 路径数组 |
| `gallery` | 轮播图 CDN URL 数组 |
| `goods_properties[].vid` | 属性选项 ID（从模板匹配） |
| `skus[].price` / `multi_price` | 单买价 / 拼团价（分） |
| `skus[].quantity_delta` | 库存增量 |
| `groups.customer_num` | 成团人数（默认 2） |
| `cost_template_id` | 运费模板 ID |
| `propertys_tid` | 属性模板 ID（从 draco-ms 获取） |
| `validate_message` | SHA256 校验（前端生成） |
| `crawlerInfo` | Anti-Content 值 |

---

## 六、属性下拉自动填充

### 6.1 属性模板接口

`GET /draco-ms/mms/template/mall?catId={catId}`

返回每个属性的预定义选项列表：

```json
{
  "modules": [{
    "id": 72984,
    "propertys": [{
      "id": 471217,
      "name_alias": "重要面料俗称",
      "pid": 7,
      "required": true,
      "values": {
        "content": [
          {"vid": 100, "value": "棉"},
          {"vid": 101, "value": "聚酯纤维"},
          // ...
        ]
      }
    }]
  }]
}
```

### 6.2 自动匹配流程

```
源属性 (DOM): {key: "面料/材质", values: ["棉"], ref_pid: -1103}
      ↓ ref_pid 或 name_alias 模糊匹配
模板属性:     {name_alias: "重要面料俗称", pid: 7, values: [{vid:100, value:"棉"}, ...]}
      ↓ value 文本匹配
填入 payload: {template_pid: 471217, pid: 7, vid: 100, value: "棉"}
```

### 6.3 匹配注意事项

| 问题 | 说明 |
|------|------|
| 属性名差异 | 消费者端 `面料/材质` vs 模板端 `重要面料俗称`，优先用 `ref_pid` 匹配 |
| 多值属性 | `流行元素: ["印花","条纹"]` 需逐个匹配 vid |
| 跨类目差异 | 不同类目属性模板完全不同 |
| 匹配失败 | 非必填跳过，必填提示用户手选 |

---

## 七、图片上传

### 7.1 方式：Playwright `setInputFiles`

通过 Playwright 操作 file input，页面 JS 自动完成三步上传（自带 Anti-Content）：

```javascript
const fileInput = page.locator('input[type="file"][accept*="image"]').first();
await fileInput.setInputFiles(['/tmp/carousel_0.png', '/tmp/carousel_1.png']);
await page.waitForResponse(r => r.url().includes('upload_complete'));
```

### 7.2 底层流程（页面 JS 自动执行）

```
file input change → upload_init → upload_part → upload_complete → img_url + file_id
```

### 7.3 file input 布局 (连衣裙类目)

| index | accept | 用途 |
|:-----:|--------|------|
| 0 | image/jpeg,png | **商品轮播图** |
| 1-3 | video/* | 商品/讲解/商详视频 |
| 4 | image/jpeg,png | 白底图 |
| 5 | image/jpeg,png | 长图 |
| 6 | image/jpeg,png | 商品素材 |
| 7 | image/jpeg,png | 详情图 |

### 7.4 完整流程

```
[1] 从源商品 DOM 提取图片 URL
[2] HTTP 下载到本地临时文件（pddpic.com CDN 无需 cookie）
[3] Playwright setInputFiles 注入 → 等待 upload_complete 响应
[4] 页面自动将 img_url 写入表单 gallery[] / decoration
[5] 后续 edit payload 自动包含上传后的 CDN URL
[6] 清理临时文件
```

### 7.5 注意事项

| 约束 | 说明 |
|------|------|
| 轮播图尺寸 | 最小 480×480，推荐 750×750 正方形 |
| 详情图宽度 | 750px |
| 格式 | 仅 JPEG / PNG |
| 多文件 | 建议逐张传 + waitForResponse 确认 |

---

## 八、反检测实验记录

rawData SSR 数据被服务端固定脱敏，以下 jshook 工具均**无法**绕过：

| 工具 | 效果 | 原因 |
|------|:---:|------|
| stealth_inject | ❌ | 服务端 SSR 策略，非客户端检测 |
| antidebug_bypass | ❌ | 同上 |
| stealth_configure_jitter | ❌ | CDP 时序不影响 SSR |
| Camoufox (Firefox) | ❌ | PDD 对 Firefox 返回极简降级页面 |
| iPhone 14 Pro Max 模拟 | ❌ | 设备模拟不改变服务端策略 |
| evaluateOnNewDocument 拦截 | ❌ | 破坏页面初始化 |

**结论**: rawData/SSR 在有登录态时依然被脱敏 (`window.rawData = null`, `__PDD_RAWDATA__` 元素不存在)。
完整数据来自 `oak/integration/render` XHR → `encrypt_info` 加密传输 → 客户端 JS 解密 → DOM 渲染。
catID 等结构化字段仅存在于加密载荷中，不暴露到 DOM 或 JS 全局变量。
**数据提取只能走 DOM 路径**。jshook 工具解决客户端检测，对服务端加密策略无效。

---

## 九、类目 ID 解析

### 9.1 消费者端类目 ID

从页面 JS 状态 `initDataObj.goods` 提取 `catID1/2/3/4`。
**与商家端 `cat_ids` 是同一 ID 体系**，可直接用于发布 payload。

### 9.2 第三方类目名称 API

`GET https://api.gj.dangxun.com/api/v1/crx/PddCate?last_cate_id={catID}`

响应:
```json
{
  "code": 1,
  "data": {
    "root": "母婴玩具",
    "cates": ["童装/婴儿装/亲子装", "T恤", "T恤"],
    "all_root": ["家居生活", "家纺家具家装", "数码电器", "服饰箱包", "母婴玩具", ...]
  }
}
```

### 9.3 类目填充流程

```
消费者端: catID1=8439, catID2=8449, catID3=8477
  ↓
第三方 API: PddCate?last_cate_id=8477
  → root="服饰箱包", cates=["女装/女士精品","连衣裙","连衣裙"]
  ↓
直接构造 payload:
  cat_id:  8477
  cat_ids: [8439, 8449, 8477, null]
  cats:    ["女装/女士精品", "连衣裙", "连衣裙", null]
```

无需商家端类目搜索 API。

### 9.4 实测验证

| catID | 解析结果 |
|:--|:--|
| `8439→8449→8477` | 服饰箱包 → 女装/女士精品 → 连衣裙 |
| `14966→14967→15000` | 母婴玩具 → 童装/婴儿装/亲子装 → T恤 |

---

## 十、表单加载 API 完整时序 (实抓)

```
Phase 1 — 创建草稿:
  POST /glide/v2/mms/edit/commit/create_new
  GET  /vodka/v2/mms/cat1List
  POST /martell-ms/mms/query/spu/template

Phase 2 — 表单初始化:
  GET  /draco-ms/mms/template/mall?catId=xxx          ← 属性模板(65KB)
  POST /glide/v2/mms/query/mall/commit_letter/query
  POST /glide/v2/mms/query/rules/limit/new
  GET  /vodka/v2/mms/category/detail?catId=xxx

Phase 3 — 编辑器加载:
  POST /glide/v2/mms/query/commit/detail
  POST /glide/v2/mms/query/country/list
  POST /glide/v2/mms/query/certificate/property/white_list

Phase 4 — SKU:
  POST /glide/v2/mms/query/spec/name/list
  POST /glide/forward/cabernet/mms/sizespec/query/class/id/cat
  POST /glide/forward/cabernet/mms/sizespec/query/meta
  POST /draco-ms/mms/template/property/value/img

Phase 5 — 运费:
  POST /express_inf/cost_template/get_list
  POST /express_inf/cost_template/get_one
  POST /glide/v2/mms/query/costtemplate/validate

Phase 6 — 详情图:
  POST /glide/forward/gorse/.../decoration/commit/query/V2
  POST /glide/forward/gorse/.../decoration/preview

Phase 7 — 校验:
  POST /glide/v2/mms/query/property/weak_verify
  POST /glide/v2/mms/query/goods/can_edit
  POST /glide/v2/mms/query/goods/lock_info
  POST /martell-ms/mms/spu/cat_control_info
  POST /glide/forward/smart-goods/mms/query/recommendation
```
