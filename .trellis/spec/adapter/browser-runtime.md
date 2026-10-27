# Patchright Browser Runtime Contract

## 1. Scope / Trigger

适用于修改 `src/adapter/browser.js`、Patchright/Chromium 启动、Context 配置、`page.evaluate()`、认证状态加载、消费者代理 Context、doctor 浏览器检查或浏览器清理逻辑。决定依据为 `docs/adr/0002-use-strict-headless-consistency-profile.md`。

## 2. Signatures

唯一运行时边界：

```js
launchBrowser({ headed?, storageState? }) -> Promise<{ browser, context, page }>
withBrowser(options, fn) -> Promise<unknown>
createConsumerContext(browser, { storageState?, proxy? }) -> Promise<{ context, page, close }>
createSnapshotContext(browser, storageState) -> Promise<BrowserContext>
getBrowserExecutablePath() -> string
evaluateInMainWorld(pageOrFrame, pageFunction, arg?) -> Promise<unknown>
```

不允许重新加入 caller-defined viewport 或 `extraContextOptions`。依赖与安装：

```text
patchright@1.61.1
npx patchright install chromium
```

## 3. Launch And Profile Contracts

- `src/adapter/browser.js` MUST 是唯一生产环境 `patchright` import 所有者。
- Headless 和 headed MUST 先使用 `channel:'chrome'`；只有错误明确为 Chrome executable/distribution missing 时，才以脱敏 warning 回退同模式的 `channel:'chromium'`。
- 权限、崩溃、代理和其他启动错误 MUST 保持原错误对象并直接上抛。
- Headless launch contract MUST 精确包含 `headless:true`、实际 `channel` 与 `args:['--enable-gpu']`；headed contract MUST 只包含 `headless:false` 与实际 `channel`。`--enable-gpu` 只允许 Chrome 做正常硬件探测，不代表硬件验收通过。
- MUST NOT 无条件加入 `--use-angle=vulkan`、`--enable-features=Vulkan`、`--ignore-gpu-blocklist` 或其他后端/身份覆盖 flags；缺少兼容 Vulkan userspace 时，Chrome GPU 进程可能持续高 CPU 且阻塞清理。
- 每个 Browser MUST 绑定 WeakMap RuntimeProfile：模式、实际 channel、`browser.version()`、Context 配置；关闭时 MUST 删除。
- 浏览器版本无法解析时 MUST 返回 `E_BROWSER_RUNTIME`。Headless 平台只支持 `linux`、`win32`、`darwin` 的明确 UA 映射，未知平台 MUST 返回同一错误。
- doctor MUST 继续检查 Patchright Chromium executable 是否存在；系统 Chrome 是可选首选项，不是 doctor 硬依赖。

## 4. Context Contracts

Headless 固定配置：

```js
{
  viewport: { width: 1902, height: 984 },
  screen: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  userAgent: '<host platform + actual Chrome major>',
}
```

- HTTP UA 与 `navigator.userAgent` MUST 来自同一个 Context `userAgent`。
- Context `addInitScript()` MUST 在首个 `newPage()` 前安装，并覆盖该 Context 的 iframe 与后续页面。
- 手写属性覆盖白名单严格为 `window.outerWidth=1920`、`window.outerHeight=1080`、`screen.availHeight=1050`。MUST 使用原 getter 的 `Proxy` 并保留 descriptor。
- MUST NOT 修改 webdriver、plugins、WebGL、Canvas、Audio、memory、Client Hints、languages、色深或 GPU。
- Headed Context MUST 仅设置 `viewport:null`，不得覆盖 UA、locale、timezone、DPR、screen 或窗口属性，不得安装一致性脚本。
- Consumer Context MUST 继承所属 Browser 的 RuntimeProfile；`proxy` 只能加入该 fresh consumer Context，merchant/login/doctor 保持直连。
- Browser helper 只接收调用方从库中解密出的 `storageState` 对象作为 Context 输入（不落临时文件、不自行写回）：必须有 cookies/origins 数组，否则拒绝；仅复制 `cookies`/`origins` 标准字段，不把 merchant_auth 等元数据传给浏览器。不增加公开参数、不改变 RuntimeProfile。
- 商家 runner 只能通过 `withMerchantAuthUpdate` 的租约 + CAS 提交保存登录态；消费者代理 Context 不写回共享登录快照。

## 5. Patchright And Lifecycle Contracts

- Patchright 默认 `page.evaluate()` 位于隔离世界。读取页面全局、React expando 或站点包装 fetch 时 MUST 使用 `evaluateInMainWorld()`，第三参数为 `false`。
- Browser/Context/Page 清理 MUST 覆盖成功、callback 失败、版本错误、`newContext()`、`addInitScript()` 和 `newPage()` 失败。
- `closeAllBrowsers()` 保持重入安全；`withBrowser()` MUST 保留业务错误身份。
- `ghost-cursor-playwright.createCursor()` MUST await，并传入 `locator.boundingBox()` 的具体矩形。
- Fixture mode MUST 绕过真实 browser launch，且不得读取真实 auth state。

## 6. Validation Matrix

| Condition | Required behavior |
| --- | --- |
| system Chrome available | use `channel:'chrome'` and actual version |
| system Chrome explicitly missing | redacted warning, same-mode `channel:'chromium'` fallback |
| EACCES/crash/proxy/other launch failure | no fallback; preserve original error |
| bundled Chromium or an unclassified Linux path remains software-rendered | environment acceptance failure; do not spoof WebGL and keep browser-site acceptance incomplete |
| system Chrome reports `gl=none`/WebGL disabled and logs independently report an EGL configuration failure | only when every other required check passes and bundled Chromium proves a real hardware WebGL renderer, record Sannysoft WebGL Vendor/Renderer as the accepted non-blocking compatibility warning |
| Ping0 unavailable or reports route/IP/DNS risk | record as a redacted network observation; do not classify it as a browser-runtime failure or completion blocker |
| invalid browser version/platform | `E_BROWSER_RUNTIME`, close partial resources |
| default headless Context | exact fixed profile + dynamic UA + three getter script |
| headed Context | `{ viewport:null }`, no consistency script |
| consumer proxy supplied | only fresh consumer Context receives proxy |
| executable path string absent on disk | doctor reports Chromium missing |
| main-world runtime read/fetch | use `evaluateInMainWorld()` |

## 7. Tests Required

- Browser unit: both preferred paths, strict missing-only fallback, dynamic UA/platform mapping, fixed options, headed natural mode, init order and cleanup.
- Consumer unit: RuntimeProfile inheritance, fresh Context, optional proxy, storageState and partial cleanup.
- Real local integration (`PDD_RUN_BROWSER_INTEGRATION=1`): main page, same-origin/opaque cross-origin iframe, later page, native getter descriptors, HTTP/JS UA equality.
- Lifecycle: `withBrowser()` error identity、page-session、browser registry re-entry。
- Auth/doctor: storageState、auth refresher、browser missing hint、JSON purity。
- Shared runtime change MUST run full `npm test`; `npm run lint` 是 no-op，不能作为质量证明。
- Production import scan MUST confirm only `src/adapter/browser.js` imports Patchright/Playwright runtime。
- Linux completion MUST separately verify Debian/Ubuntu x86_64 system Chrome and bundled Chromium paths against Sannysoft、Javabin、Passer-by、Tools321。Bundled Chromium MUST 以真实硬件 WebGL 通过；系统 Chrome 只有 CDP `gl=none`/WebGL disabled 与 EGL 失败日志双重证实时，才允许豁免 Sannysoft WebGL Vendor/Renderer，其他失败仍阻塞。Ping0 仅允许作为脱敏网络观察项，不得阻塞浏览器运行时任务完成。

## 8. Good / Bad Cases

- Good：Headless 从实际 Chrome 136 生成 Chrome/136 UA，三个 Context/API 维度一致，consumer proxy 只存在于来源抓取 Context。
- Good：系统 Chrome 缺失时回退 Chromium；Chrome 因权限失败时直接报原错误。
- Good：iframe 保留自身自然 `innerWidth/innerHeight`，但继承同一 screen、outer 与 UA 配置。
- Good：Patchright Chromium 在 Linux 使用真实硬件 renderer 并通过 Sannysoft WebGL Vendor/Renderer；系统 Chrome 的其他必过项也通过。
- Base：系统 Chrome 同时出现 CDP `gl=none`/WebGL disabled 与 EGL 失败日志，而回退 Chromium 已证明真实硬件 WebGL 可用时，只把 Sannysoft WebGL Vendor/Renderer 记录为用户接受的兼容性风险。
- Base：没有系统 Chrome、没有硬件渲染时仍可通过 Patchright Chromium 完成功能测试；四站 GPU 验收保持未完成，不将软件渲染包装成通过。
- Base：四个必过浏览器站点满足标准但 Ping0 CDN 不可达时，保留脱敏观察并继续按浏览器验收结果判断完成状态。
- Bad：为检测站变绿而修改 Canvas/WebGL/plugins/memory/languages，或让每个调用方传自定义 viewport。
- Bad：看到任意 WebGL 或 Sannysoft FAIL 都套用系统 Chrome 例外，或缺少 CDP/EGL 双重证据仍宣称完成。
- Bad：任意 launch 错误都回退，掩盖权限、崩溃或代理故障。
- Bad：headed 复用 Headless UA 或初始化脚本。
- Bad：doctor 联网访问指纹检测站或输出检测页敏感结果。

## 9. Wrong vs Correct

### Wrong：无条件强制 Vulkan

```js
await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan'],
});
```

这会把“不支持 Vulkan”的环境从可诊断的软件渲染退化成 GPU 进程高 CPU/无法清理。

### Correct：保持统一启动边界，环境差异单独验收

```js
await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--enable-gpu'],
});
```

运行时不伪造 WebGL。Bundled Chromium 或未归因路径仍是软件渲染时，必须更换具备兼容驱动的环境并重跑；系统 Chrome 只有满足 CDP/EGL 双重证据、其余必过项正常且 bundled Chromium 已证明真实硬件 WebGL 时，才能记录上述窄范围兼容性风险。若未来引入 GPU capability gate，必须先更新 ADR、错误矩阵与 Linux 集成测试。
