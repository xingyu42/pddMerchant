# pddMerchant 项目架构总览

> 拼多多商家后台 CLI 工具 · 基于 Patchright 的 Chromium 自动化方案
> 
> **技术栈**: Node.js ESM + Patchright + Vitest
> **核心特性**: 无 TypeScript 编译、纯 JavaScript、直接运行

---

## 一、项目概览

### 1.1 核心定位
通过 Patchright 驱动 Chromium 浏览器，使用 Playwright-compatible API 拦截 XHR 响应，提供 **AI 友好的 JSON 信封合约**，封装拼多多商家后台的核心业务操作。

### 1.2 关键特性
- ✅ **无编译步骤**: ESM 直接运行，开发体验流畅
- ✅ **统一错误处理**: 8 种标准退出码 + PddCliError 体系
- ✅ **Mock 模式**: 通过 fixture 数据支持离线测试
- ✅ **日志脱敏**: 自动 SHA256 redact 敏感字段
- ✅ **熔断保护**: 429 触发全局冷却（5 分钟）
- ✅ **人类行为模拟**: 随机延迟 + 鼠标轨迹 + 滚动

---

## 二、分层架构

### 2.1 依赖流向（严格单向）
```
bin/pdd.js (CLI 入口)
    ↓
src/commands/ (命令注册器 + 薄包装器)
    ↓
src/services/ (业务逻辑层)
    ↓
src/adapter/ (Patchright 集成 + XHR 拦截)
    ↓
src/infra/ (跨层基础设施)
```

**守卫**: `test/layering-guard.unit.test.js` 禁止反向导入

---

## 三、核心模块详解

### 3.1 CLI 层 (`bin/pdd.js`)
**职责**:
- 全局信号处理（SIGINT/SIGTERM → 优雅关闭浏览器）
- 未捕获异常兜底（unhandledRejection/uncaughtException → 输出 envelope）
- 注册 9 个域的命令

**命令域注册器** (`src/commands/registry/`):
```
core.js      → init / login / doctor
shops.js     → shops list / shops switch
orders.js    → orders list / orders detail / orders export
goods.js     → goods list / goods templates / goods publish
promo.js     → promo roi / promo detail
diagnose.js  → diagnose orders / diagnose goods / diagnose funnel
action.js    → action plan
account.js   → account list / account add / account remove
daemon.js    → daemon start / daemon stop / daemon status
```

---

### 3.2 服务层 (`src/services/`)
**核心服务模块**:

| 模块                   | 职责         | 关键导出                                      |
| ---------------------- | ------------ | --------------------------------------------- |
| `auth.js`              | 鉴权管理     | `ensureAuthenticated()`                       |
| `orders.js`            | 订单查询     | `listRecentOrders()`, `getOrderDetail()`      |
| `goods.js`             | 商品管理     | `listGoods()`, `getGoodsDetail()`             |
| `promo.js`             | 推广报表     | `getPromoSummary()`, `getPromoDetail()`       |
| `goods-publish.js`     | **商品发布** | `publishGoodsFromSource()`                    |
| `diagnose/`            | 店铺诊断     | 7 个子模块（订单/商品/漏斗/趋势健康度）       |
| `pricing-validator.js` | 定价策略     | `buildPricingPlan()`, `validatePricingPlan()` |
| `image-transform.js`   | 图片处理     | `transformImages()`                           |

---

### 3.3 适配器层 (`src/adapter/`)

#### 3.3.1 浏览器生命周期 (`browser.js`)
```javascript
launchBrowser({ headed, storageStatePath })
  → patchright.chromium.launch()
  → 返回 { browser, context, page }

closeAllBrowsers({ timeoutMs })
  → 全局浏览器注册表批量关闭
```

**浏览器自动化措施**:
- Patchright 驱动级自动化特征修补
- 使用浏览器真实 UA，不注入 WebGL/Canvas 等手工指纹
- 人类行为模拟（`adapter/behavior-simulator.js`）

#### 3.3.2 XHR 拦截 (`run-endpoint.js` + `xhr-collector.js`)
**核心流程**:
1. 导航到目标页面
2. 注册 `page.on('response')` 监听器
3. 根据 endpoint 定义的 URL 模式匹配响应
4. 解析响应体 → 返回 JSON 数据

**endpoint 定义** (`adapter/endpoints/`):
```javascript
export const ORDERS_LIST = {
  urlPattern: /\/api\/aristotle\/paged_query/,
  method: 'POST',
  errorMapper: (raw) => ({ code: 'E_BUSINESS', message: '订单列表查询失败' })
};
```

#### 3.3.3 商品发布子模块 (`adapter/goods-publish/`)
| 文件                   | 职责                                 |
| ---------------------- | ------------------------------------ |
| `source-scraper.js`    | 抓取源商品数据（标题/图片/SKU/价格） |
| `category-resolver.js` | 匹配拼多多类目树                     |
| `form-filler.js`       | **表单填充核心**                     |
| `risk-detector.js`     | 风控检测（弹窗拦截）                 |

**已移除**（Phase 2 API 路径，2026-07-10 清理）:
- ~~`payload-builder.js`~~ / ~~`property-matcher.js`~~ / ~~`sku-mapper.js`~~ — API 发布路径未落地，活跃路径为 UI 自动化，已连同其测试 fixture 一并删除

---

### 3.4 基础设施层 (`src/infra/`)

| 模块                 | 职责                                               |
| -------------------- | -------------------------------------------------- |
| `errors.js`          | `PddCliError` + 8 种退出码映射                     |
| `envelope.js`        | 统一输出合约 `{ ok, command, data, error, meta }`  |
| `logger.js`          | pino + SHA256 redaction                            |
| `circuit-breaker.js` | 熔断器（429 触发 5 分钟冷却）                      |
| `scrape-cooldown.js` | 源抓取冷却（持久化到 `data/scrape-cooldown.json`） |
| `rate-control.js`    | 写操作限速（防止 429）                             |
| `timeouts.js`        | 超时配置                                           |
| `abort.js`           | AbortController 封装                               |

---

## 四、商品发布流程详解

### 4.1 入口 (`goods-publish.js`)
```javascript
publishGoodsFromSource(ctx, goodsUrl, options)
  ↓
1. parseGoodsUrl(goodsUrl) → 提取商品 ID
2. scrapeSourceGoods(page, goodsUrl) → 抓取源数据
3. resolvePddCategory(ctx, source) → 匹配类目
4. selectCategory(page, categoryPath) → 选择类目
5. fillGoodsForm(page, source, pricing) → 填充表单
6. clickSaveDraft(page, costTemplateId) → 保存草稿
7. (可选) 提交发布
```

### 4.2 源数据抓取 (`source-scraper.js`)
**目标**: 从第三方商品页面提取结构化数据

**抓取字段**:
```javascript
{
  goodsId: String,
  title: String,
  carouselImgs: [String],     // 轮播图 URL 数组
  detailImgs: [String],        // 商品详情图 URL 数组
  skuText: String,             // "颜色分类\n红色\n蓝色\n尺码\n90\n100"
  properties: String,          // "材质：纯棉\n风格：休闲"
  groupPrice: String,          // 拼单价
  singlePrice: String,         // 单买价
  marketPrice: String          // 市场参考价
}
```

**parseSkuText() 解析示例**:
```javascript
Input:  "颜色分类\n红色\n蓝色\n尺码\n90\n100\n110"
Output: [
  { name: '颜色分类', values: ['红色', '蓝色'] },
  { name: '尺码', values: ['90', '100', '110'] }
]
```

### 4.3 表单填充 (`form-filler.js`)
**当前实现**:
```javascript
fillGoodsForm(page, source, warnings, options)
  ↓
1. fillSkuDimensions() → 选择已验证的颜色/尺码规格并等待 SKU 表格
2. uploadSkuPreviewImages() → 按颜色规格上传预览图
3. 填充商品标题与轮播图
4. uploadDetailImagesViaForm() → 上传详情图并等待独立完成响应
5. fillPrices() → 按规格值唯一匹配 SKU 行，写入库存、拼单价、单买价与参考价
6. fillGoodsProperties() → 最后填写商家属性，避免 React 重绘恢复旧值
```

**选择器常量** (`SELECTORS`):
```javascript
{
  goodsTitle: 'input[placeholder*="商品标题"]',
  carouselUpload: 'input[type="file"][accept*="image"]',
  priceInputs: 'input[data-testid="beast-core-inputNumber-htmlInput"]',
  marketPrice: 'input[placeholder*="大于商品最大单买价"]'
}
```

---

## 五、测试架构

### 5.1 测试分层
```
test/
├── unit/*.test.js           # 单元测试（~400 个）
├── e2e/*.test.js            # 端到端测试（~50 个，spawn 子进程）
├── pbt/*.test.js            # 属性测试（自定义 PBT 框架）
├── fixtures/                # Mock 数据
│   ├── endpoints/           # XHR 响应 fixture
│   └── auth/                # 鉴权状态 fixture
└── layering-guard.unit.test.js  # 架构守卫
```

### 5.2 Mock 模式
**环境变量**:
```bash
PDD_TEST_ADAPTER=fixture          # 启用 Mock 模式
PDD_TEST_FIXTURE_DIR=./test/fixtures
```

**Mock 入口** (`adapter/mock-dispatcher.js`):
- `isMockEnabled()` → 14 个模块检查
- `loadFixture(path)` → 从 `test/fixtures/` 加载 JSON

**守卫模块** (~14 个):
- `adapter/browser.js` → `mockLaunchBrowser()`
- `adapter/run-endpoint.js` → 直接返回 fixture 数据
- `adapter/goods-publish/source-scraper.js` → `mockScrapeSourceGoods()`

---

## 六、环境变量配置

### 6.1 核心配置
| 变量                       | 用途                                                       | 默认值                 |
| -------------------------- | ---------------------------------------------------------- | ---------------------- |
| `PDD_AUTH_STATE_PATH`      | 显式商家鉴权文件覆盖                                       | 自动归档到 `data/merchant/stores/<店铺名>/` |
| `PDD_CONSUMER_AUTH_STATE_PATH` | 显式消费者鉴权文件覆盖                                | 自动归档到 `data/consumer/accounts/<账号名>/` |
| `PDD_ACCOUNTS_DIR` / `PDD_ACCOUNT_REGISTRY_PATH` | 商家店铺目录/注册表覆盖              | `data/merchant/stores/` / `registry.json` |
| `PDD_CONSUMER_ACCOUNTS_DIR` / `PDD_CONSUMER_ACCOUNT_REGISTRY_PATH` | 消费者账号目录/注册表覆盖 | `data/consumer/accounts/` / `registry.json` |
| （固定路径，无 env）           | 运行日志目录（按日轮转）                                     | `log/cli/` / `log/daemon/` |
| `PDD_DEBUG_RAW`            | 输出原始 payload（JSONL）                                  | `0`                    |
| `PDD_MALL_ID_STRICT_PARSE` | 严格校验店铺 ID                                            | `1`                    |
| `PLAYWRIGHT_DOWNLOAD_HOST` | Patchright 浏览器下载镜像（沿用 Playwright-core 环境变量） | —                      |

### 6.2 抓取控制
| 变量                               | 用途                                                    | 默认值         |
| ---------------------------------- | ------------------------------------------------------- | -------------- |
| `PDD_SCRAPE_SIMULATE`              | 人类行为模拟                                            | `1`            |
| `PDD_SCRAPE_SOFTBLOCK_THRESHOLD`   | 软封阈值                                                | `2`            |
| `PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS` | 软封冷却时长                                            | `7200000` (2h) |
| `PDD_SOURCE_PROXY_PROVIDER`        | 源商品抓取代理供应商；仅支持 `qingguo`                  | 未启用（直连） |
| `PDD_QINGGUO_AUTH_KEY`             | 青果代理提取接口 AuthKey（映射为 `/get` 的 `key` 参数） | —              |

### 6.3 测试模式
| 变量                   | 用途                     |
| ---------------------- | ------------------------ |
| `PDD_TEST_ADAPTER`     | `fixture` 启用 Mock 模式 |
| `PDD_TEST_FIXTURE_DIR` | Fixture 数据目录         |
| `PBT_SEED`             | PBT 种子（可复现）       |
| `PBT_RUNS`             | PBT 样本量               |

---

## 七、数据持久化

### 7.1 文件结构
```
data/
├── merchant/
│   └── stores/
│       ├── registry.json
│       └── <店铺名>/auth-state.json
├── consumer/
│   └── accounts/
│       ├── registry.json
│       └── <手机号或昵称>/auth-state.json
├── scrape-cooldown.json         # 源抓取冷却状态
└── daemon-state.json            # daemon 运行状态，不属于登录目录
```

### 7.2 auth-state.json 结构
```json
{
  "cookies": [
    { "name": "PASS_ID", "value": "...", "domain": ".pinduoduo.com" }
  ],
  "origins": [
    {
      "origin": "https://mms.pinduoduo.com",
      "localStorage": [
        { "name": "mall_id", "value": "123456" }
      ]
    }
  ]
}
```

---

## 八、错误处理体系

### 8.1 退出码映射
```javascript
ExitCodes = {
  OK: 0,              // 成功
  GENERAL: 1,         // 通用错误
  USAGE: 2,           // 用法错误
  AUTH: 3,            // 鉴权失败
  RATE_LIMIT: 4,      // 限流
  NETWORK: 5,         // 网络错误
  BUSINESS: 6,        // 业务错误
  PARTIAL: 7          // 部分成功
}
```

### 8.2 PddCliError 结构
```javascript
new PddCliError({
  code: 'E_BUSINESS',
  message: '商品发布失败',
  hint: '请检查商品标题是否包含敏感词',
  detail: { goods_id: '123' },
  exitCode: ExitCodes.BUSINESS
})
```

### 8.3 Envelope 合约
```javascript
{
  ok: false,
  command: 'goods publish',
  data: null,
  error: {
    code: 'E_BUSINESS',
    message: '商品发布失败',
    hint: '请检查商品标题是否包含敏感词'
  },
  meta: {
    warnings: ['图片尺寸低于推荐值'],
    timestamp: '2026-07-10T12:00:00.000Z'
  }
}
```

---

## 九、当前限制与待实现

### 9.1 商品发布限制（已验证）
| 功能            | 状态                  | 影响                                                                                                                                                 |
| --------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单 SKU 商品     | ✅ 完整支持            | 可正常发布                                                                                                                                           |
| 多 SKU 规格配置 | ✅ 已验证（颜色/尺码） | 结构化 SKU 按规格值唯一匹配，逐行写入库存、拼单价和单买价；未知维度返回 `E_BUSINESS`                                                                 |
| 商品详情图上传  | ✅ 已实现并验证        | 下载后定位详情图区并逐张等待独立完成响应；部分失败给警告，全部失败停止保存，临时文件始终清理                                                         |
| 商品属性映射    | ✅ 已实现并验证        | 结构化源属性按实时平台模板唯一匹配；必填/重要属性失败关闭，可选属性非唯一时给部分告警                                                                |
| 满件折扣配置    | ✅ 已实现并验证        | 统一配置 `fullCountDiscountRate`（默认 `0.95`）；唯一定位 `count_discount` 输入框，按 `9.5` 折写入并读回，保存请求严格校验 `two_pieces_discount: 95` |

### 9.2 技术债务
- `goods.list` 接口 `goods_id: null` 兼容逻辑（`matched_by='mixed'`）
- 同 URL 跨 endpoint 调用需要独立 page（Playwright 限制）

---

## 十、开发规范

### 10.1 代码约束
- ✅ 函数 < 50 行
- ✅ 嵌套 ≤ 3 层
- ✅ 禁用单字母变量（除循环计数器）
- ✅ `const` 优先，`async/await` only（禁止 `.then()`）

### 10.2 提交规范
```
✨ feat: 新增多 SKU 规格填充
🐛 fix: 修复价格表格填充顺序错误
🔧 chore: 更新 Patchright 到 v1.61
📝 docs: 补充商品发布流程文档
♻️ refactor: 重构 form-filler 选择器逻辑
✅ test: 补充 SKU 解析单元测试
```

---

**文档版本**: v1.0  
**更新时间**: 2026-07-10  
**适用版本**: pddMerchant v0.1.0
