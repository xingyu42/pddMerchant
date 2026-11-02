# Linux 真 Headless 浏览器一致性增强

## Goal

继续使用真正的 `headless:true`，消除 pdd-cli 当前浏览器运行时特有的 UA、窗口、屏幕与 Context 配置矛盾。目标是内部一致且可验证，不承诺无法检测，不引入 Xvfb、随机指纹或大范围属性伪造。

## Requirements

### R1 浏览器运行路径

- Headless 和 headed 都优先启动系统 Chrome，分别使用 `{ headless:true, channel:'chrome', args:['--enable-gpu'] }` 与 `{ headless:false, channel:'chrome' }`。
- 仅当错误明确表示系统 Chrome 可执行文件未安装时，记录不含路径和原始错误的 warning，并回退到同模式的 `channel:'chromium'`。
- 权限、崩溃、代理和其他运行时错误必须原样上抛，不能用回退掩盖。
- Patchright Chromium 必须继续作为可安装、可检查的回退运行时；doctor 不新增联网指纹评分。

### R2 动态 UA 与平台映射

- Headless 从 `browser.version()` 提取真实 Chrome 主版本并生成精简 Chrome UA。
- 支持 Linux x64、Windows 10 x64 与标准 Macintosh 标识；无法解析版本或无法映射平台时抛出 `PddCliError`，代码 `E_BROWSER_RUNTIME`。
- HTTP User-Agent 与 `navigator.userAgent` 必须由同一个 Context `userAgent` 选项产生。
- Headed 不覆盖 UA。

### R3 固定 Headless 一致性配置

- Headless Context 固定：viewport `1902x984`、screen `1920x1080`、DPR `1`、locale `zh-CN`、timezone `Asia/Shanghai`。
- 在创建首个页面前使用 Context 级 `addInitScript()`，且对 iframe 和后续页面生效。
- 手工覆盖仅允许 `window.outerWidth=1920`、`window.outerHeight=1080`、`screen.availHeight=1050`。
- 三个属性使用原生 getter 的 `Proxy` 包装，并保留原 descriptor。
- 不修改 webdriver、plugins、WebGL、Canvas、Audio、memory、Client Hints、languages 或色深。

### R4 Headed 自然配置

- Headed Context 使用 `viewport:null`。
- Headed 不覆盖 UA、locale、timezone、DPR、screen 或窗口属性，也不安装一致性脚本。

### R5 消费者 Context 与代理边界

- 使用 WeakMap 记录 browser 的模式、实际 channel、版本与配置；消费者 Context 自动继承同一配置。
- 消费者 `proxy` 仍只用于商品来源抓取；每次尝试创建新 Context，继续只读复用 `storageState`。
- 商家、登录、doctor 和其他流量不得接入消费者来源代理。

### R6 接口与生命周期

- 删除未使用的 viewport 与 `extraContextOptions` 覆盖入口，CLI 不新增参数或环境变量。
- 初始化任一步失败必须关闭已创建的 Browser/Context/Page，并保留原错误；运行时版本/平台错误统一映射为 `E_BROWSER_RUNTIME`。
- 关闭 browser 时清理 WeakMap 元数据；现有 registry 重入语义保持不变。

### R7 文档与部署边界

- 更新 `CONTEXT.md`、ADR `0002-use-strict-headless-consistency-profile.md` 和 `.trellis/spec/adapter/browser-runtime.md`。
- 部署方负责 Debian/Ubuntu 运行库；系统 Chrome 可选，Patchright Chromium 必须安装。
- 不新增 Dockerfile、检测脚本、旧模式开关或账号级随机化。

## Acceptance Criteria

- [x] 单元测试证明系统 Chrome 首选，且仅“可执行文件不存在”触发 Chromium 回退。
- [x] 崩溃、权限和其他错误不回退；无效版本/平台返回 `E_BROWSER_RUNTIME`。
- [x] Headless UA 使用真实主版本，HTTP UA 与 JS UA 一致；固定 Context 参数准确。
- [x] 白名单严格为 UA 加三个 getter，headed 无任何一致性注入。
- [x] 消费者 Context 保留 fresh Context、proxy 和只读 storageState 语义。
- [x] 本地浏览器集成测试覆盖主页面、同源/跨域 iframe 和第二页面，并证明脚本早于页面代码生效。
- [x] browser、consumer、page-session、auth、doctor、registry 定向测试及完整 `npm test` 通过。
- [x] Debian/Ubuntu x86_64 上系统 Chrome 主路径和无系统 Chrome 的 Chromium 回退路径都完成验证。
- [x] Patchright Chromium 回退路径达到 Sannysoft（含 WebGL Vendor/Renderer）、Javabin、Passer-by、Tools321 的锁定标准。
- [x] 系统 Chrome 路径达到 Javabin、Passer-by、Tools321，并通过 Sannysoft 除 WebGL Vendor/Renderer 外的选定项。仅当 CDP 与浏览器日志共同证实宿主为 `gl=none`/EGL 不兼容时，这两个 WebGL 项按用户接受的兼容性风险记录，不阻塞本次完成；记录中不含 IP、Cookie、账号状态或敏感原图。
- [x] Ping0 仅作为网络/IP 综合环境观察项；因结果和页面可用性明显受出口、DNS、CDN 与线路影响，不计入浏览器一致性通过率，也不阻塞任务完成。

## Locked Assumptions

- 唯一承诺四个浏览器检测站通过的生产目标为 Debian/Ubuntu x86_64。
- Windows/macOS 只保持可用，使用宿主平台 UA 与相同窗口模型，不承诺四站结果。
- 直接替换默认行为，不提供旧模式或紧急回退开关。
- 不伪造 GPU/WebGL。Patchright Chromium 回退路径仍须以真实硬件 WebGL 通过；系统 Chrome 只有经 `gl=none` 与 EGL 日志双重确认的 WebGL Vendor/Renderer 兼容性例外可作为非阻塞风险，其他 Sannysoft 失败仍然阻塞。
- 检测规则会变化，本任务只承诺验收时的明确结果，不承诺永久通过。
