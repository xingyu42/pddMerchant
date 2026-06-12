# 确定性指纹种子使用指南

## 功能说明

通过环境变量 `PDD_FINGERPRINT_SEED` 控制浏览器指纹生成，实现：
- **确定性指纹** - 相同种子生成完全一致的 Canvas/WebGL 指纹
- **模拟回访用户** - 降低 reCAPTCHA v3 风控分数
- **多商家隔离** - 不同 mall_id 使用独立指纹

## 快速开始

### 默认模式（随机指纹）

```bash
# 不设置种子，每次启动生成新指纹（原有行为）
pdd goods publish --url https://mobile.yangkeduo.com/goods.html?goods_id=918867803697
```

### 确定性模式（推荐）

```bash
# 方式 1: 环境变量设置
export PDD_FINGERPRINT_SEED=merchant-12345
pdd goods publish --url <url>

# 方式 2: 临时设置
PDD_FINGERPRINT_SEED=merchant-12345 pdd goods publish --url <url>

# 方式 3: .env 文件配置
echo "PDD_FINGERPRINT_SEED=merchant-12345" >> .env
pdd goods publish --url <url>
```

## 使用场景

### 场景 1：单商家固定指纹

```bash
# 在 .env 中配置
PDD_FINGERPRINT_SEED=my-shop-001

# 后续所有命令自动使用该指纹
pdd goods publish --url <url>
pdd orders list
```

### 场景 2：多商家独立指纹

```bash
# 商家 A
PDD_FINGERPRINT_SEED=mall-12345 pdd goods publish --url <url> --mall 12345

# 商家 B
PDD_FINGERPRINT_SEED=mall-67890 pdd goods publish --url <url> --mall 67890
```

### 场景 3：测试环境独立指纹

```bash
# 生产环境
PDD_FINGERPRINT_SEED=prod-merchant pdd goods publish --url <url>

# 测试环境
PDD_FINGERPRINT_SEED=test-merchant pdd goods publish --url <url>
```

## 验证指纹一致性

```bash
# 验证种子生成的指纹是否一致（运行100次）
node scripts/verify-fingerprint.js merchant-001 100

# 输出示例：
# ✅ All fingerprints are identical
# Profile:
# {
#   "locale": "zh-CN",
#   "timezoneId": "Asia/Shanghai",
#   "languages": ["zh-CN", "zh", "en"],
#   "webglVendor": "AMD",
#   "webglRenderer": "ANGLE (NVIDIA, NVIDIA GeForce GTX v74",
#   "canvasNoise": true,
#   "canvasNoiseAmount": 1
# }
```

## 技术细节

### 指纹组成

确定性指纹包含以下组件（均基于种子生成）：

1. **WebGL Vendor** - 3 种变体：Intel Inc. / NVIDIA Corporation / AMD
2. **WebGL Renderer** - 3 种前缀 × 90 种版本号 = 270 种组合
3. **Canvas 噪声强度** - 1-5 级确定性噪声

总计：3 × 270 × 5 = **4,050 种组合**

### 种子建议

| 建议种子格式 | 示例 | 说明 |
|-------------|------|------|
| `merchant-<id>` | `merchant-12345` | 单商家固定指纹 |
| `mall-<mall_id>` | `mall-67890` | 根据店铺 ID 生成 |
| `env-<name>` | `env-production` | 环境隔离 |
| 自定义字符串 | `my-unique-seed` | 任意字符串 |

⚠️ **避免使用易猜测的种子**（如 `123`, `test`），建议使用商家 ID 或 UUID。

## 常见问题

### Q1: 种子会暴露吗？

A: 种子仅存在于本地环境变量，不会发送到任何服务器。但指纹本身会被平台检测，因此：
- ✅ 定期轮换种子（如每月更换）
- ✅ 不同商家使用不同种子
- ❌ 避免在公开代码中硬编码种子

### Q2: 设置种子后是否一定不触发风控？

A: 确定性指纹仅降低风控概率，无法完全规避。建议结合：
- 控制请求频率（遵守平台限制）
- 使用住宅代理（如有需要）
- 模拟人类行为（项目已内置 `ghost-cursor` 轨迹模拟）

### Q3: 如何知道当前使用的指纹？

A: 运行验证脚本查看：
```bash
PDD_FINGERPRINT_SEED=your-seed node scripts/verify-fingerprint.js your-seed 1
```

### Q4: 可以使用中文种子吗？

A: 支持！种子可以包含任意 Unicode 字符：
```bash
PDD_FINGERPRINT_SEED=商家-12345 pdd goods publish --url <url>
```

## 向后兼容

- ✅ 不设置 `PDD_FINGERPRINT_SEED` 时，保持原有随机行为
- ✅ 所有现有命令无需修改
- ✅ Mock 模式（`PDD_TEST_ADAPTER=fixture`）不受影响
- ✅ 零新增依赖

## 技术实现

基于 Mulberry32 伪随机数生成器（PRNG）实现确定性指纹：

```javascript
// 相同种子 → 完全相同的指纹
const profile1 = generateFingerprintProfile('seed-A');
const profile2 = generateFingerprintProfile('seed-A');
// profile1 === profile2 (深度相等)

// 不同种子 → 不同指纹
const profile3 = generateFingerprintProfile('seed-B');
// profile3 !== profile1
```

算法保证：
- **确定性** - 相同输入必然产生相同输出
- **分布均匀** - 种子空间均匀映射到指纹空间
- **高速度** - 单次生成 < 1ms

## 相关文件

- `src/infra/stealth-scripts.js` - 指纹生成核心逻辑
- `src/adapter/browser.js` - 浏览器启动时注入指纹
- `test/infra/stealth-scripts-deterministic.unit.test.js` - 单元测试
- `scripts/verify-fingerprint.js` - 指纹一致性验证工具
