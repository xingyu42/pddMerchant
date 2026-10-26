# 商家工作台“30 天内自动登录”脱敏动态分析

## 结论

现有 `checked` / `unchecked` 两组隔离抓包已经证明，“30 天内自动登录”不是单纯延长或持久化 Chromium Cookie。勾选后，工作台在重启时会调用一个独立的自动登录接口：

```text
/janus/api/auto/check/login
```

勾选组在该请求之后立即进入账号业务初始化，没有再次请求二维码；取消勾选组重启后没有调用该接口，而是重新请求二维码并持续轮询扫码结果。

结合浏览器 Cookie 数据库和原生 `LoginData` 文件，当前最可靠的原理模型是：

1. 扫码登录成功时，勾选项允许工作台保存一份原生自动恢复授权。
2. 这份授权不依赖 Chromium 持久 Cookie；工作台关闭后，账号 Profile 的 Cookie 数据库中没有持久账号 Cookie。
3. 下次启动时，工作台用原生恢复材料调用 `/janus/api/auto/check/login`。
4. 自动登录检查成功后，工作台重新建立账号上下文，随后执行用户信息、子系统 token、聊天和店铺业务初始化。
5. `PDDCef.dll` 已静态确认的 `Attach_To_Browser`、`Set_Cookie`、`Get_Cookie_Pass_ID` 和 `Set_PDDID_Header` 链路负责把恢复后的短期网页身份材料注入浏览器。

这证实了“较长期的自动恢复授权 + 较短期的网页会话”分层模型。它仍不证明 30 天是绝对 TTL、滑动窗口，或服务端必然重新签发 `PASS_ID`。

## 实验边界

- 两组实验均在独立 Windows Sandbox 中运行官方签名的 `3.7.0.14` 样本。
- `checked` 保持“30 天内自动登录”默认勾选；`unchecked` 在扫码前取消勾选。
- 报告只记录 endpoint、UTC 时间、文件长度、哈希、熵和数据库结构元数据。
- 未记录或输出 Cookie、二维码内容、请求体、响应体、账号、店铺、设备标识或 token 原值。
- 原始 PCAPNG、TLS key log 和认证文件副本只保存在本地 `raw-sensitive/` 目录。

## 抓包时间线

### 勾选组

抓包：`dynamic/captures/checked-20260811-165119/raw-sensitive/network.pcapng`

| UTC 时间 | 观察 |
| --- | --- |
| `08:51:42.143` | 首次请求 `/janus/api/scan/login/qrcode` |
| `08:51:42.532` ~ `08:54:09.399` | 周期请求 `/janus/api/scan/login/query`，共 139 次 |
| `08:54:11.687` | 登录完成阶段出现 `/space/user/login` |
| `08:54:57.966` | 重启阶段请求 `/janus/api/auto/check/login`，仅 1 次 |
| `08:54:58.030` 起 | 紧接着请求店铺用户信息、子系统 token、账号信息、聊天等业务 endpoint |

重启后没有出现第二次 `/janus/api/scan/login/qrcode`。`relaunch.ps1` 先启动 Workbench，等待 5 秒并生成快照，最后才写入 `RelaunchedAt`；因此抓包中的 `08:54:57.966` 属于重启后的启动阶段，而不是第一次扫码登录阶段。

### 取消勾选组

抓包：`dynamic/captures/unchecked-20260811-160658/raw-sensitive/network.pcapng`

| UTC 时间 | 观察 |
| --- | --- |
| `08:07:20.984` | 首次请求 `/janus/api/scan/login/qrcode` |
| `08:07:21.406` ~ `08:10:04.543` | 第一次扫码轮询 |
| `08:10:07.931` | 登录完成阶段出现 `/space/user/login` |
| `08:10:51.471` | 重启后再次请求 `/janus/api/scan/login/qrcode` |
| `08:10:51.549` ~ `08:13:32.651` | 重启后继续扫码轮询 |

取消勾选组整个抓包中没有 `/janus/api/auto/check/login`。重启后的 endpoint 集只有二维码获取和扫码轮询，没有进入勾选组观察到的账号业务初始化。

### 请求信封结构对比

抓包中的 PDD 请求使用 16 字节信封加 protobuf 元数据。只比较字段编号、长度和指纹后可确认：

- 字段 `2` 是 endpoint，字段 `6` 是 host。
- 勾选组首次二维码请求、取消勾选组首次二维码请求，以及取消勾选组重启后的第二次二维码请求，其不透明字段 `10` 都是 `45` 字节，指纹完全相同。
- 不透明字段 `9` 在三次请求中长度相近但指纹不同；同一 endpoint 重试也会变化，不能把该差异直接归因于勾选框。
- 自动登录请求的不透明字段 `9` / `10` 分别为 `1247` / `55` 字节，和二维码请求结构不同。

因此，目前没有证据表明“30 天”布尔值直接进入稳定的二维码创建请求体。更可能的候选是：客户端决定是否保存扫码查询返回的恢复材料，或该选项进入每次都会变化的签名/加密字段。两者必须在请求加密前的构造点继续区分。

## 本地持久化证据

### Chromium Cookie 不是恢复源

勾选组第一次正常关闭后复制的账号 Profile Cookie 数据库：

- `cookies` 表记录数为 `0`。
- 没有持久账号 Cookie，也没有可由 Chromium 自身恢复的 `PASS_ID`。
- `StaticPddBrowser` 的 Cookie 数据库只有一条名为 `PddBrowser` 的非持久、无 expires Cookie；未读取其值。

这与静态反编译得到的 `disable-persist-pdd-cookie` 行为一致：账号 Cookie 主要由 Workbench 原生层在启动时重新注入，而不是靠 Chromium Cookie 数据库跨进程保存。

### 原生 LoginData 高度符合加密 SQLite codec

两组登录后都生成：

```text
WorkbenchDB/LoginData/Data/<redacted>.db
```

已确认的结构事实：

- 文件长度都是 `12288` 字节，即 `3 x 4096` 页。
- 勾选组样本熵为 `7.98331 bits/byte`，256 种字节值全部出现，首部不是 `SQLite format 3`。
- 普通 SQLite 以只读方式打开时返回 `file is not a database`。
- 随样本附带的 `sqlite3.dll` 版本字符串为 `3.12.1`，包含 `HAS_CODEC`，并导出 `sqlite3_key`、`sqlite3_key_v2`、`sqlite3_rekey`、`sqlite3_rekey_v2`。
- 文件形态和配套库高度符合 SQLite codec 整库加密，不能直接当普通 SQLite 查询；仍需运行时命中 `sqlite3_key*` 才能最终确认调用关系，现有证据也不足以把具体实现确定为标准 SQLCipher。
- 勾选组的 `LoginData` 文件在自动登录重启前后长度、修改时间和哈希均未变化，说明启动恢复主要读取既有材料，不需要每次重写该数据库。

两组数据库内容哈希不同，但仅凭密文哈希不能定位“30 天”字段；差异可能来自勾选值、账号数据、随机盐或其他运行元数据。

## 2026-08-15 x64dbg / ScyllaHide 复核

本轮先修正了调试环境的两个前置条件：`x64dbg` 必须以管理员权限运行，且启动跟踪前必须没有任何既有 `PddWorkbench` 进程。否则会分别出现 `attach .PID` 直接失败，或因单实例转发误附加到短命启动进程。跟踪脚本现已在发现既有 Workbench 进程时失败关闭，并提供 `-SkipProtectedEntryTargets`，用于跳过静态入口为零字节的 `PDDLoginSDK` / `PDDDataLogic` 断点做 A/B。

干净环境下的对照结果：

- `VMProtect x86/x64` profile 确实完成 HookLibrary 注入，但工作台随后持续停在 `0xC0000005 @ 0`。45 秒样本分别记录 `912` 和 `913` 次动态异常；跳过两个受保护入口断点后结果不变，因此不是这些软件断点破坏了受保护代码。
- `Disabled` profile 不产生空地址异常。进程保持响应，命中 `PDDCef.SetPddID`，并加载 `sqlite3.dll`；随后停在 `PDDDataLogic.dll + 0x77FDC`，仍未命中 `sqlite3_open*`、`sqlite3_key*` 或 `sqlite3_prepare*`。这恢复了此前的早期初始化阻塞，而不是突破它。
- `Basic` profile、`Basic + DLLNormal=0`、`Basic + DLLUnload=1` 都仍记录 `Hook injection successful`，并重新出现 `0xC0000005 @ 0` 异常风暴。现有插件配置无法实现“只修补 PEB、不加载不兼容 HookLibrary”的有效组合。
- 本轮结束后已用备份逐字节恢复 `scylla_hide.ini`，恢复后 SHA-256 为 `B7EE4AB2F3B474B71981C7BA23CAAE417368E3B718895381AB39E58C07740D53`。

结论：当前 ScyllaHide `1.4.760-a727ac3` 的非 Disabled profile 与该 Workbench 启动链不兼容，不能作为继续追 `sqlite3_key*` 的现成方案。下一步应转向针对 `PDDDataLogic.dll + 0x77FDC` 的最小停点分析，或修改/重编译 HookLibrary 以禁用固定的文件映射钩子；在这之前继续枚举 ScyllaHide profile 收益很低。

## 证据分级

### 已证实

- 勾选项改变重启后的协议路径。
- 勾选组重启调用 `/janus/api/auto/check/login`，随后进入账号业务初始化。
- 取消勾选组重启不调用该接口，而是重新进入二维码登录。
- 勾选组关闭后的账号 Chromium Cookie 数据库为空，自动恢复不是浏览器持久 Cookie 的结果。
- 工作台存在加密的原生 `LoginData` 数据库；配套 SQLite 库明确支持 `sqlite3_key*` codec 接口。

### 最可能但尚未直接证明

- `LoginData` 中保存了自动登录所需的长期授权或其索引。
- `/janus/api/auto/check/login` 验证或兑换该授权，并返回建立短期网页会话所需的材料。
- 成功后由 Workbench delegate 和 PDD CEF IPC 把 Cookie、PDDID 和 app shop token 注入账号浏览器上下文。

### 尚未确认

- 自动登录请求的 method 枚举、请求字段名、响应字段名和业务成功字段。
- 长期授权的准确名称、数据库表、密钥派生和设备绑定方式。
- 自动登录是否签发新的 `PASS_ID`，以及新旧 `PASS_ID` 的关系。
- “30 天”是服务端绝对 TTL、滑动窗口，还是客户端最多尝试恢复的期限。
- 过期、换设备、换 IP、撤销授权和账号风控时的准确返回状态。

## 后续逆向范围

不需要先完整脱壳 `PDDLoginSDK.dll` 或 `PDDDataLogic.dll`。最小高收益动态断点是：

1. `sqlite3_open_v2` / `sqlite3_key` / `sqlite3_prepare_v2`：确认 `LoginData` 的打开、key 长度与 SQL 表结构。只记录 key 长度和指纹，不输出 key。
2. `/janus/api/auto/check/login` 明文构造点：记录 method、字段名、字段长度和响应业务字段，不记录字段值。
3. `PddBrowserManager::AttachToBrowserProc`、`SetPddID`、`NotifyGetBrowserCookies`、`ResetCookie`：确认自动检查成功后如何建立浏览器账号上下文。
4. `Notify_Cookie_Pass_ID` / `Set_Cookie` IPC：确认是否在自动登录后得到新的 `PASS_ID`；只比较指纹和 expires，不读取值。

只有观察到旧网页会话失效后，`auto/check/login` 仍能凭另一份授权得到一个新会话，才能把它最终定性为“长期授权换票”，而不仅是“重启恢复”。

## 对 pdd-cli 的影响

- 现有自然 `POST /janus/api/checkLogin` 仍适合作为“当前网页会话是否有效”的验活信号。
- “商家端不存在其他恢复协议”已被反证；官方工作台确实有独立自动登录协议。
- 这不意味着 `pdd-cli` 可以直接调用 `/janus/api/auto/check/login`：当前项目没有该原生授权、请求构造、设备绑定和本地加密材料。
- 在上述材料没有被确认前，不应复制 endpoint 名称后盲调接口，也不应修改 Cookie expires。
- 产品文案仍应保持“认证检查 + 状态快照 + 失效提醒”；若未来能安全取得官方同等授权，再单独设计账号隔离、密钥保护和恢复流程。
