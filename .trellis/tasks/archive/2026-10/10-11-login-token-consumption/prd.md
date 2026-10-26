# LoginToken 消费路径

> **已放弃（2026-10-27）**：实测未过期会话也恢复不了，服务端过期后无法续期。未提交改动已移入 git stash（"10-11 LoginToken consumption (abandoned, 10-27 password-relogin-console)"），spec 中的消费规则已撤销。被父任务 10-27-password-relogin-console 取代。

## 当前目标：恢复 LoginToken 到 Cookie 的消费路径

状态：已按用户要求和此前明确的保存材料消费路径实现，离线验收通过；待提交确认，新消费路径未做真实账号验收。用户撤销审计的收缩范围；本节是当前需求，后面的收缩版仅为历史。现有三目标请求前校验保留，但不代替消费功能。

### Goal

从受控浏览器正常授权采集并保留账号绑定的规范化 LoginToken 及同次完整材料。后续按需自动消费保存材料，建立可用于该账号的浏览器 Cookie，核验后更新业务使用位置与认证文件。明确区分获取、消费、核验、提交，不宣称服务端续期或 checkLogin 签发新 Cookie。

### Requirements

- N1：获取仅来自该账号的受控浏览器正常授权；不要求用户粘贴真实 Token，不扫描日常浏览器、工作台账号库，不导入不明格式 Token。
- N2：独立保留规范化 `login_token = PASS_ID=原值`、同次完整 cookies/origins、已核验店铺绑定和检查信息。只有 branded 已核验候选能建立或替换来源；未经核验的工作 Cookie 不能覆盖来源。
- N3：明确消费 LoginToken：解析它，并使用来源记录的真实 Cookie 属性及配套材料构造浏览器状态，写入隔离上下文。不得只增加字段或一致性比较；不得混用新 PASS_ID 和旧辅助 Cookie，不修改/伪造过期时间。
- N4：在 login 复用、普通认证命令前、doctor 商家检查时自动触发，无新增手动修复命令、定时器或后台。
- N5：工作 Cookie 缺失/不一致、但保存来源完整有效时，自动消费来源、三目标核验、确认店铺一致后恢复账号 Cookie；业务必须实际使用恢复后的上下文，而不是只验证一个随即关闭的副本。
- N6：消费结果全部通过核验后才能保存。沿用账号/路径锁、修订号、原子提交及店铺绑定；普通命令仍只在业务成功且最终快照再次核验后持久化。doctor 的必要商家恢复写入由显式事务承担，不放开其他 needsAuth:false 命令的写入。
- N7：旧文件完整保存 PASS_ID 时，可先按原有完整快照核验，再建立独立来源。没有完整保存材料、文件损坏或来源元数据非法时，不猜测/拼造材料；损坏文件沿用受信店铺重新授权恢复限制。
- N8：来源明确失效时普通命令/doctor 停止并提示 pdd login；只有显式 login/init 进入交互授权。网络不确定不等于过期。拒绝状态归属于实际被检查的材料，不能用损坏工作 Cookie 的拒绝否定未检查的独立来源。
- N9：一次调用最多一次消费恢复；有限网络重试仍受共享截止时间约束。失败、超时、取消、店铺不符或保存冲突不替换有效材料；已成功业务保留现有非敏感保存警告语义。
- N10：保留现有请求前三目标选择与校验；Token/来源/配套 Cookie 不进入命令行、普通日志、错误正文、JSON 业务输出或 Git。兼容现有顶层 cookies/origins 及 merchant_auth.version=1，新增来源单独版本化。
- N11：研发与异常验收使用合成材料和模拟传输。之前已授权的正常登录核验仅证明正常路径，不自动授权破坏真实 Cookie、触发真实账号异常或执行业务写操作。

### Acceptance Criteria

- [x] NC1：真实实现入口的红灯用例：工作 Cookie 没有 PASS_ID/包含另一 PASS_ID，独立保存来源有效；实现前失败，实现后恢复，业务收到来源对应 Cookie，最终按现有时机保存正确材料。
- [x] NC2：Token 原值含等号/百分号时正确消费；来源格式非法、Token 与同次快照不符、跨目标不一致或店铺不符时阻止消费提交，错误不包含凭据。
- [x] NC3：来源和工作材料明确分离；来源只能由已核验候选更新。工作损坏/被拒绝不会覆盖或错误标记未核验来源；来源明确拒绝不无限重复尝试。
- [x] NC4：login、普通命令、doctor 均自动走消费路径，且缺少有效来源/来源失效时只有显式登录进入授权。
- [x] NC5：完整旧保存状态核验后可建立来源；无材料/损坏文件不会凭空造出 Token；已有店铺绑定和登记恢复约束不变。
- [x] NC6：业务失败、网络不确定、取消、修订冲突及保存失败的原子性/警告语义不回退；恢复 context/page 被正确接入并清理。
- [x] NC7：敏感新容器整体脱敏；JSON 契约、fixture 隔离、账号注册复制和显式路径隔离保持。
- [x] NC8：相关测试、全量测试、语法及差异检查通过，规范撤销“禁止独立来源”的收缩结论；报告不把模拟成功或本地写回称为服务端签发/续期。

### Review Gate

已按用户“实现功能”的要求恢复原方案并激活同一任务。新消费路径通过业务收到恢复 Cookie 的回归测试及 31 文件 441 项全量测试；以前的 421 项和真实三接口核验仅为旧校验阶段基线。提交与真实新消费验收仍待确认。

## 收缩范围的历史记录（已被用户撤销，不再作为实施依据）

## Goal

在受控浏览器正常授权得到的冻结快照中，显式提取规范化 login_token（`PASS_ID=原值`），在发出任何核验请求前完成三个固定目标的格式、唯一性及一致性校验；明确 pdd-cli 中 LoginToken 的消费形态就是已核验快照中的 PASS_ID Cookie，并以规范记录本地 Cookie 修复不适用的原因。

用户已授权创建任务并规划，并于 2026-10-11 授权在审查修订文档无阻塞问题后执行。技术设计和执行顺序分别见 design.md、implement.md。

## Background

- 当前登录依赖浏览器授权或已有会话；核验冻结的浏览器快照后，保存该快照。证据：`src/services/auth.js:83`、`src/adapter/merchant-auth.js:45`、`src/adapter/merchant-auth-storage.js:88`。
- 浏览器接入的规范化 login_token 是 PASS_ID 的 `name=value`；SDK 原始 LoginToken 可含 Cookie 属性，原始材料与发送材料不能混用。同次采集覆盖的各目标 PASS_ID 必须相同。证据：`docs/login-token-ck-principles.md:69`、`docs/login-token-ck-principles.md:267`。
- 获取方式：正常授权后从该账号的受控浏览器会话采集 Cookie；无会话时由用户正常授权，不要求用户手工提供 Token。证据：`docs/login-token-ck-principles.md:159`。
- 现有校验已覆盖单目标的名称/值格式、重复名称、分区 Cookie、PASS_ID 空值与逗号、请求头上限（`src/adapter/merchant-auth-probe.js:31`），以及店铺请求前的跨目标 PASS_ID 一致性（`src/adapter/merchant-auth-probe.js:186`）。
- 缺口：`verifyMerchantContext()` 先用 checkLogin 目标的 Cookie 发出登录检查，之后才采集店铺目标 Cookie 并比较 PASS_ID（`src/adapter/merchant-auth.js:52-54`）。三个目标的 PASS_ID 不一致时，已有一次登录检查请求带着一个不能作为整组提交的候选发出。没有显式的规范化 login_token 表示。
- 现有契约不持久化 token 或派生 Cookie 头副本（`test/adapter/merchant-auth-storage.test.js:52`）。
- 失效由固定接口判定：`checkLogin` 返回布尔 `result.login=false` 为 rejected，其余非确定结果为 indeterminate（`src/adapter/merchant-auth-probe.js:60`）。rejected 后普通命令/doctor 报 `E_AUTH_EXPIRED` 提示 login，login/init 进入正常授权（`src/services/auth.js:61-68`）。

### 审计结论：本地 Cookie 修复不适用

工作台的修复模型依赖两份独立存储：浏览器 Cookie 库可被网页改写，而用户中心内存中的 native Cookie 仍有效（`D:/Dev/pinduoduo/dynamic-unpack/docs/login-token-developer-guide.md:187`）。该修复只在"没有判定过期"时把 native Cookie 写回浏览器；明确判定过期时进入失效处理和重新登录，不用修复兜底（同文件 `:204` 的 6.1、6.2 节）。pdd-cli 不具备这一前提：

1. 每次运行按认证文件新建临时上下文，无持久 profile（`src/adapter/browser.js:173-179`）。
2. 商家认证文件只由 `commitMerchantCandidate`（仅接受已核验 branded candidate）和 `recordMerchantCheck`（只改元数据、cookies 原样保留）写入（`src/adapter/merchant-auth-storage.js:76-110`）。
3. 运行中页面改坏 Cookie 时，最终快照核验不通过，不提交、不标记 rejected（`src/commands/runner/single-lifecycle.js:102-105`）；下次运行仍从文件中的已核验材料重建上下文。

因此"本地损坏而服务端会话有效"已由现有重建机制覆盖；接口明确拒绝时，任何同次保存的副本携带同一 PASS_ID，同样会被拒绝，只能重新授权。独立修复依据、旧文件迁移和 doctor 写入不再列入本任务。

## Requirements

- R1：在 `verifyMerchantContext()` 的同一冻结快照内，一次性为 checkLogin、店铺身份、店铺只读三个固定目标分别由浏览器选择 Cookie，并提取规范化 login_token（`PASS_ID=原值`）。不要求用户手工提交 Token；聊天 token、windowsAppShopToken、账号库密文不当作 Cookie。
- R2：在发出任何核验请求前，三个目标的 Cookie 均须通过现有格式规则；每个目标恰有一项非空 PASS_ID，且其值与 login_token 完全一致。值原样保留，不编码/解码、不改写属性或到期时间。
- R3：check 目标没有 PASS_ID 时保持现有 `rejected / auth_missing` 结论且不发请求；格式非法、重复、分区或跨目标不一致时保持现有 `E_AUTH_CANDIDATE_INVALID` 固定错误且不发任何请求。
- R4：LoginToken 的消费形态保持为已核验冻结快照中的 PASS_ID Cookie：核验、提交和后续业务上下文均使用该快照。不新增 token 字段、重复快照或认证文件结构，认证锁、修订号、店铺绑定和提交时机不变。
- R5：接口判定的失效行为保持不变：rejected 时普通命令/doctor 不打开授权页面并提示 `pdd login`，login/init 可正常重新授权；indeterminate 不误报过期、不触发授权。
- R6：login_token 与 Cookie 不进入命令行、普通日志、错误正文或 JSON 输出；错误 detail 只含固定 reason。
- R7：开发及自动化测试使用合成凭据与模拟传输；真实账号验收须另行确认范围。
- R8：在 `.trellis/spec/adapter/auth-mall-context.md` 记录请求前三目标选择契约，以及本地 Cookie 修复不适用的原因，避免重复提出同类方案。

## Acceptance Criteria

- [x] AC1（R1、R2）：合成快照中值含 `=`、`%xx` 的 PASS_ID 被原样提取为 `PASS_ID=原值`；非 PASS_ID 的同名变体（如 `pass_id`）不被识别。
- [x] AC2（R2、R3）：check 目标存在非空 PASS_ID 时，任一目标出现空值、重复、非法字符或分区 PASS_ID 时返回 `E_AUTH_CANDIDATE_INVALID`，模拟传输记录 0 次请求。check 目标没有非空 PASS_ID 的情况由 AC4 覆盖，保留原有判定顺序。
- [x] AC3（R2、R3）：checkLogin 目标与任一店铺目标的 PASS_ID 不一致时返回 `cross_target_pass_id_mismatch`，模拟传输记录 0 次请求（含 checkLogin）。该用例在实现前须为红灯。
- [x] AC4（R3）：check 目标缺少 PASS_ID 时仍返回 `rejected / auth_missing`，0 次请求。
- [x] AC5（R4、R5）：认证文件结构、提交内容与现有测试一致（不含 token 副本）；login/普通命令/doctor 的 verified、rejected、indeterminate 行为由现有测试继续覆盖并通过。
- [x] AC6（R6）：错误对象及 detail 不含 Cookie 或 login_token 值。
- [x] AC7（R8）：规范已更新；报告区分模拟验证与未执行的真实后端验收。

## Out Of Scope

- 独立修复依据（repair_credential）、本地 Cookie 修复、旧认证文件迁移、doctor 写入认证文件（理由见审计结论）。
- 完整复刻工作台 StartTokenLogin、原生用户中心、聊天或 WebSocket 登录。
- SDK 原始 LoginToken 导入、外部 Token 导入命令、独立扫码协议、浏览器扩展。
- 服务端续期、静默自动续期、定时认证后台，以及从日常浏览器或工作台账号库扫描凭据。
- 未经明确授权的真实账号或后端验收。

## Review Gate

修订文档已审查，无阻塞问题；用户授权后已激活实现阶段。
