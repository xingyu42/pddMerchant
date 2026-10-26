# 技术设计：严格 Headless 一致性配置

## 1. 所有权与数据流

`src/adapter/browser.js` 继续作为唯一 Patchright 导入点，并集中拥有浏览器启动、运行配置、Context 创建、初始化脚本和清理。命令及 service 不感知 channel、UA 或窗口常量。

```text
launchBrowser(mode)
  -> launch preferred channel
  -> read browser.version()
  -> build immutable runtime profile
  -> WeakMap<Browser, RuntimeProfile>
  -> create context from profile
  -> add init script when headless
  -> create first page

createConsumerContext(browser, storage/proxy)
  -> read same RuntimeProfile
  -> create fresh context
  -> add same headless init script
  -> create page
```

## 2. 启动和回退

- `launchPreferredBrowser(headless)` 首次固定调用 `channel:'chrome'`；Headless 仅附加 `args:['--enable-gpu']`，headed 不附加 GPU flag。
- 只接受 Patchright/Playwright 的可执行文件不存在错误：错误消息同时包含 `Executable doesn't exist`（大小写不敏感）和 Chrome channel 的缺失语义。该判断封装为纯函数并用正反例测试。
- 符合时以脱敏 warning 记录 `{ preferred_channel:'chrome', fallback_channel:'chromium' }`，不记录路径或原始错误，再调用 `channel:'chromium'`。
- 其他错误直接抛出原对象，确保权限、代理、崩溃等错误身份不变。

## 3. RuntimeProfile

WeakMap 值使用以下内部结构：

```js
{
  mode: 'headless' | 'headed',
  channel: 'chrome' | 'chromium',
  version: string,
  contextOptions: object,
  installConsistencyScript: boolean,
}
```

- Headless `contextOptions` 是固定常量的副本，并加入动态 `userAgent`。
- Headed `contextOptions` 仅为 `{ viewport:null }`。
- `storageState` 和消费者 `proxy` 在创建具体 Context 时附加，不写回 profile。
- consumer 收不到 profile 时返回 `E_BROWSER_RUNTIME`，防止未知来源 browser 绕过固定配置。

## 4. UA 规则

从 `browser.version()` 只提取主版本数字，生成：

- Linux：`Mozilla/5.0 (X11; Linux x86_64) ... Chrome/<major>.0.0.0 ...`
- Windows：`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...`
- macOS：`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...`

平台输入默认为 `process.platform`，仅接受 `linux`、`win32`、`darwin`。错误统一由 `browserRuntimeError()` 生成 `PddCliError({ code:'E_BROWSER_RUNTIME', exitCode:GENERAL })`。

## 5. Context 与白名单脚本

Headless 固定值：

```js
viewport: { width: 1902, height: 984 }
screen: { width: 1920, height: 1080 }
deviceScaleFactor: 1
locale: 'zh-CN'
timezoneId: 'Asia/Shanghai'
```

初始化脚本在每个 Context 的 `newPage()` 前安装。脚本沿原型链找到原生 accessor 的 owner，用原 getter 创建 `Proxy`；`apply` 先调用原 getter维持 receiver 校验，再返回固定值，最后以 `{ ...descriptor, get:proxy }` 写回同一 owner。找不到原生 getter时抛错，让 Context 初始化失败关闭，而不是静默形成半配置。

唯一属性覆盖：

```text
window.outerWidth  -> 1920
window.outerHeight -> 1080
screen.availHeight -> 1050
```

## 6. 生命周期和兼容性

- Browser 启动后立即注册；profile 构造、Context、init script 或 Page 创建失败都走 `closeBrowser()`。
- `closeBrowser()` 在 finally 中同时注销 registry 和 WeakMap profile。
- `closeAllBrowsers()`、`withBrowser()` 和 fixture 短路契约保持不变。
- `getBrowserExecutablePath()` 仍只报告 Patchright Chromium 路径，因此 doctor 继续验证必要的回退运行时，不把可选系统 Chrome 变成 doctor 硬依赖。
- CLI、envelope、认证文件格式和代理配置均无公共接口变化。

## 7. 验证策略

- 纯单测通过 mock `chromium.launch()` 覆盖 channel、错误分类、版本、配置、脚本顺序和清理。
- 本地 Chromium 集成测试使用 `data:`/本地页面和跨域测试服务器验证主页面、iframe、popup/第二页面；不访问真实 PDD。
- Sannysoft、Javabin、Passer-by、Tools321 属于 Linux 人工/受控浏览器验收，不写自动绕过脚本，不保存敏感检测页面原图。Ping0 仅记录可用性和脱敏观察，不属于完成门槛。
- 系统 Chrome 只有在 CDP 报告 `gl=none`/WebGL disabled、浏览器日志同时报告 EGL 配置不兼容、其余必过项正常且 Patchright Chromium 已证明真实硬件 WebGL 可用时，才允许把 Sannysoft WebGL Vendor/Renderer 记为非阻塞兼容性风险。该例外不适用于其他 Sannysoft FAIL，也不授权 WebGL 伪造或强制 Vulkan。
