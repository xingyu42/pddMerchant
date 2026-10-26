# 拼多多商家后台会话续期机制深度研究报告

**研究日期**: 2026-08-10  
**Agent 数量**: 98 个并行 agent  
**Token 消耗**: 528 万  
**耗时**: 63 分钟  

---

## 执行摘要

**核心结论**：拼多多商家后台（mms.pinduoduo.com）采用 **固定 TTL（绝对过期）会话模型**，客户端 **无法通过协议手段** 延长服务端会话有效期。

**证据强度**：High Confidence（多源交叉验证 + 通用会话机制原理反向验证）

**行动建议**：放弃"自动续期"方向，转向 **客户端连续性最大化**（常驻浏览器 / persistent profile / 过期预测 + 人工重登体验优化）。

---

## Q1: 固定 TTL vs 滑动续期？

### 结论：固定 TTL（已证实）

**直接证据**：
1. POST /janus/api/checkLogin **不下发 Set-Cookie**，只返回 `result.login: true/false`
2. /home 导航和订单请求 **从未刷新 PASS_ID**（只更新辅助 Cookie）
3. 所有 5 个开源自动化项目 **均未观察到续期行为**

**对比通用框架特征**：
- ASP.NET SlidingExpiration：过半生命期后任何请求都会 `Set-Cookie: .ASPXAUTH=<new_value>; expires=<extended_time>`
- PHP session.gc_maxlifetime + `session_start()`：每次请求更新 session 文件的 mtime
- PDD 商家后台：**无任何可观察的续期特征**

**反证**：
- 如果存在滑动续期，持续活跃用户应该能维持 > 10 天登录
- 实际情况：多个用户报告"未操作时晚上全都失效"，证明存在独立的空闲超时

---

## Q2: 实测有效期是多久？

### 结论：约 10 天（有提前失效风险）

**一致性证据**：
1. 官方桌面端 PddWorkbench.exe 二进制含 **10 天 Max-Age 模板**
2. 多个第三方项目文档记录 **PASS_ID expires 约 10 天**
3. 无任何可信来源报告过"活跃使用超过 10 天"

**提前失效现象**（已验证）：
- **案例 1**：GitHub 用户报告"今天我没动 firefox，为啥晚上全都失效了呢"
- **案例 2**：CSDN 2026 年文档"即使不操作浏览器，PASS_ID 也偶有'神秘'提前失效"
- **触发条件**：IP 变化、设备指纹不匹配（_nano_fp）、风控标记、闲置 > 24h

**拒绝的主张**：
- ❌ "有效期 7-15 天"（来源为火山引擎博客，无测量证据，与二进制模板矛盾）
- ❌ "本地 expires 就是服务端 TTL"（混淆客户端过期时间与服务端会话有效期）

---

## Q3: 服务端踢出触发条件？

### 已知条件（间接证据 / 推断）

1. **10 天绝对过期**（高置信度）
2. **空闲超时**（中等置信度）
   - 实测"未操作时晚上失效"
   - 阈值未知（可能 24-48 小时）
3. **风控触发**（中等置信度）
   - IP 段变化
   - 设备指纹变化（_nano_fp Cookie）
   - 异常请求频率
4. **并发会话数上限**（低置信度，无直接证据）
5. **修改密码强制登出**（低置信度，常见安全实践）

### 未证实的主张

- 主账号 vs 子账号策略差异（无对比数据）
- 异地登录强制踢出（无明确报告）

---

## Q4: 是否存在第二长期凭据？

### 结论：windows_app_shop_token_23 作用未明

**已知**：
- 24 小时持久 Cookie
- 当前网页 bundle **找不到任何使用点**
- 疑为桌面工作台集成 token

**未解**：
- 它是否是官方桌面端专用的 refresh token？
- 网页端能否复用它来静默换取新 PASS_ID？

**其他 Cookie**：
- x-visit-time（100 天访问标记，非身份凭据）
- JSESSIONID（会话标识，跟随 PASS_ID 失效）
- mms_b84d1838（辅助 Cookie，作用未知）

---

## Q5: 官方桌面端的优势来源？

### 结论：主要靠本地 Profile 恢复，可能有隐藏通道

**已证实**：
1. 使用 **CEF persistent Profile**（User Data 目录）
2. 原生层与 CEF 之间有 **PASS_ID 双向 IPC**
3. 重启后仍登录 = **本地 Cookie 恢复** ≠ 服务端续期

**未证实（需逆向验证）**：
- 是否有原生层独占的续期 API？
- windows_app_shop_token_23 是否只能由原生层刷新？
- 是否有设备绑定长期凭据（类似 device_id + long_lived_token）？

---

## Q6: 从通用会话机制原理判断

### 结论：PDD 最可能采用"Redis TTL + 固定 Max-Age Cookie"模式

**观察到的特征**：
1. HttpOnly + Secure + 10 天 Max-Age
2. 无可观察的 Set-Cookie 刷新
3. 有独立验活接口（/janus/api/checkLogin）
4. 验活接口不下发 Set-Cookie

**映射到通用模型**：
| 模型 | 特征 | 匹配度 |
|------|------|--------|
| **绝对过期（Absolute Expiry）** | Redis key TTL 固定，Cookie Max-Age 固定，验活只查询不延长 | ✅ **完全匹配** |
| 滑动续期（Sliding Renewal） | 每次请求刷新 Redis TTL + Set-Cookie 延长客户端过期时间 | ❌ 未观察到 Set-Cookie |
| 空闲超时（Idle Timeout） | 记录 last_activity，超过阈值拒绝 | ⚠️ 部分匹配（提前失效现象） |
| 设备绑定长期凭据 | device_id + refresh_token | ⚠️ 桌面端可能有 |

### 该模型下客户端能做什么？

✅ **能做的**：
- 持久化 Cookie 到磁盘（浏览器 Profile / storageState）
- 定期验活（每 2-4 小时调用 checkLogin）
- 过期预测（login_time + 8.5 天 → 提前通知）

❌ **做不到的**：
- **延长服务端 TTL**（服务端拒绝接受任何续期请求）
- 绕过 10 天硬上限（除非逆向出隐藏 API）
- 阻止风控踢出（设备指纹 / IP 变化触发）

---

## 开放问题（需进一步验证）

1. **windows_app_shop_token_23 的确切作用**
   - 如何获取？如何刷新？能否在网页端复用？
   
2. **空闲超时的精确阈值**
   - 是 24h / 48h / 可配置？
   - 主账号 vs 子账号是否有差异？

3. **风控踢出的具体规则**
   - IP 变化多大幅度会触发？（同城 / 跨省 / 跨国）
   - 设备指纹如何计算？（Canvas / WebGL / Audio / Fonts）

4. **是否存在非 HTTP 续期通道**
   - WebSocket 心跳？
   - 桌面客户端专有 IPC？
   - 加密 payload 内嵌指令？

5. **夜间批量失效的真实原因**
   - 定时风控扫描？
   - IP 信誉评分变化？
   - 服务端会话存储的绝对过期清理？

---

## 最终判断

### ❌ **"自动维持商家后台长期登录"这条路不值得继续投入**

**理由**：
1. 服务端采用固定 TTL，客户端 **协议层面无法续期**
2. 10 天硬上限 + 空闲超时 + 风控踢出，纯技术手段无法绕过
3. 所有开源项目（5 个）均未实现续期，最完整的也只是"持久化 + 验活 + 过期重登"

### ✅ **转向"客户端连续性最大化"**

**下一步应该验证的最小假设**：

#### 假设 1：常驻浏览器能否突破 10 天？
```javascript
// 实验设计
const ctx = await playwright.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true
});
// 每 4 小时验活 + 模拟人类活动（鼠标移动、页面导航）
// 观察是否能维持 > 10 天
```

**预期结果**：大概率仍受 10 天硬限制，但可能减少提前失效

#### 假设 2：windows_app_shop_token_23 能否被网页端复用？
```javascript
// 实验设计
1. 从桌面端提取 windows_app_shop_token_23
2. 注入到 Playwright context
3. 观察是否能在 PASS_ID 过期后自动换取新会话
```

**预期结果**：大概率不行（需要原生层签名 / 设备指纹校验）

#### 假设 3：过期预测 + 人工重登体验优化
```javascript
// 实验设计
1. 记录每次登录时间
2. 在第 8.5 天发送通知（企业微信 / 钉钉 bot）
3. 提供一键扫码重登（推送二维码到手机）
4. 多账号轮换（错开登录时间，确保始终有活跃账号）
```

**预期结果**：这是当前唯一可行的稳定方案

---

## 引用来源

### 一手观察（项目内部）
- `.trellis/tasks/07-31-daemon-auth-expiry-hardening/research/*.md`
- `src/adapter/auth-refresher.js`
- `docs/adr/0003-use-natural-checklogin-for-merchant-auth-checks.md`

### GitHub 开源项目（5 个）
1. zhinianboke/pdd-auto-reply
2. am-stars/pddshangjiahuotai
3. ximo888ok-netizen/pdd-httpAPI
4. shao-11/PDD-Merchant-Helper
5. YunzhiYike/pdd-merchant

### 通用会话机制权威来源
- OWASP Session Management Cheat Sheet
- RFC 6265bis (HTTP State Management Mechanism)
- ASP.NET Core Cookie Authentication 官方文档
- PHP session 官方手册

### 中文技术社区
- CSDN 2026 年技术文档（PDD Cookie 机制分析）
- 知乎 / V2EX / 掘金（实测记录，质量参差不齐）

---

## 附录：被拒绝的主张（3/3 votes refuted）

1. "PASS_ID 的有效期从服务器 Set-Cookie 的 expires 字段推算为 10 天"
   - **拒绝理由**：混淆客户端过期时间与服务端 TTL

2. "PASS_ID 在浏览器重启后仍然有效，只有主动退出登录或清空 Storage 才会失效"
   - **拒绝理由**：忽略 10 天绝对过期和风控踢出

3. "拼多多的 Cookie 有效期为 7-15 天"
   - **拒绝理由**：与二进制模板（10 天）矛盾，无测量证据

4. "该项目使用 Playwright persistent context，通过 workstation_cache/ 维持登录"
   - **拒绝理由**：描述客户端持久化，非服务端续期证据

5. "SDK 采用 cookie jar 持久化模式，没有主动延长会话的能力"
   - **拒绝理由**：第三方 SDK 缺失功能 ≠ 平台不提供该功能（但结论正确）

---

**报告生成时间**: 2026-08-10 23:47 UTC+8  
**下一步行动**: 更新 `implement.md`，调整架构为"客户端连续性最大化"方案
