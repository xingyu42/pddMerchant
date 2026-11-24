# 02: 环境诊断 `doctor` 深领域下沉、修复双浏览器与清理 `--probe`

**What to build:** 建立纯业务环境诊断领域模块，提供 `diagnoseEnvironment(options, deps)` 入口（仅接收外部可选传入商家账号、`BrowserRuntimePort`、`AuthPort` 与 `log`，无需携带 `OutputSink`），返回纯值结果 `DoctorReport`（`{ ok, view, raw, warnings, failure }`，不重复返回 `resolvedAccount`）。将原 35 行旧版存储探测浅模块吸收至诊断领域内部并保持防符号链接一级只读扫描与最早期触发，将 `renderDoctor` 迁入认证视图模块与 `toDoctorView` 同源维护。`doctor` 命令接入 `withCommand`（`local` 预设 + `needsAccount: 'optional'`，`needsMall: 'none'`），固化诊断顺序修复 Live 双浏览器启动问题（先检 Chromium 可用性失败立即 `E_CHROMIUM_MISSING` 零启浏览器，至少一方登录态可读再开启单次 `BrowserSession` 同 Profile 完成只读 `Merchant Authentication Check` 与消费端 `Login Online Check`，严格零租约、零写回、零重登且遵循 ADR-0002/0003 对守护进程零依赖）；同步移除命令注册中无读取方的 `--probe` 冗余选项与更新 `skills/pdd-cli/SKILL.md` 第 59 行，消除 `doctor` 对适配器层的直连与残留模式判断。参见 `../spec.md`。

**Blocked by:** 01, auth-console-login-deepening#01

**Status:** ready-for-agent

- [ ] `diagnoseEnvironment`（吸收旧版存储探测、`renderDoctor` 同源归位）上线且只返回 `{ ok, view, raw, warnings, failure }`；`doctor` 在 Chromium 缺失时启动浏览器 0 次，双端健康时严格启动 1 次，且早期 `legacy_storage_detected` 在异常路径仍保留
- [ ] 在 `runner` 与 `DoctorReport` 间保持商家可选账号单一解析出处（无账号 `null`、多账号无默认冲突按规则报错），遵循 ADR-0002/0003 仅做只读 `Merchant Authentication Check`（零指纹打分、零租约、零写回、零重登）
- [ ] 删除旧版存储探测孤立浅模块并更新受影响文档路径，移除 `--probe` 选项及用户 CLI 技能文档第 59 行对应说明
- [ ] `doctor` 彻底消除适配器直连与 `isMockEnabled()` / `runtime.mode === 'fixture'` 过渡分岐，通过领域/命令单测、Fixture E2E、`doc-paths` 与 `npm run check`
