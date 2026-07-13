# Patchright 实际评价（截至 2026-07-12）

## 结论

Patchright 是目前 Node.js + Chromium 场景中迁移成本较低的 Playwright 分支，维护仍然活跃，也确实针对 Playwright/CDP 的部分明显自动化特征做了源码级修改。但没有可靠证据支持“不可检测”或“换上就能稳定绕过风控”。它适合作为受控 A/B 实验项，不适合未经回归测试直接替换生产浏览器层。

对 pdd-cli 来说，优先级应当是：先确认当前实际安装的 Playwright/Rebrowser 依赖，再验证持久化浏览器配置，最后才是以 Patchright 做同条件对照。当前项目依赖 `context.addInitScript()`、网络路由、XHR/事件监听，因此 Patchright 的已知兼容性缺口与本项目直接相关。

## 可确认的优点

- 官方将其定位为 Playwright 的直接替代，并提供 Node.js 包；只支持 Chromium，不支持 Firefox/WebKit。[官方仓库](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
- 它不是简单覆盖 `navigator.webdriver`，而是修改 Playwright 驱动，减少 `Runtime.enable`、`Console.enable` 和默认启动参数等检测面。[补丁说明](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright#patches)
- 截至 2026 年 6 月仍发布与上游 Playwright 对齐的版本，官方仓库显示约 1,000 次提交，并有针对上游版本的自动测试与修复活动。[发布记录](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/releases) [仓库活动](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/activity)
- 迁移表面较小：常规 `browser/context/page/locator` API 大体保留，适合先做独立分支或可切换适配器验证。

## 已确认的缺点

官方自己维护了一份标记为 `wontfix` 的已知缺陷清单，因此“drop-in replacement”不能理解为完全兼容：[官方缺陷清单 #30](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues/30)

- 为避免 Console CDP 域带来的检测，Patchright 关闭了该域。`ConsoleMessage`、`PageError`、`WebError`、部分 worker 错误和 tracing 行为会受影响；官方列出 34 个相关失败测试。
- WebSocket routing 有 6 个已知失败测试，官方认为在没有自定义 MITM 代理时难以隐蔽地解决。
- `addInitScript` 改为通过 HTML routing 注入，存在执行时序差异；对 `about:blank`、data URI、已经创建的页面及部分 binding/exposeFunction 场景行为不同。
- 使用 routing 时，客户端观察到的请求头可能与服务端实际收到的请求头不一致。
- selector engine 并非完全原子，弹窗策略也与原 Playwright 不同。
- 上游升级可能引入回归。2026 年 5 月的 v1.60.0 曾出现 locator click、dispatch_event 和 execution-context 相关问题；仓库随后进行修复，但这说明紧跟最新版存在风险。[Issue 列表](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/issues) [仓库活动](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/activity)

## “隐蔽性更强”的证据质量

### 较强证据

- 补丁确实修改了产生自动化特征的驱动行为，而不是只靠页面脚本覆盖属性；代码和补丁说明可审计。
- 项目公开运行 Playwright 测试，并公开列出无法通过或不打算修复的功能，透明度尚可。

### 较弱证据

- “通过 Cloudflare、Akamai、DataDome 等”的列表来自项目自身 README，不是这些厂商的认证，也没有公开长期、同条件、可复现的生产数据。
- Reddit 等社区反馈普遍样本很小，目标站、代理质量、账号历史、浏览器模式和请求频率不一致，只能说明“某些环境下比原版好用”，不能推导到 PDD。[近期讨论示例](https://www.reddit.com/r/Playwright/comments/1uinme1/patchright_vs_camoufox_with_stagehand_v3_for_productionlevel_scraping/)
- 也有独立试验声称 Patchright 在简单检测页上与原版得分相同。这类试验同样不能代表真实业务风控，但足以反驳“换框架必然有效”的说法。[反面试验](https://dev.to/francise_liang_e4544eadb9/why-i-permanently-no-god-patchright-after-a-spike-and-the-anti-detection-decision-tree-3m11)

## 对 pdd-cli 的具体影响

当前仓库中：

- `src/adapter/browser.js` 使用 `context.addInitScript()` 注入自定义指纹脚本，正好落入 Patchright 明确存在时序差异的区域。
- 项目大量依赖 Playwright 的 request/response、route、页面事件和 XHR 收集；普通 HTTP 路由大概率可用，但必须覆盖回归测试。
- 消费者抓取使用 fresh `browser.newContext()` 加 `storageState`。Patchright 不会自动补齐浏览器缓存、Service Worker、完整 profile 连续性；因此无法单独解决当前最明显的长期配置差异。
- 固定 UA、固定 viewport/deviceScaleFactor、启动参数和自定义随机指纹之间可能存在一致性问题。换驱动不会自动修正这些组合。
- `package.json` 声明 `playwright` 映射到 `rebrowser-playwright`，但 2026-07-12 本地 `npm ls` 实际显示官方 `playwright@1.59.1`。在比较 Patchright 前，应先解决并锁定这个依赖事实。

## 推荐决策

评价：**值得试验，不值得直接押注**。

建议用一个不接触旧降级账号的受控实验验证：

1. 固定同一个 Chromium/Chrome 版本、UA、headed 模式、代理出口和全新消费者账号。
2. 建立官方 Playwright（或确认生效的 Rebrowser）与 Patchright 两个可切换适配器。
3. 首先运行现有单元/fixture 测试，再验证 init script、request/response、route、XHR collector、登录状态保存与恢复。
4. 使用持久化 profile 和 fresh context 分别测试，避免把“Patchright 效果”与“profile 连续性效果”混在一起。
5. 真实站点最多做小次数、只读、脱敏 smoke；首个账号降级信号立即停止。
6. 不追最新版：选定验证通过的 Patchright 版本并锁定，升级时重新跑浏览器适配层测试。

如果目标只是解决当前 PDD 消费者抓取异常，持久化 profile 的对照实验比直接更换 Patchright 更有诊断价值。
