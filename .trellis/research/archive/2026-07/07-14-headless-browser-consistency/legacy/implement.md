# 实施计划：Linux 真 Headless 浏览器一致性增强

## 阶段 0：任务与规范边界

- [x] 创建独立任务 `07-14-headless-browser-consistency`。
- [x] 原 `07-13-fix-goods-publish-draft-validation-fill` 只记录阻塞关系，状态保持 `in_progress`。
- [x] 读取 browser、auth、mall、endpoint、logger、adapter 与 testing 规范。

## 阶段 1：浏览器运行时

- [x] 增加系统 Chrome 首选与严格“未安装”回退分类。
- [x] 增加浏览器版本解析、平台 UA 和 `E_BROWSER_RUNTIME`。
- [x] Headless 仅增加 `--enable-gpu`，保留 Chrome 自身后端探测；headed 不增加 GPU flag。
- [x] 建立 WeakMap RuntimeProfile，并在关闭时清理。
- [x] 默认 Headless 使用固定 viewport/screen/DPR/locale/timezone/UA。
- [x] Headed 使用 `viewport:null` 且不安装一致性脚本。
- [x] Context init script 只覆盖三个白名单 getter，并早于首个页面。

## 阶段 2：调用方与接口收紧

- [x] 移除 `launchBrowser()` 的 viewport/`extraContextOptions` 入口。
- [x] 移除 `createConsumerContext()` 的 viewport 入口并继承 RuntimeProfile。
- [x] 保持消费者 fresh Context、storageState 和来源代理边界。
- [x] 确认 doctor 仍只检查 Patchright Chromium、登录与现有运行条件。

## 阶段 3：自动测试

- [x] browser adapter 单测覆盖两个 channel、严格回退、配置、UA、脚本顺序和清理。
- [x] consumer Context 单测覆盖 profile 继承、proxy、storageState 与失败清理。
- [x] 本地浏览器集成测试覆盖主页面、同源/跨域 iframe、第二页面和 HTTP/JS UA 一致。
- [x] 运行 browser、consumer、page-session、auth、doctor、registry 定向测试。
- [x] 运行 `npm test`、`git diff --check` 和生产 Patchright import 扫描；不以 `npm run lint` 作为证明。

## 阶段 4：文档与规范

- [x] 更新 `CONTEXT.md` 的 Headless/桌面/白名单术语。
- [x] 新增 ADR `docs/adr/0002-use-strict-headless-consistency-profile.md`。
- [x] 更新 `.trellis/spec/adapter/browser-runtime.md`，只允许本 ADR 的 UA 和三个 getter。
- [x] 运行 `trellis-check` 和 `trellis-update-spec` 流程。

## 阶段 5：Linux 验收

- [x] Debian/Ubuntu x86_64：安装系统 Chrome，验证首选路径。
- [x] Debian/Ubuntu x86_64：移除/隔离系统 Chrome，验证 Patchright Chromium 回退路径。
- [x] 两条路径分别运行 Sannysoft、Javabin、Passer-by、Tools321，并按最终 PRD 风险口径记录脱敏结果。
- [x] Ping0 已运行并保留脱敏观察，但按用户决定不计入浏览器一致性完成门槛。
- [x] 用户于 2026-07-15 接受系统 Chrome 150 在已证实 `gl=none`/EGL 不兼容时的 Sannysoft WebGL Vendor/Renderer 风险；该豁免不扩大到其他检测失败。
- [x] 两条 Linux 路径按最终风险口径完成，Windows 结果未用于替代 Linux 验收。

## Linux 验收记录（2026-07-15，完成）

环境：Debian GNU/Linux 12 (bookworm) x86_64，一次性 Docker 容器；记录不含 IP、Cookie、账号状态或截图。

| 路径 | 浏览器版本 | 契约/集成测试 | Sannysoft | Javabin | Passer-by | Tools321 | Ping0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 无系统 Chrome，Patchright Chromium 回退 | 149.0.7827.55 | 21/21 通过 | WebGL Renderer 未通过 | “我看不出来” | Chrome / robot=false | Headless 10/10、Bot 3/3、CSS 5/5；额外暴露 WebGL 与字体项 | 观察项：站点 CDN TLS 连接被关闭，不计入完成门槛 |
| 系统 Google Chrome 首选 | 150.0.7871.124 | 21/21 通过 | WebGL Renderer 未通过 | “我看不出来” | Chrome / robot=false | Headless 10/10、Bot 3/3、CSS 5/5；额外暴露 WebGL、Audio 与字体项 | 观察项：站点 CDN TLS 连接被关闭，不计入完成门槛 |

环境诊断：Docker 能看到 GPU 设备，但 Vulkan 只提供软件 renderer；无条件强制 Vulkan 会使系统 Chrome GPU 进程持续高 CPU 并阻塞退出，相关实验已撤回。该容器结果只证明双路径功能契约与软件渲染边界，不单独作为 GPU 通过证据。最终验收同时采用下方 Ubuntu/WSL2 的真实硬件 WebGL 证据与用户接受的系统 Chrome 兼容性风险；最终代码不伪造 WebGL/GPU，Ping0 不阻塞。

最终图形验收环境：Ubuntu 24.04 WSL2 x86_64，Mesa 25.2.8，WSLg D3D12 OpenGL；全程 `headless:true`，未运行 Xvfb。该环境用于证明回退浏览器能选择真实硬件 renderer，并定位系统 Chrome 150 的宿主 EGL 兼容性边界；它不构成对所有原生 Linux 驱动组合的保证。

| 路径 | 浏览器版本 | 契约/集成测试 | Sannysoft | Javabin | Passer-by | Tools321 | Ping0 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 无系统 Chrome，Patchright Chromium 回退 | 149.0.7827.55 | 21/21 通过 | 选定项全部通过，含 WebGL Vendor/Renderer | “我看不出来” | Chrome / robot=false | Headless 10/10、Bot 3/3、CSS 5/5；WebGL 使用硬件 D3D12 | 观察项：`cdn.ping0.cc` 两个 IPv4 边缘均重置连接，IPv6 无可用路由；不计入完成门槛 |
| 系统 Google Chrome 首选 | 150.0.7871.124 | 21/21 通过 | WebGL Vendor/Renderer 未通过；其余选定项通过 | “我看不出来” | Chrome / robot=false | Headless 10/10、Bot 3/3、CSS 5/5；WebGL Context 不可用 | 观察项：同一 CDN 网络阻塞；不计入完成门槛 |

WSL 诊断：`--enable-gpu` 让 Patchright Chromium 149 选择 `egl-angle`/OpenGL 并获得硬件 D3D12；系统 Chrome 150 的 GPU 日志则为 `No suitable EGL configs found`，CDP 报告 `gl=none` 与 WebGL disabled。WSL 当前没有 dzn/NVIDIA Vulkan ICD，不能安全采用官方 Vulkan 后端。该差异属于宿主图形栈/浏览器版本组合，不授权伪造 WebGL；用户已将系统 Chrome 的这两个 Sannysoft WebGL 项接受为非阻塞兼容性风险，其他必过项均按原标准判断。

最终判定：Patchright Chromium 149 路径完整通过四个浏览器检测站的锁定项；系统 Chrome 150 路径除 Sannysoft WebGL Vendor/Renderer 外通过，且该例外已由 `gl=none` 与 EGL 日志归因并由用户接受。按最终 PRD 口径，Linux 验收完成。

## 验证命令

```powershell
npx vitest run test/adapter/browser-runtime-contract.unit.test.js test/adapter/browser-consumer-context.test.js
npx vitest run test/pbt/with-browser.pbt.test.js test/pbt/page-session.pbt.test.js test/pbt/browser-registry.pbt.test.js
npx vitest run test/auth-state.unit.test.js test/auth-state-v03.unit.test.js test/auth-refresher-lifecycle.unit.test.js
npx vitest run test/doctor-browser-runtime.unit.test.js test/doctor-render.unit.test.js
npm test
git diff --check
rg -n "from ['\"](?:patchright|playwright)['\"]" src bin
```
