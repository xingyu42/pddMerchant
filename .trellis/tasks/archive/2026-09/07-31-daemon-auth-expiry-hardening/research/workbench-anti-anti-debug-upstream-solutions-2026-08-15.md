# Workbench 反反调试现成方案核验（2026-08-15）

## 结论

没有找到对当前 x64 Workbench 可直接保证生效的“一键方案”。最接近现成方案的是 HyperHide，但它需要测试签名、两个内核驱动、重启和 Intel VT-x/EPT，且上游仍有新版 VMProtect 无法绕过及驱动崩溃报告，只适合在可丢弃的虚拟机快照中验证。

当前不建议继续盲试 ScyllaHide 配置。上游已有与 `VMProtect Initialization error 4` 完全对应的问题，维护者说明 VMProtect 可用直接系统调用绕过 ScyllaHide 的用户态钩子；本机启用 HookLibrary 后连续访问冲突也符合“不兼容”而不是“缺少某个开关”。

## 目标壳版本识别

- 样本：`tmp/pinduoduo/3.7.0.14/PDDDataLogic.dll`
- SHA-256：`681B7931291FBBF6007596490371CC2058E78ABB05E8954DD94682B6F01E01C8`
- Detect It Easy 3.10 深度、启发式扫描结果：`Protector: VMProtect(3.2.0-3.5.0)`。
- 命中特征包括 VMProtect 风格导入、`.vmp` / `.vmp1` 段以及压缩的 `.vmp1` 段。
- 结论边界：可以确认是 VMProtect 3.x，静态签名将版本限定为 `3.2.0-3.5.0`；当前没有证据把它精确到其中某个小版本。DLL 自身的 `3.7.0.14` 是商家工作台产品版本，不是 VMProtect 版本。

复现命令：

```powershell
.\tmp\tools\die-3.10\diec.exe -d -u -b -j .\tmp\pinduoduo\3.7.0.14\PDDDataLogic.dll
```

## 方案核验

### ScyllaHide

- [Issue #51](https://github.com/x64dbg/ScyllaHide/issues/51) 与当前错误文本直接对应。讨论表明错误可能来自调试器探测、软件断点扫描或 `NtQueryInformationProcess` 行为差异，不能只凭错误编号断定单一原因。
- [Issue #53](https://github.com/x64dbg/ScyllaHide/issues/53) 和 [Issue #83](https://github.com/x64dbg/ScyllaHide/issues/83) 均指出 VMProtect 会按系统版本直接发起系统调用，可能绕过用户态 ScyllaHide；instrumentation callback 曾改善部分版本，但容易失效。
- [Issue #147](https://github.com/x64dbg/ScyllaHide/issues/147) 仍有 VMProtect 3.6 检测报告。
- [Issue #156](https://github.com/x64dbg/ScyllaHide/issues/156) 的 Heaven's Gate 绕过仅适用于 x86 目标，当前 Workbench 为 x64，不适用。

判定：有相关修补思路，但没有可直接套用且经当前目标验证的稳定配置。

### TitanHide

- [TitanHide Issue #85](https://github.com/mrexodia/TitanHide/issues/85) 中维护者于 2024 年明确表示项目无人测试，自己也不再维护或使用。

判定：历史上能补足内核层隐藏，但当前不应作为推荐的现成方案。

### HyperHide

- [官方仓库](https://github.com/Air14/HyperHide) 提供基于 hypervisor/EPT 的 x64dbg 插件，能够在比 ScyllaHide 更低的层级处理直接系统调用。
- 安装要求包括 Intel VT-x/EPT、Windows x64、测试签名、两个内核驱动和重启；README 明确要求不要在生产系统运行，应使用虚拟机。
- [Issue #28](https://github.com/Air14/HyperHide/issues/28) 的 VMProtect 3.6 问题曾由维护者声明修复。
- [Issue #56](https://github.com/Air14/HyperHide/issues/56) 仍报告最新版 VMProtect 无法绕过。
- [Issue #60](https://github.com/Air14/HyperHide/issues/60) 报告过 `HookedNtQueryObject` 竞态导致驱动崩溃。

判定：最值得验证的现成候选，但不是已证实可用于当前 Workbench 的方案，只能在隔离虚拟机中试验。

## 推荐顺序

1. 完全禁用 ScyllaHide，从 `PDDDataLogic.dll + 0x77FDC` 附近回溯控制错误分支的具体检测谓词。
2. 在可丢弃的 Windows x64 虚拟机快照中使用 HyperHide 做对照实验，不安装到当前宿主机。
3. 只有确认某个 ScyllaHide 钩子导致冲突后，才考虑定制 ScyllaHide 构建；这已不是现成二进制方案。

## 私域资料交叉核验

### 与目标版本最接近的实现资料

[看雪《VMProtect3.5.1 脱壳临床指南》](https://bbs.kanxue.com/thread-286780.htm)描述的初始化期反调试链与当前 `3.2.0-3.5.0` 静态识别范围高度吻合，包括：

- PEB `BeingDebugged`；
- `NtQueryInformationProcess` 的 `ProcessDebugPort`（7）、`ProcessDebugObjectHandle`（`0x1E`）和 `ProcessDebugFlags`（`0x1F`）；
- `NtQuerySystemInformation` 的内核调试器检查；
- API 首字节 `0xCC`、非法 `CloseHandle`、`NtSetInformationThread(ThreadHideFromDebugger, 0x11)`；
- TF 单步异常期间检查 `DR0-DR3`；
- 由内部控制量决定直接执行 syscall，还是经 `LoaderGetProcAddress` 解析 API。

该文章的示例以 32 位为主，只能作为算法线索。当前目标为 x64，PEB 应从 `GS:[0x60]` 获取，调用参数应按 Windows x64 ABI 检查，不能照抄 `FS:[0x30]`、栈参数或文中的地址和偏移。

特别需要动态核对返回契约，而不是只判断调用是否成功：

- `ProcessDebugObjectHandle` 的未调试状态应返回 `NTSTATUS 0xC0000353`，输出句柄为 0；
- `ProcessDebugFlags` 的未调试值应为 1。

这些线索与 [ScyllaHide Issue #51](https://github.com/x64dbg/ScyllaHide/issues/51) 的方向一致，但尚未证明 `PDDDataLogic.dll + 0x77FDC` 具体由其中哪个谓词控制。因此，`Initialization error 4` 当前应分类为“疑似初始化期反调试返回契约不匹配或调试器被检测”，而不是已确认的单一根因。

### 其他现成工具和经验的适用性

- [AntiVmp v1.0 beta](https://bbs.kanxue.com/thread-289086.htm) 面向 OllyDbg/32 位且存在硬编码、依赖和稳定性反馈，不适用于当前 x64 Workbench。
- [TitanHide 检测分析](https://bbs.kanxue.com/thread-290460.htm)显示 VMProtect 会构造 `\\?\TitanHide` 并通过直接 syscall 调用 `NtOpenFile` 检测原版 TitanHide，进一步降低了把 TitanHide 当作现成解法的可信度。
- [吾爱破解同版本范围讨论](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2088077)没有提供可复现的方法。
- [VMProtect 3.5.1-3.8.1 调试崩溃讨论](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2039803)只能提醒区分壳的反调试与应用自身故障，不能证明当前根因。
- [x64dbg 最新 VMP 插件讨论](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2091208)仍有 ScyllaHide 被识别的反馈，没有形成有效方案。
- [VMProtect 3.5.1-3.7.3 OEP 路线](https://www.52pojie.cn/forum.php?mod=viewthread&tid=1817473)主要用于找外壳 OEP，没有解决当前初始化检测、IAT 或虚拟机代码问题。
- [VMProtect 3.8 反调试讨论](https://www.52pojie.cn/forum.php?mod=viewthread&tid=1887734)和 [VMProtect 3.9 驱动教程](https://www.52pojie.cn/forum.php?mod=viewthread&tid=2095519)属于其他版本的历史经验，且内核路线仍有不一致和蓝屏风险，不能直接外推到当前目标。

### 下一轮 x64 动态实验

1. 完全禁用 ScyllaHide，避免 HookLibrary 的地址 0 连续 `0xC0000005` 干扰真实检测路径。
2. 在模块仍加载时清除 x64dbg 已恢复的软件断点和 DLL-load 断点，确认下一轮 attach 后断点数为 0。
3. 启动或早期附加时不放用户软件断点，先验证 `PDDDataLogic.dll + 0x77FDC` 是否从全零页面正常解包为 `cmp edx, 0x02` 开头的代码。
4. 只有确认保护初始化已经完成后，才安装 SQLite 或 PDDCef 观察点；不要在模块入口、TLS 和目标 API 首字节提前放置 `INT3`。
5. 若仍需跟踪模块内直接 syscall，`NtQueryInformationProcess` 在 x64 下重点观察 `RDX` 是否为 7、`0x1E` 或 `0x1F`；`NtSetInformationThread` 重点观察 `EDX=0x11`。
6. 若使用硬件断点定位 PEB、`OSBuildNumber` 或初始化路径，在进入 VMP 的 TF 异常检查前清除 `DR0-DR3`。
7. 在识别具体条件前不修改错误弹窗或退出分支，避免把完整性检查造成的二次失败误判为原始检测。

推荐优先执行这条定点回溯路线。它比继续盲换 ScyllaHide 配置更能回答当前样本的真实失败条件；HyperHide 保留为隔离虚拟机中的对照实验，而不是第一步。

## 2026-08-15 动态对照结论

### 已证实的直接问题

`Initialization error 4` 的本轮直接触发条件不是“没有选对 ScyllaHide profile”，而是 x64dbg 会把软件断点保存到 `release/x64/db/PddWorkbench.exe.dd64`，后续会话又自动恢复这些模块相对断点。原跟踪脚本只停止旧调试会话，没有清理断点数据库，因此参数已经跳过某组目标时，上一轮留下的 `INT3` 仍可能在对应模块加载后重新出现。

动态对照证据：

- `x64dbg-login-trace-20260815-203721.json`：跳过 PDDLoginSDK/PDDDataLogic 入口，但保留 PDDCef/SQLite 目标；最终停在 `PDDDataLogic+0x77FDC`，该地址内存为全零，x64dbg 中存在 16 个恢复的软件断点。
- `x64dbg-login-trace-20260815-203952.json`：继续跳过 PDDCef，只保留 SQLite 目标；SQLite 目标安装后出现标题为 `PDDDataLogic.dll` 的错误窗口，仍未命中 SQLite 业务函数。
- `x64dbg-login-trace-20260815-204145.json`：命令行跳过全部目标，但未先清理数据库；模块加载后仍恢复出 16 个旧软件断点，再次停在全零的 `PDDDataLogic+0x77FDC`。这证明“skip 参数”本身不足以清除历史断点。
- `x64dbg-login-trace-20260815-204408.json`：在模块仍加载时删除全部 16 个断点并清掉 DLL-load 断点后，真正的零断点基线持续运行 30 秒，进程响应正常，没有错误标题。
- `x64dbg-login-trace-20260815-204714.json`：加入脚本自动清理后的 10 秒回归同样通过，收尾后断点数为 0。

真正的零断点基线中，`PDDDataLogic+0x77FDC` 的首条指令是 `cmp edx, 0x02`，随后为 `jnz`；失败会话中同一 RVA 是全零页面，RIP 落在那里后只能被反汇编成重复的 `add byte ptr [rax], al`。因此该 RVA 是“保护初始化未完成后的失败落点/结果”，不是已经识别出的反调试判断谓词。

### ScyllaHide 的结论边界

- `VMProtect x86/x64` profile 的 HookLibrary 注入会导致地址 0 附近连续 `0xC0000005`，这是独立的插件兼容故障。
- `Disabled` profile 下未观察到 `HookLibraryx64.dll` 注入。
- 在 `Disabled`、断点数为 0、只按严格规则放行 VMProtect `ret` / `jmp -> ret` 异常桩时，保护初始化可以通过。
- 因此当前不需要安装 TitanHide/HyperHide，也不应继续猜 ScyllaHide profile。先保证调试会话不恢复历史软件断点。

### 跟踪脚本修复

`trace-workbench-login-redacted.ps1` 新增：

- `-SkipPddCefTargets` 和 `-SkipSqliteTargets`，可与 `-SkipProtectedEntryTargets` 组合形成零目标基线；
- `Clear-TraceBreakpoints`，在启动前、attach 后和结果写入前删除全部软件断点并清除已知模块的 DLL-load 断点；
- 收尾清理避免当前跟踪目标再次污染下一次 x64dbg 会话。

PowerShell 语法检查通过；零目标回归验证收尾后的断点数保持为 0。

### 剩余限制

本轮解决的是“调试时 Workbench 老是报错”的可复现原因，但尚未获得 `sqlite3_key*` 或 `sqlite3_prepare*` 命中。下一步不能在保护初始化期间提前插入软件断点；应先跑过零断点初始化，再在明确的初始化完成点之后安装 SQLite 观察点，或者改用不修改目标代码字节且不会在 VMP 检查期间占用 `DR0-DR3` 的观测方式。

### 延迟布点验证

脚本新增 `-DelayTargetsUntilPddDataLogicReady`：启动阶段保持零断点，轮询 `PDDDataLogic+0x77FDC` 的首条反汇编字节；确认其从零页变为 `83FA02` 后，使用 x64dbg 原生 `pause` 暂停目标，再安装所选观察点。

`x64dbg-login-trace-20260815-205848.json` 验证结果：

- 约 `6.2s` 时确认 `+0x77FDC` 正常解包；
- 随后只安装 SQLite 目标；
- Workbench 持续运行、响应正常，没有 `PDDDataLogic.dll` 错误标题；
- 45 秒内没有命中 `sqlite3_open*`、`sqlite3_key*` 或 `sqlite3_prepare*`，说明需要观察的启动期调用早于安全的软件断点安装时机。

当前推荐分两种用途：

1. 调试后续 UI/登录操作：使用延迟软件断点模式，初始化通过后再手动触发相关操作。
2. 捕获最早启动调用：不要提前写入 `INT3`，下一实验应使用精确页保护内存断点并做零断点基线对照；如果页保护仍被检测，再考虑隔离虚拟机中的更低层观测。

### 页保护内存断点验证

`trace-workbench-login-redacted.ps1` 新增 `-UseSqliteMemoryBreakpoint` 和 `-SqliteMemoryTarget`。该模式只在目标 SQLite 导出地址设置 1 字节内存断点，不写入 `INT3`，也不占用 `DR0-DR3`；当前仅允许选择 `sqlite3_key` 或 `sqlite3_key_v2`，避免一次保护多个代码页。

两次独立启动均成功命中 `sqlite3_key`，Workbench 保持响应，未出现 `Initialization error 4`：

- `x64dbg-login-trace-20260815-211625.json`：约 `5.4s` 命中，密钥长度为 11，仅记录 SHA-256 前缀 `387c0e834065dfa5`，未保存原始字节。
- `x64dbg-login-trace-20260815-211913.json`：约 `5.2s` 再次命中，长度和哈希前缀完全一致；返回地址位于 `PDDDataLogic.dll + 0x67CED`。

第二次命中后的已解包代码显示，实际调用指令位于 `PDDDataLogic.dll + 0x67CE7`，调用前执行：

- `lea rdx, [PDDDataLogic+0xC2F50]`；
- 比较 `[PDDDataLogic+0xC2F68]` 是否达到 `0x10`，并按 MSVC `std::string` 小字符串优化规则选择内嵌缓冲区或堆指针；
- 从 `[PDDDataLogic+0xC2F60]` 读取长度到 `r8d`；
- 经 VMProtect 跳板调用 `sqlite3_key`。

运行时只读取了对象元数据：长度为 11，容量为 15。因此当前可以确认 SQLite 密钥在调用前已保存在 `PDDDataLogic.dll + 0xC2F50` 的全局 `std::string` 中，并采用内嵌小字符串存储。尚未定位该全局对象的写入者或密钥派生过程；x64dbg 对该数据地址的静态 xref 结果为空，不能据此声称密钥是编译期常量。

结论更新：当前无需完整脱壳。精确页保护内存断点已经解决最早启动调用的观测问题，后续若继续追踪，应观察全局对象 `+0xC2F50` 的首次有效写入，而不是再对 `sqlite3_key` 或壳入口布置软件断点。

### 全局密钥对象首次写入实验（2026-08-16）

跟踪脚本增加 `-WatchPddDataLogicKeyLength`，在 `PDDDataLogic.dll + 0xC2F60` 的 8 字节长度字段设置内存断点，只记录访问指令、模块 RVA、长度和容量，不读取对象内的密钥字节。脚本同时恢复了已验证的附加契约：`debug_attach_pid` 使用 `attach_break=false`，附加成功后再显式暂停；`attach_break=true` 会让当前目标反复耗尽稳定附加窗口。

`x64dbg-login-trace-20260816-153418.json` 的结果触发停止条件：

- 约 `4.68s` 在 `PDDDataLogic.dll` 加载后安装长度字段内存断点；
- 随后没有任何 `key_length_access` 命中；
- Workbench 保持进程响应，但窗口标题变为 `PDDDataLogic.dll`，与初始化错误窗口一致；
- 收尾确认断点数为 0，并停止调试会话。

这说明“SQLite 函数代码页的精确内存断点可用”不能外推为“VMProtect 初始化期间任意数据页保护都可用”。对 `+0xC2F60` 过早设置页保护会干扰保护初始化，无法用它捕获首次写入者。按预先约定的停止条件，不再继续调整该数据断点的范围、命中条件或安装时机。

当前证据边界保持为：SQLite 密钥调用、长度、稳定哈希、直接调用点和调用前全局 `std::string` 存储位置均已动态确认；密钥对象的写入者和派生过程仍未验证。若必须继续追查该链路，下一阶段应转为初始化完成后的运行时定点转储与离线分析，而不是继续带壳早期断点试错。

### 2026-08-16：x64dbg MCP 控制层故障边界

在 `2026-08-16` 的后续实验里，阻塞点已从样本 anti-debug 收缩到 x64dbg MCP 宿主本身：

- x64dbg HTTP 端口 `127.0.0.1:3000` 可以恢复监听，但对测试进程 `23772` 调用 `debug_attach_pid(pid=23772, attach_break=true, timeout_ms=15000)` 后，插件返回 `success:false`、`debugging:false`、`error:"attach failed (see x64dbg-mcp.log)"`。
- 同一时刻的 `x64dbg-mcp.log` 记录为：`AttachProcessCore: attach .23772 (decimal pid)`，随后立即 `Direct command failed`；等待满 `15000 ms` 后仍报告 `DbgIsDebugging still false`。这说明失败发生在调试器附加命令层，而不是脚本没有识别出失败。
- 作为对照，直接发 `script_execute` 的 `attach .23772`、`attach 23772`、`attach 0x5CDC`、`mcpattach 23772`、`mcpattachbreak 23772` 五种命令格式都只返回“命令提交成功”；随后连续轮询 `debug_get_state` 5 秒，状态始终是 `stopped`，没有进入 `running` 或 `paused`。
- 再尝试 `debug_init` / `debug_run` / `debug_restart` 两条启动链，分别指向 `tmp/pinduoduo/PddWorkbench.exe` 和 `tmp/pinduoduo/3.7.0.14/PddWorkbench.exe`，MCP 都返回 `success:true`，但 `debug_get_state` 仍保持 `stopped`，`module_get_main` 为 `null`，`module_list` 为空。说明当前宿主不仅 attach 失效，连 MCP 启动调试也没有真正落到 x64dbg 的活跃会话。

因此，`2026-08-16` 这轮长度字段观察没有继续卡在 `Initialization error 4`，而是被 x64dbg MCP 的 start/attach 失效提前拦住。结论上应先修复或绕过当前控制层，再重跑 `trace-workbench-login-redacted.ps1 -WatchPddDataLogicKeyLength`；在控制层恢复前，不宜继续把失败归因到 Workbench 样本本身。

### 2026-08-16：运行时 `.text` 的 IDA 离线引用分析

零断点运行时转储只包含 `PDDDataLogic.dll` 的 `.text`，RVA `0x1000`、大小 `0x80000`。转储 SHA-256 为 `46f2b4e9573ea367a84d0db565dfa665f348c830ed9ec305c9951664c480875e`；没有转储 `.data`、`.rdata`、`.vmp0`、`.vmp1` 或完整模块。

IDA 9.3 raw binary 初始段从 `0x640` 开始，脚本随后重定位到 `0x1000`。在这种数据库里，`idc.get_operand_value()` 对未定义代码的 RIP 相对数据操作数会保留未映射坐标：已知读取点 `0x67CC9` 被错误解析为 `0xC2910`，而 `ida_ua.map_data_ea(insn, operand)` 正确返回 `0xC2F50`。扫描器已改为使用后者，并在错误结果中保存 traceback；交接中记录的第二个 `AttributeError` 本轮未复现。

`ida-pdddatalogic-key-object-xrefs-20260816-v5.json` 的结果通过可信度门槛：

- 找到已知读取点 `0x67CC9`，目标为对象首地址 `0xC2F50`；
- 找到 25 个逐字节解码候选；去掉从 REX/指令前缀后一个字节再次解码的机械重叠后，共 13 个规范候选；
- `0x67CC9`、`0x67CD0`、`0x67CD8`、`0x67CE0` 是已知 `sqlite3_key` 调用前的取址、容量、SSO 缓冲区和长度读取；
- `0x6853E`、`0x68546`、`0x68550`、`0x68562` 是另一组同结构读取；
- `0x80CC4`、`0x80CD1` 读取容量和缓冲区，`0x80D10` 将空对象元数据写回 `0xC2F60`，`0x80D18` 将对象首字节清零。该函数先按容量决定是否释放堆缓冲区，再重置对象，因此属于清理/析构路径，不是初始化写入者。

初始化写入路径位于 `0x1300`：

```text
0x1304  mov r8d, 0xB
0x130A  lea rdx, [0xAAE90]
0x1311  lea rcx, [0xC2F50]
0x1318  call 0x254E0
0x131D  lea rcx, [0x80CC0]
0x1328  jmp 0x775A0
```

这里按 Windows x64 ABI 把 `RCX=全局 std::string 对象`、`RDX=源地址`、`R8D=长度 11` 传给 `0x254E0`。同一 helper 还被 `0x255E0` 的通用字符串初始化包装器调用；后续把 `0x80CC0` 交给 `0x775A0` 的流程与退出清理注册一致。由此可以确认：全局对象的初始化写入由 `0x1300 -> 0x254E0` 完成，`0x80CC0` 负责清理。

源地址 `0xAAE90` 位于当前 `.text` 转储之外，本轮没有读取或转储其内容。因此当前只能确认“静态初始化路径把一个长度为 11 的源写入全局字符串”，不能确认源字节、生成算法或它是否还会在其他运行条件下变化。整个离线分析只记录 RVA、指令、长度和控制流，没有新增密钥字节、Cookie、账号身份或认证材料。

#### 源地址的引用与节属性

扫描器增加了可选的 `PDD_IDA_TARGET_START`、`PDD_IDA_TARGET_END`、`PDD_IDA_KNOWN_READER` 和 `PDD_IDA_SCAN_BOUNDARY`，不设置时仍保留原对象扫描行为。以 `0x130A` 为可信度门槛扫描 `0xAAE90 <= target < 0xAAE9B`，两次独立结果完全一致：只找到 `0x130A` 及其省略 REX 前缀后的重叠解码 `0x130B`，访问类型均为 `address`，没有直接写引用。

原样本 SHA-256 仍为 `681b7931291fbbf6007596490371cc2058e78abb05e8954dd94682b6f01e01c8`。只解析 PE 节表、不读取目标 RVA 内容后确认：

- `0xAAE90` 位于 `.rdata`（RVA `0x81000`，virtual size `0x3E060`）；
- 节特征为 `0x40000040`，即 initialized data + read，未设置 write；
- 该节在受保护的磁盘 PE 中 `raw_size=0`，因此目标内容并不以普通 `.rdata` 原始字节存在于样本文件中。

IDA 将 `0x254E0` 定义为函数后，其汇编确认该 helper：校验长度上限，设置容量 `15`，按 `length < 16` 选择 SSO，否则分配堆缓冲区，复制 `RDX` 指向的源并写入结尾零字节。它消费 `RCX/RDX/R8`，不生成 `RDX` 源内容。因此 `0x1300 -> 0x254E0` 是对象复制/构造链，不是源值派生算法。

当前最窄结论为：源位于运行时只读 `.rdata`，但原始受保护 PE 没有该节的磁盘 raw backing；当前原生 `.text` 转储只发现源取址，没有源写入者。最可能的解释是 VMProtect 解包、虚拟化路径或保护层加载过程在原生初始化函数执行前提供了该运行时映射，但具体机制尚未验证。按隐私和停止边界，不读取该 11 字节源、不扩大为 `.rdata` 或完整模块转储，也不把“最可能”升级为已证实的派生路径。

### 2026-08-16：`auto/check/login` 的 `PDDRequest` 调用链边界

运行时反汇编确认 `MultiCurlRequest::Post` 导出入口跳转到模块内 `+0x27710`；该实现按 Windows x64 ABI 使用 `RDX=BaseRequestInfo*`、`R8=BaseResponse*`。已观察到的请求对象在 `BaseRequestInfo+0x160` 保存一个 MSVC 字符串形式的 endpoint。跟踪脚本只对目标路径做本地精确比较，并输出布尔值、长度和 SHA-256 前缀，不保存 URL、header、请求值或响应正文。

管理员权限 x64dbg 恢复后，`x64dbg-auto-check-login-request-installed-20260816-v8.json` 在启动期命中 3 次 `Post`，均来自 `PDDDataReport.dll+0x8809`；其中可解析的 endpoint 长度均为 16、指纹一致，且都不是目标路径。`Request` 没有命中。该调用点使用虚表 `+0x18` 间接调用，当前只能确认它属于独立的数据上报链，不能外推为登录请求构造者。

脚本复核发现两处会破坏延迟布点语义的问题并已修正：`Add-TraceEvent` 的 `List.Add()` 返回值会污染函数返回对象；通用暂停处理会在 `targetsArmed=false` 时仍安装模块目标。修正后的 `x64dbg-auto-check-login-request-installed-20260816-v10.json` 在约 5.61 秒确认 `PDDDataLogic+0x77FDC` 已完成初始化后才安装两个硬件执行断点，60 秒内只命中 1 次同一数据上报调用，没有命中目标路径。

这次阴性结果不是“目标接口不经过 `PDDRequest`”的证据。正常启动约 12 秒后工作台能出现业务窗口；相同安装版本被 x64dbg 早期附加后，60 秒仍没有主窗口，即使初始化前保持零断点也是如此。现阶段已确认的阻塞点是“早期附加改变了业务启动状态”，因此不能继续靠重复启动追踪来证明调用链。若要继续，应改为在正常业务窗口出现后附加，再寻找可重复触发自动检查的界面或渲染器动作；在没有独立触发方式前，不修改 `pdd-cli` 业务实现，也不声称该接口具有长期凭据换票语义。

### 2026-08-27：正常业务窗口后的晚附加对照

已安装的 `3.7.0.14` 工作台正常启动约 15 秒后进入有响应的业务窗口。管理员 x64dbg 随后对该现有进程晚附加成功，主模块和 `PDDRequest.dll` 路径均与已安装版本一致；在运行状态布置 `Request +0x27340`、`Post +0x27350` 和 `Execute +0x27480` 三个硬件执行断点，没有修改目标内存。

执行一次窗口失焦再回焦后，`Post` 命中 1 次。只做本地布尔比较和元数据读取后确认：endpoint 长度为 16，不等于目标路径长度 27，返回地址仍为 `PDDDataReport.dll+0x8809`；`Request` 和 `Execute` 均未命中。因此窗口回焦只复现了既有数据上报噪声，不是已证实的自动登录检查触发器。

晚附加仍会持续触发保护层动态页异常。仅使用 `erun` 放行异常后，`Post` 第二次命中同一长度 16、同一调用者的数据上报；没有跳过指令或修改寄存器。为避免继续污染执行，x64dbg 执行 `detach` 并报告成功，但工作台进程随后退出。再次不带调试器正常启动后，前 30 秒只出现有响应的登录窗口；继续观察时，同一进程自行切回有响应的业务窗口，未要求人工扫码。

当前 `LoginData` 目录只保留 1 个数据库文件；仅记录到长度 12288 字节、文件名指纹和修改时间。修改时间对应第一次成功进入业务窗口的启动阶段；第二次启动从登录窗口延迟恢复到业务窗口期间没有再次更新。文件被当前工作台独占，因此没有强行读取哈希或内容。该现象不能证明长期授权被删除、失效、消费或重写；当前只确认自动恢复仍可用，但本轮晚附加/脱离不是无扰动观测。

新的停止边界：不再把回焦作为候选触发器，不再重复附加、脱离、重启或抓图，也不点击二维码/账号控件。当前工作台已经自行恢复到业务窗口；在找到独立触发器或不依赖调试器脱离的单次观测方案前停止动态实验，并继续保持只记录 RVA、调用关系、长度和布尔分类的脱敏范围。

### 2026-08-28：无头 IDA 还原 `AntInterface` 异步发送链

本轮改用 IDA MCP 的 `idalib` worker，并在打开数据库时显式指定 `force_headless`。分析期间不需要 `ida.exe` 或 `idat64.exe` 界面进程；结束后所有 worker 会话均以 `save=false` 关闭，只保留无界面的 `idalib-mcp.exe` 服务进程。

为分析运行时 `PddWorkbench.exe` `.text`，只把既有脱敏代码段包装成保持原映像基址和 RVA 的临时 PE：`.text` RVA `0x1000`、长度 `0x745A14`、SHA-256 `a0510ea8e1cf72ba4852ac78cc75b1b0bac2988813e4201011041b3f7a25d548`。IDA 恢复出 7095 个候选函数，但对动态函数指针槽 `PddWorkbench+0xABCC38`、`AntInterface.dll` 名称和 `AntCommonInterface::Post` 装饰名均没有直接静态引用。现有证据仍指向经对象或函数表间接分派，不能据此认定调用不存在。

`AntInterface.dll` 的静态符号、字符串和调用点已经把通用 POST 发送路径闭合到 socket：

```text
AntCommonInterface::Post                 RVA 0xCBB0
  -> request wrapper                     RVA 0x25990
  -> URI request construction            RVA 0x24FD0
  -> titan::TitanService::StartRequest   RVA 0x234F0
  -> WrapperTitanCallback::StartTask     RVA 0x63000
  -> queued lambda                       RVA 0x64330
  -> titan::StartTitanTask               RVA 0x3AAF0
  -> task construction                   RVA 0x58BE0
  -> task dispatch                       RVA 0x58840
  -> callback enqueue                    RVA 0xABA60
  -> callback body                       RVA 0xAE870
  -> titan::TitanCore::__DoStartTask     RVA 0xB0CC0
  -> titan::TitanTaskManager::StartTask  RVA 0x1800F0
  -> mars dispatch lambda                RVA 0xBA100
  -> mars::stn::NetCore::StartTask       RVA 0x14C4D0
  -> LongLinkTaskManager                 RVA 0xD2FC0
  -> mars::stn::LongLink::__Run          RVA 0x1EB500
  -> LongLink::__RunReadWrite            RVA 0x1EEA20
  -> ws2_32!send call site               RVA 0x1EF66C
```

其中原 AFD 发送栈里的 `AntInterface+0x29FDF`、`+0x35BD7`、`+0x1EBDA8`、`+0x1EF672` 均是 `call` 后的返回地址，不是函数入口。`+0x1EF672` 紧跟 `call ws2_32!send`；上层两个地址分别来自线程包装器的虚调用返回点，`+0x1EBDA8` 来自 `LongLink::__Run` 的虚调用返回点。

本轮补齐的关键异步缺口位于 `RVA 0x58B3D`：`RVA 0x58840` 调用 `RVA 0xABA60`，后者构造 `lambda_7ce7c05a4706c5b688186f698f1dc717` 并交给队列函数 `RVA 0x3F300`。该 lambda 的执行入口 `RVA 0xAE870` 尾跳到 `TitanCore::__DoStartTask`，随后在 `RVA 0xB242C` 调用 `TitanTaskManager::StartTask`。因此调用栈里看不到 `PddWorkbench.exe` 同步帧是异步队列切换造成的，不是发送链缺失。

结论边界：这条链证明了目标请求进入 `AntCommonInterface::Post` 后如何经 Titan/Mars 长连接发送，也解释了已捕获 AFD 栈的各返回地址；它仍没有证明受 VMProtect 保护的 `PddWorkbench.exe` 中哪个函数构造 `/janus/api/auto/check/login` 并调用该接口。磁盘数据库虽然包含 `AntInterface.dll`、`Login@AntCommonInterface` 和 `Post@AntCommonInterface` 的静态装饰名，但保护代码没有可用 xref。下一次若继续动态定位，应只在正常业务窗口出现后对 `AntCommonInterface::Post` 做单次晚布点，记录调用者模块/RVA和目标路径布尔分类，不读取或保存 URL、header、请求参数、响应正文或账号材料。

### 2026-08-28：运行时延迟导入表与 `Post` 分派桩

本轮先执行了一次无调试器、无点击的隔离启动，只输出窗口状态、节 RVA、长度和布尔分类。工作台从登录窗口自行进入业务窗口；脚本复用既有隔离配置，没有复制配置目录，也没有把任何内存原始字节写入磁盘。结束时工作台进程已关闭，`PersonalFolderPath` 已恢复，清理无错误。该次实验没有读取或保存请求实值、header、响应正文、账号材料或认证字段。

第一次推导只把基准 `.data` 的起始 RVA `0x958000` 与运行时 `0x965000` 相减，得到 `+0xD000`，并据此把磁盘 `Post` IAT `0xABCC38` 错算为运行时 `0xAC9C38`。该槽在采样时不属于 `AntInterface.dll`，脚本按预设校验立即停止。这个结果只证伪“节起始位移等于 IAT 位移”，不能证明 `Post` 未解析或导入表不存在。

进一步核对发现基准 `.data` 虚拟长度为 `0x16C770`，运行时长度为 `0x16CAF8`，新增 `0x388` 字节。运行时延迟导入表的总位移因此是 `0xD000 + 0x388 = 0xD388`。这一映射由两个相邻方法独立交叉验证：

- 基准 IAT 索引 13 是 `AntCommonInterface::Get`，`0xABCC30 + 0xD388 = 0xAC9FB8`；运行时 `.text` 有 35 个对该槽的直接调用。
- 基准 IAT 索引 17 是 `AntCommonInterface::UpdateSDKConfig`，`0xABCC50 + 0xD388 = 0xAC9FD8`；运行时 `.text` 有 4 个对该槽的直接调用。
- 基准 IAT 索引 14 是 `AntCommonInterface::Post`，所以正确运行时槽为 `0xABCC38 + 0xD388 = 0xAC9FC0`。

对已识别的 447977 条运行时指令完整扫描后，`0xAC9FC0` 只有一处操作数引用：`PddWorkbench+0x52FFE3` 的 `lea rax, [Post IAT]`。该地址不是业务调用者，而是 `Post` 专属延迟加载桩；它跳到公共路径 `PddWorkbench+0x52FF5E`。公共路径保存通用寄存器和 XMM 参数，调用 `PddWorkbench+0x54F280` 解析并缓存目标函数，恢复参数后用 `jmp rax` 进入目标。`+0x54F280` 的反编译与汇编均显示其按 PE 延迟导入描述符定位模块和名称表，并把解析结果写回传入的 IAT 槽。

正确 `Post` 槽没有直接 `call`，`Post` 分派桩 `+0x52FFE3` 也没有静态代码 xref、指令操作数引用或代码段内绝对地址表项。当前最窄结论是：原生 `.text` 已闭合到 `Post` 延迟加载桩，但最后一个同步业务调用者仍未静态恢复；现象与受保护路径在运行时计算分派目标相符，但这仍是风险假设，不是已证实的 VM 指令语义。为遵守停止边界，本轮没有因第一次偏移假设失败而再次启动工作台，也没有读取候选只读字符串进行目标路径比对。

若后续具备独立、自然的目标请求触发时机，仍应在正常业务窗口出现后只对 `AntInterface.dll+0xCBB0` 做一次晚期硬件执行布点，本地比较目标路径并仅记录“是否目标”、调用者模块和调用者 RVA。没有该动态命中前，不应把 `PddWorkbench+0x52FFE3`、`+0x52FF5E` 或 `+0x54F280` 误写成最终业务调用者。

### 2026-08-28：CPU 采样栈单次验证与 `Init` 反证

本轮没有执行原脚本中尚未运行的整段 `.data` 指针扫描。即使该扫描只准备输出模块/RVA，读取完整运行时数据段仍无法满足“不读取请求实值、认证材料、账号信息或密钥字节”的严格边界。替代方案是在现有 ETW 小工具中增加仅启用 `Process`、`Thread`、`ImageLoad` 和 CPU `Profile` 的单次模式；它不启用 AFD/网络 provider，只保留包含 `AntInterface+0xCBB0..0xCE11` 的栈，并且每帧只写模块名和 RVA。

管理员权限 smoke 先以本地 CPU 工作进程运行 3 秒、采样间隔 `0.125 ms`，得到 25034 个目标样本；未命中 `Post` 符合预期，原始 ETL/ETLX 和临时输出均已删除。随后只复用既有隔离配置执行一次正式启动：请求采样 20 秒、间隔 `0.125 ms`，观察到登录窗口约在 `3195 ms` 出现，业务窗口约在 `10078 ms` 出现。ETW 共记录 104979 个目标 CPU 样本，其中 28 个样本栈落在 `AntCommonInterface::Post` 范围，28 个栈变体均未截断。

这 28 个栈在 `Post` 之上的第一条 `PddWorkbench.exe` 帧完全一致，都是返回地址 `PddWorkbench+0x256787`；再上层稳定出现 `PDDRequest+0x251F1E` 和 `PDDRequest+0x1E5CE`，其外层来源包括工作台、账号业务、UI、消息和客服模块。这里的 28 是 CPU 采样命中数，不等于 28 次请求，也没有读取 URL 或正文来判断其中哪一个样本属于 `/janus/api/auto/check/login`。

force-headless IDALib 对保持运行时 RVA 的临时 PE 做了指令级核验。返回地址前的指令位于 `PddWorkbench+0x256781`，是 `call qword ptr [PddWorkbench+0xAC9F58]`，长度 6 字节，下一条正是 `+0x256787`。但 `+0xAC9F58` 按已经由 `Get` 和 `UpdateSDKConfig` 交叉验证的 `+0xD388` 延迟导入位移，映射回磁盘 IAT `+0xABCBD0`，即索引 1 的 `AntCommonInterface::Init`，不是索引 14 的 `Post`。调用前的寄存器和两个栈参数布置也与 `Init` 的参数数量一致。`AntInterface` 数据库进一步确认 `Init` 位于 RVA `0xAC00`、`Post` 位于 RVA `0xCBB0`，两者是不同函数，`Init` 的直接 callee 列表中也没有 `Post`。

因此，ETW 结果只证明“执行落在 `Post` 时，栈展开链最终回到了 `PddWorkbench+0x256781` 的 `Init` 调用点”。它不能证明该地址直接调用 `Post`；更合理但仍未证实的解释是同步传递调用、尾调用或保护代码/栈展开缺帧。紧邻的 `PDDRequest+0x251F1E` 位于磁盘映像无法映射的受保护运行时区域，现有只读 IDB 不能继续静态恢复。由于本轮也没有做目标路径实值分类，不能把这些通用 `Post` 样本认定为自动登录请求。最后一个直接 `Post` 业务调用者仍未闭合，本轮按单次启动停止边界不再重复启动工作台。

正式输出目录最终只剩一份脱敏 JSON；其中明确记录未附加调试器、未读进程内存、未启用网络捕获、未检查请求或认证实值，且原始 trace 已删除、`PersonalFolderPath` 已恢复、捕获和清理均无错误。工作台、ETW probe 和 IDA UI 进程均已退出，IDALib session 数为 0。
